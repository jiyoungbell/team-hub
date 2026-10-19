import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Env } from "../src/env";

// Just enough of D1 on top of node:sqlite to run the real queries.
export function memoryD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const stmt = (sql: string, params: unknown[] = []): unknown => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    first: async () => {
      const r = db.prepare(sql).get(...(params as never[]));
      return r ? { ...r } : null;
    },
    all: async () => ({ results: db.prepare(sql).all(...(params as never[])).map((r) => ({ ...r })), success: true }),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...(params as never[])).changes) } })
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

export async function testEnv(): Promise<Env> {
  const { privateKey } = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    DB: memoryD1(),
    HUB_ORIGIN: "https://team.rescene-remine.com",
    DISCORD_CLIENT_ID: "1420078078511550657",
    DISCORD_GUILD_ID: "1546419001041748068",
    DISCORD_ROLE_ID: "1546422674035707944",
    DISCORD_CLIENT_SECRET: "client-secret\n",
    SIGNING_KEY: JSON.stringify(await crypto.subtle.exportKey("jwk", privateKey)),
    TOKEN_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
    GATE_TOKEN: "gate-token",
    ADMIN_DISCORD_ID: "111111111111111111"
  };
}

export const ROLE = "1546422674035707944";

export interface FakeUser {
  id: string;
  nick?: string | null;
  globalName?: string;
  avatar?: string | null;
  roles: string[];
  inGuild?: boolean;
}

// A pretend Discord: codes and refresh tokens map to users; refresh tokens rotate.
export class FakeDiscord {
  users = new Map<string, FakeUser>();
  codes = new Map<string, string>();
  refresh = new Map<string, string>();
  access = new Map<string, string>();
  tokenStatus: number | null = null;
  memberStatus: number | null = null;
  calls: string[] = [];
  private n = 0;

  grant(userId: string) {
    const access = `acc${++this.n}`;
    const refresh = `ref${this.n}`;
    this.access.set(access, userId);
    this.refresh.set(refresh, userId);
    return { access_token: access, refresh_token: refresh, scope: "identify guilds.members.read", token_type: "Bearer" };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    this.calls.push(url);
    if (url.endsWith("/oauth2/token")) {
      if (this.tokenStatus) return Response.json({ error: "nope" }, { status: this.tokenStatus });
      const form = new URLSearchParams(String(init?.body));
      if (form.get("client_secret") !== "client-secret") return Response.json({ error: "invalid_client" }, { status: 401 });
      const key = form.get("grant_type") === "authorization_code" ? form.get("code")! : form.get("refresh_token")!;
      const map = form.get("grant_type") === "authorization_code" ? this.codes : this.refresh;
      const user = map.get(key);
      if (!user) return Response.json({ error: "invalid_grant" }, { status: 400 });
      map.delete(key);
      return Response.json(this.grant(user));
    }
    if (url.includes("/users/@me/guilds/")) {
      if (this.memberStatus) return Response.json({}, { status: this.memberStatus });
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      const u = this.users.get(this.access.get(auth.replace("Bearer ", "")) ?? "");
      if (!u) return Response.json({ message: "401: Unauthorized" }, { status: 401 });
      if (u.inGuild === false) return Response.json({ code: 10004 }, { status: 404 });
      return Response.json({
        nick: u.nick ?? null,
        avatar: null,
        roles: u.roles,
        user: { id: u.id, username: "user", global_name: u.globalName ?? "Global", avatar: u.avatar ?? null }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

export const cookieOf = (res: Response, name: string) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => c.startsWith(`${name}=`)) ?? null;
