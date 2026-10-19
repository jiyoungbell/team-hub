import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";
import { recheck } from "../src/recheck";
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

describe("daily recheck", () => {
  const later = () => Date.now() + 86_400_000;
  const user = () => env.DB.prepare("SELECT name, check_result, refresh_token FROM users WHERE id = ?").bind(ME).first<Record<string, string | null>>();

  it("refreshes the profile and keeps the session", async () => {
    const sess = await sessionOf(ME);
    discord.users.get(ME)!.nick = "새닉";
    await recheck(env, later());
    expect((await user())!.name).toBe("새닉");
    expect((await call("/api/me", { cookie: sess })).status).toBe(200);
    // The rotated refresh token was saved, so the next day works too.
    await recheck(env, later() + 86_400_000);
    expect((await user())!.check_result).toBe("ok");
  });

  it("logs out someone who lost the role", async () => {
    const sess = await sessionOf(ME);
    discord.users.get(ME)!.roles = [];
    await recheck(env, later());
    expect((await call("/api/me", { cookie: sess })).status).toBe(401);
    expect(await user()).toMatchObject({ check_result: "no_role", refresh_token: null });
  });

  it("logs out someone who left the server or removed the app", async () => {
    const sess = await sessionOf(ME);
    discord.refresh.clear();
    await recheck(env, later());
    expect((await call("/api/me", { cookie: sess })).status).toBe(401);
    expect((await user())!.check_result).toBe("revoked");
  });

  it("leaves everyone alone when Discord is down or misconfigured", async () => {
    const sess = await sessionOf(ME);
    for (const status of [503, 401]) {
      discord.tokenStatus = status;
      await env.DB.prepare("UPDATE users SET checked_at = 0").run();
      await recheck(env, later());
      expect((await call("/api/me", { cookie: sess })).status).toBe(200);
      expect((await user())!.check_result).toBe("unreachable");
    }
  });

  it("stops the batch when rate limited, without marking anyone", async () => {
    await sessionOf(ME);
    discord.tokenStatus = 429;
    await recheck(env, later());
    expect((await user())!.check_result).toBe("ok");
  });

  it("skips people with no live session", async () => {
    const sess = await sessionOf(ME);
    await call("/logout", { cookie: sess });
    discord.calls = [];
    await recheck(env, later());
    expect(discord.calls).toEqual([]);
  });
});
