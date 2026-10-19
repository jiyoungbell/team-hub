import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { listTools } from "../src/gate";
import { toolHealth } from "../src/health";
import { testEnv } from "./helpers";

const CERT = "cert.rescene-remine.com";
let env: Env;

beforeEach(async () => {
  env = await testEnv();
});
afterEach(() => vi.unstubAllGlobals());

const health = async (now: number, ctx?: ExecutionContext) => (await toolHealth(env, await listTools(env), now, ctx)).get(CERT);

it.each([200, 204, 302, 403, 404, 429, 500, 502])("reports health accurately for HTTP %i", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  expect(await health(Date.now())).toBe(status >= 200 && status < 300);
});

it("reports an unreachable health endpoint as down", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
  expect(await health(Date.now())).toBe(false);
});

it("answers from the stored check and rechecks stale ones after the response", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const now = Date.now();
  expect(await health(now)).toBe(true);
  const calls = fetch.mock.calls.length;

  // Fresh: no probe.
  expect(await health(now + 30_000)).toBe(true);
  expect(fetch.mock.calls.length).toBe(calls);

  // Stale and the tool went down: the page still gets the stored answer at once.
  fetch.mockRejectedValue(new Error("connect failed"));
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext;
  expect(await health(now + 61_000, ctx)).toBe(true);
  expect(pending.length).toBeGreaterThan(0);
  await Promise.all(pending);
  expect(await health(now + 62_000)).toBe(false);
});

it("probes a stale host only once when requests overlap", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const now = Date.now();
  await health(now);
  fetch.mockClear();
  await Promise.all([health(now + 61_000), health(now + 61_000), health(now + 61_000)]);
  expect(fetch.mock.calls.filter(([u]) => String(u).includes(CERT)).length).toBe(1);
});
