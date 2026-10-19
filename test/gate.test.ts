import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicJwk, verifyJwt } from "../src/crypto";
import type { Env } from "../src/env";
import worker from "../src/index";
import { cookieOf, FakeDiscord, ROLE, testEnv } from "./helpers";

const HUB = "https://team.rescene-remine.com";
const ME = "111111111111111111";
const OTHER = "222222222222222222";

let env: Env;
let discord: FakeDiscord;

const call = (path: string, init: RequestInit & { cookie?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return worker.fetch(new Request(`${HUB}${path}`, { ...init, headers, redirect: "manual" }) as Parameters<typeof worker.fetch>[0], env);
};

async function logIn(userId: string, next?: string): Promise<Response> {
  const start = await call(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  const auth = new URL(start.headers.get("location")!);
  const code = `code-${userId}-${Math.random()}`;
  discord.codes.set(code, userId);
  return call(`/auth/callback?code=${code}&state=${auth.searchParams.get("state")}`, { cookie: cookieOf(start, "__Host-oauth") });
}

const sessionOf = async (userId: string) => cookieOf(await logIn(userId), "__Host-session");

beforeEach(async () => {
  env = await testEnv();
  discord = new FakeDiscord();
  discord.users.set(ME, { id: ME, nick: "지영", roles: [ROLE] });
  discord.users.set(OTHER, { id: OTHER, nick: "옆사람", roles: ["999"] });
  vi.stubGlobal("fetch", discord.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("/go", () => {
  const STATE = "s".repeat(24);

  it("sends someone without a session to log in first", async () => {
    const res = await call(`/go?to=cert.rescene-remine.com&state=${STATE}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`href="/login?next=${encodeURIComponent(`/go?to=cert.rescene-remine.com&state=${STATE}`).replace(/&/g, "&#38;")}"`);
  });

  it("issues a ticket for a listed tool", async () => {
    const sess = await sessionOf(ME);
    const res = await call(`/go?to=cert.rescene-remine.com&next=/upload%3Fx%3D1&state=${STATE}`, { cookie: sess });
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://cert.rescene-remine.com/_auth/callback");

    const pub = publicJwk(env.SIGNING_KEY);
    const ticket = await verifyJwt(pub, loc.searchParams.get("ticket")!);
    const sid = sess!.split("=")[1]!.split(".")[0];
    expect(ticket).toMatchObject({ kind: "ticket", aud: "cert.rescene-remine.com", sub: ME, sid, state: STATE, next: "/upload?x=1" });
    expect((ticket!.exp as number) - (ticket!.iat as number)).toBe(60);
    expect(typeof ticket!.jti).toBe("string");

    const tool = await verifyJwt(pub, ticket!.tok as string);
    expect(tool).toMatchObject({ kind: "tool", aud: "cert.rescene-remine.com", sub: ME, sid });
    expect((tool!.exp as number) - (tool!.iat as number)).toBe(7 * 86400);
  });

  it("opens chart with the existing hub session without another Discord login", async () => {
    const sess = await sessionOf(ME);
    discord.calls = [];
    const res = await call(`/go?to=chart.rescene-remine.com&state=${STATE}`, { cookie: sess });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://chart.rescene-remine.com");
    const ticket = await verifyJwt(publicJwk(env.SIGNING_KEY), location.searchParams.get("ticket")!);
    expect(ticket).toMatchObject({ aud: "chart.rescene-remine.com", sid: sess!.split("=")[1]!.split(".")[0] });
    expect(discord.calls).toEqual([]);
    expect((await call("/api/me", { cookie: sess })).status).toBe(200);
  });

  it("refuses hosts that aren't tools, and bad states", async () => {
    const sess = await sessionOf(ME);
    expect((await call(`/go?to=jachong.rescene-remine.com&state=${STATE}`, { cookie: sess })).status).toBe(400);
    expect((await call(`/go?to=evil.example&state=${STATE}`, { cookie: sess })).status).toBe(400);
    expect((await call(`/go?to=cert.rescene-remine.com&state=x`, { cookie: sess })).status).toBe(400);
  });

  it("drops a next that leaves the site", async () => {
    const sess = await sessionOf(ME);
    const res = await call(`/go?to=cert.rescene-remine.com&next=//evil.example&state=${STATE}`, { cookie: sess });
    const t = await verifyJwt(publicJwk(env.SIGNING_KEY), new URL(res.headers.get("location")!).searchParams.get("ticket")!);
    expect(t!.next).toBe("/");
  });
});

describe("/api/gate", () => {
  const gate = { authorization: "Bearer gate-token" };

  it("needs the gate token", async () => {
    expect((await call("/api/gate/sync")).status).toBe(401);
    expect((await call("/api/gate/sync", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("publishes the public key without auth", async () => {
    const key = (await (await call("/api/gate/public-key")).json()) as Record<string, string>;
    expect(key).toEqual(publicJwk(env.SIGNING_KEY));
    expect(key.d).toBeUndefined();
  });

  it("reports revoked sessions, changed profiles and tools", async () => {
    const sess = await sessionOf(ME);
    const sid = sess!.split("=")[1]!.split(".")[0];
    const first = (await (await call("/api/gate/sync?since=0", { headers: gate })).json()) as Record<string, unknown>;
    expect(first.revoked).toEqual([]);
    expect(first.profiles).toEqual([{ id: ME, name: "지영", avatar: expect.any(String), theme: null }]);
    expect((first.tools as { host: string }[]).map((t) => t.host)).toEqual(["cert.rescene-remine.com", "monitor.rescene-remine.com", "chart.rescene-remine.com"]);

    await call("/logout", { cookie: sess });
    const next = (await (await call(`/api/gate/sync?since=${first.cursor}`, { headers: gate })).json()) as Record<string, unknown>;
    expect(next.revoked).toEqual([sid]);
  });

  it("revokes a session for a tool's logout", async () => {
    const sess = await sessionOf(ME);
    const sid = sess!.split("=")[1]!.split(".")[0];
    const res = await call("/api/gate/logout", { method: "POST", headers: gate, body: JSON.stringify({ sid }) });
    expect(res.status).toBe(204);
    expect((await call("/api/me", { cookie: sess })).status).toBe(401);
  });
});
