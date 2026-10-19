import { afterEach, expect, it, vi } from "vitest";
import { forgetHealth, toolHealth } from "../src/health";

afterEach(() => { vi.unstubAllGlobals(); forgetHealth(); });

it.each([200, 204, 302, 403, 404, 429, 500, 502])("reports health accurately for HTTP %i", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  const result = await toolHealth(["cert.rescene-remine.com"], Date.now());
  expect(result.get("cert.rescene-remine.com")).toBe(status >= 200 && status < 300);
});

it("reports an unreachable health endpoint as down", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
  expect((await toolHealth(["cert.rescene-remine.com"], Date.now())).get("cert.rescene-remine.com")).toBe(false);
});
