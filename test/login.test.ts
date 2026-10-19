import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("login", () => {
  it("asks Discord for identify + guilds.members.read without a consent screen", async () => {
    const res = await call("/login");
    const url = new URL(res.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(url.searchParams.get("scope")).toBe("identify guilds.members.read");
    expect(url.searchParams.get("prompt")).toBe("none");
    expect(url.searchParams.get("redirect_uri")).toBe(`${HUB}/auth/callback`);
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-oauth=.*Secure; HttpOnly; SameSite=Lax/);
    expect(new URL((await call("/login?again=1")).headers.get("location")!).searchParams.get("prompt")).toBe("consent");
  });

  it("lets a team member in and shows their nickname", async () => {
    const res = await logIn(ME);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const sess = cookieOf(res, "__Host-session");
    expect(res.headers.getSetCookie().join()).toMatch(/__Host-session=.*Max-Age=2592000/);
    const home = await (await call("/", { cookie: sess })).text();
    expect(home).toContain("지영");
    expect(await (await call("/api/me", { cookie: sess })).json()).toMatchObject({ id: ME, name: "지영", admin: true });

    const row = await env.DB.prepare("SELECT refresh_token, check_result FROM users WHERE id = ?").bind(ME).first<Record<string, string>>();
    expect(row!.check_result).toBe("ok");
    expect(row!.refresh_token).not.toMatch(/^ref/);
  });

  it("turns away people without the role and keeps nothing about them", async () => {
    const res = await logIn(OTHER);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("다른 계정으로 로그인");
    expect(cookieOf(res, "__Host-session")).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(OTHER).first()).toBeNull();
  });

  it("turns away people who aren't in the server", async () => {
    discord.users.get(ME)!.inGuild = false;
    expect((await logIn(ME)).status).toBe(403);
  });

  it("rejects a callback whose state doesn't match", async () => {
    discord.codes.set("c", ME);
    const res = await call("/auth/callback?code=c&state=forged", { cookie: "__Host-oauth=real.Lw" });
    expect(res.status).toBe(502);
    expect(cookieOf(res, "__Host-session")).toBeNull();
  });

  it("returns to a same-site next path only", async () => {
    expect((await logIn(ME, "/go?to=cert.rescene-remine.com")).headers.get("location")).toBe("/go?to=cert.rescene-remine.com");
    expect((await logIn(ME, "//evil.example/x")).headers.get("location")).toBe("/");
    expect((await logIn(ME, "https://evil.example")).headers.get("location")).toBe("/");
  });

  it("logs out", async () => {
    const sess = await sessionOf(ME);
    await call("/logout", { method: "POST", cookie: sess });
    expect((await call("/api/me", { cookie: sess })).status).toBe(401);
  });

  it("ignores a cookie with the wrong secret", async () => {
    const [sid] = (await sessionOf(ME))!.split("=")[1]!.split(".");
    expect((await call("/api/me", { cookie: `__Host-session=${sid}.wrong` })).status).toBe(401);
  });
});
