import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validHost } from "../src/admin";
import type { Env } from "../src/env";
import { forgetHealth } from "../src/health";
import worker from "../src/index";
import { cookieOf, FakeDiscord, ROLE, testEnv } from "./helpers";

const HUB = "https://team.rescene-remine.com";
const ME = "111111111111111111";
const MEMBER = "333333333333333333";

let env: Env;
let discord: FakeDiscord;
let toolStatus: Record<string, number>;

const call = (path: string, init: RequestInit & { cookie?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return worker.fetch(new Request(`${HUB}${path}`, { ...init, headers, redirect: "manual" }) as Parameters<typeof worker.fetch>[0], env);
};

const post = (path: string, cookie: string | null, fields: Record<string, string>, origin = HUB) =>
  call(path, { method: "POST", cookie, headers: { origin }, body: new URLSearchParams(fields) });

async function sessionOf(userId: string): Promise<string | null> {
  const start = await call("/login");
  const state = new URL(start.headers.get("location")!).searchParams.get("state");
  const code = `code-${userId}-${Math.random()}`;
  discord.codes.set(code, userId);
  return cookieOf(await call(`/auth/callback?code=${code}&state=${state}`, { cookie: cookieOf(start, "__Host-oauth") }), "__Host-session");
}

beforeEach(async () => {
  env = await testEnv();
  discord = new FakeDiscord();
  discord.users.set(ME, { id: ME, nick: "센마인", roles: [ROLE] });
  discord.users.set(MEMBER, { id: MEMBER, nick: "팀원", roles: [ROLE] });
  toolStatus = {};
  forgetHealth();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/_auth/health") {
      const s = toolStatus[url.host];
      if (!s) throw new Error("connect failed");
      return new Response(null, { status: s });
    }
    return discord.fetch(input, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("pages", () => {
  it("shows the login button to visitors and sends them to Discord from other pages", async () => {
    expect(await (await call("/")).text()).toContain("디스코드로 로그인");
    expect((await call("/settings")).headers.get("location")).toBe("/login?next=%2Fsettings");
  });

  it("lists tools with whether they answer", async () => {
    toolStatus["cert.rescene-remine.com"] = 302;
    toolStatus["monitor.rescene-remine.com"] = 502;
    const html = await (await call("/", { cookie: await sessionOf(ME) })).text();
    expect(html).toMatch(/MAMA 인증 분류<\/span>/);
    const cert = html.slice(html.indexOf('class="card" href="https://cert.'));
    expect(cert.slice(0, cert.indexOf("</a>"))).toContain("정상");
    const monitor = html.slice(html.indexOf('class="card" href="https://monitor.'));
    expect(monitor.slice(0, monitor.indexOf("</a>"))).toContain("응답 없음");
  });

  it("saves the theme and tells team-gate about it", async () => {
    const sess = await sessionOf(ME);
    expect((await call("/", { cookie: sess })).headers.get("content-type")).toMatch(/html/);
    expect(await (await call("/", { cookie: sess })).text()).toContain('data-theme="dark"');

    const before = Date.now();
    expect((await post("/settings", sess, { theme: "light" })).status).toBe(302);
    expect(await (await call("/", { cookie: sess })).text()).toContain('data-theme="light"');

    const sync = (await (
      await call(`/api/gate/sync?since=${before + 60_000}`, { headers: { authorization: "Bearer gate-token" } })
    ).json()) as { profiles: { id: string; theme: string }[] };
    expect(sync.profiles).toContainEqual(expect.objectContaining({ id: ME, theme: "light" }));
  });

  it("refuses posts from another origin", async () => {
    const sess = await sessionOf(ME);
    expect((await post("/settings", sess, { theme: "light" }, "https://jachong.rescene-remine.com")).status).toBe(403);
    expect(await (await call("/", { cookie: sess })).text()).toContain('data-theme="dark"');
  });

  it("keeps the admin page to the admin", async () => {
    const member = await sessionOf(MEMBER);
    expect((await call("/admin", { cookie: member })).status).toBe(404);
    expect((await post("/admin/users/logout", member, { id: ME })).status).toBe(404);
    expect(await (await call("/", { cookie: member })).text()).not.toContain('href="/admin"');

    const admin = await sessionOf(ME);
    const html = await (await call("/admin", { cookie: admin })).text();
    expect(html).toContain("팀원");
    expect(html).toContain("강제 로그아웃");
  });

  it("adds, edits and removes tools", async () => {
    const admin = await sessionOf(ME);
    expect((await post("/admin/tools", admin, { host: "Vote.rescene-remine.com", name: "투표", position: "3", icon: "chart" })).status).toBe(302);
    expect(await env.DB.prepare("SELECT name, position, icon FROM tools WHERE host = 'vote.rescene-remine.com'").first()).toEqual({
      name: "투표",
      position: 3,
      icon: "chart"
    });

    await post("/admin/tools", admin, { host: "vote.rescene-remine.com", name: "투표 분류", position: "0", icon: "nope" });
    expect(await env.DB.prepare("SELECT name, position, icon FROM tools WHERE host = 'vote.rescene-remine.com'").first()).toEqual({
      name: "투표 분류",
      position: 0,
      icon: null
    });

    await post("/admin/tools/delete", admin, { host: "vote.rescene-remine.com" });
    expect(await env.DB.prepare("SELECT 1 FROM tools WHERE host = 'vote.rescene-remine.com'").first()).toBeNull();
  });

  it("only accepts tool hosts next to the hub", async () => {
    const admin = await sessionOf(ME);
    const res = await post("/admin/tools", admin, { host: "evil.example.com", name: "x", position: "1", icon: "box" });
    expect(res.headers.get("location")).toBe("/admin?error=host");
    expect(await (await call("/admin?error=host", { cookie: admin })).text()).toContain("잘못된 주소");
    expect(validHost(env, "cert.rescene-remine.com")).toBe(true);
    expect(validHost(env, "team.rescene-remine.com")).toBe(false);
    expect(validHost(env, "a.b.rescene-remine.com")).toBe(false);
    expect(validHost(env, "rescene-remine.com")).toBe(false);
    expect(validHost(env, "x.rescene-remine.com.evil.io")).toBe(false);
  });

  it("logs someone out everywhere from the admin page", async () => {
    const admin = await sessionOf(ME);
    const member = await sessionOf(MEMBER);
    await post("/admin/users/logout", admin, { id: MEMBER });
    expect((await call("/api/me", { cookie: member })).status).toBe(401);
    expect((await call("/api/me", { cookie: admin })).status).toBe(200);
  });
});
