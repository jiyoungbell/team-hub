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
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: { run: () => Promise<unknown> }[]) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const st of stmts) out.push(await st.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  } as unknown as D1Database;
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
    ADMIN_DISCORD_ID: "111111111111111111",
    NOTION_TODO_SOURCE: SOURCE,
    NOTION_TOKEN: "notion-token\n"
  };
}

export const ROLE = "1546422674035707944";
export const SOURCE = "3f01046f-a724-80b6-899b-000bc9c24041";

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

type Json = Record<string, any>;

const rich = (s?: string | null) => (s ? [{ type: "text", plain_text: s, text: { content: s } }] : []);
const day = (start?: string | null) => (start ? { start, end: null, time_zone: null } : null);

export interface FakeItem {
  title?: string;
  status?: string | null;
  teams?: string[];
  who?: string[];
  category?: string;
  due?: string;
  stage?: string;
  next?: string;
  done?: string;
  source?: string;
}

export function notionPage(id: string, f: FakeItem): Json {
  return {
    object: "page",
    id,
    url: `https://www.notion.so/${id.replace(/-/g, "")}`,
    last_edited_time: "2026-10-19T09:16:00.000Z",
    in_trash: false,
    archived: false,
    parent: { type: "data_source_id", data_source_id: f.source ?? SOURCE },
    properties: {
      "할 일": { id: "title", type: "title", title: rich(f.title ?? "") },
      상태: { id: "st", type: "status", status: f.status ? { name: f.status } : null },
      "작업 팀": { id: "tm", type: "multi_select", multi_select: (f.teams ?? []).map((name) => ({ name })) },
      담당자: { id: "wh", type: "multi_select", multi_select: (f.who ?? []).map((name) => ({ name })) },
      분류: { id: "ct", type: "select", select: f.category ? { name: f.category } : null },
      마감일: { id: "du", type: "date", date: day(f.due) },
      "현재 단계": { id: "sg", type: "rich_text", rich_text: rich(f.stage) },
      "다음 행동": { id: "nx", type: "rich_text", rich_text: rich(f.next) },
      메모: { id: "mm", type: "rich_text", rich_text: rich(f.stage) },
      "일정 근거": { id: "bs", type: "rich_text", rich_text: rich("근거") },
      시작일: { id: "sd", type: "date", date: null },
      "최초 확인일": { id: "fs", type: "date", date: day("2026-10-18") },
      완료일: { id: "dn", type: "date", date: day(f.done) },
      "허브 변경": { id: "hc", type: "rich_text", rich_text: [] }
    }
  };
}

// A pretend Notion API holding one data source.
export class FakeNotion {
  pages = new Map<string, Json>();
  status: number | null = null;
  missing: string[] = [];
  calls: { method: string; path: string; body: Json | null }[] = [];
  statuses = ["시작 전", "보류", "진행 중", "완료"];
  teams = ["SNS", "분석", "총무", "개발", "총대", "디자인", "기타"];
  assignees = ["센마인", "앵도", "총대"];

  add(id: string, f: FakeItem) {
    this.pages.set(id, notionPage(id, f));
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Json) : null;
    this.calls.push({ method, path: url.pathname + url.search, body });
    if (new Headers(init?.headers).get("authorization") !== "Bearer notion-token") return Response.json({ code: "unauthorized", message: "API token is invalid." }, { status: 401 });
    if (this.status) return Response.json({ code: "internal_server_error", message: "boom" }, { status: this.status });

    if (url.pathname === `/v1/data_sources/${SOURCE}` && method === "GET") {
      const props: Json = {};
      for (const [name, p] of Object.entries(notionPage("x", {}).properties as Json)) {
        if (this.missing.includes(name)) continue;
        props[name] = { id: p.id, name, type: p.type };
      }
      if (props.상태) props.상태.status = { options: this.statuses.map((name) => ({ name })) };
      if (props["작업 팀"]) props["작업 팀"].multi_select = { options: this.teams.map((name) => ({ name })) };
      if (props.담당자) props.담당자.multi_select = { options: this.assignees.map((name) => ({ name })) };
      return Response.json({ object: "data_source", id: SOURCE, properties: props });
    }
    if (url.pathname === `/v1/data_sources/${SOURCE}/query` && method === "POST") {
      const all = [...this.pages.values()].filter((p) => p.parent.data_source_id === SOURCE);
      const start = Number(body?.start_cursor ?? 0);
      const size = Number(body?.page_size ?? 100);
      const results = all.slice(start, start + size);
      const more = start + size < all.length;
      return Response.json({ object: "list", results, has_more: more, next_cursor: more ? String(start + size) : null });
    }
    const m = /^\/v1\/pages\/([\w-]+)$/.exec(url.pathname);
    if (m) {
      const page = this.pages.get(m[1]!);
      if (!page) return Response.json({ code: "object_not_found", message: "nope" }, { status: 404 });
      if (method === "PATCH") {
        for (const [k, v] of Object.entries(body!.properties as Json)) {
          page.properties[k] = { ...page.properties[k], ...v };
          if (v.rich_text) page.properties[k].rich_text = v.rich_text.map((r: Json) => ({ ...r, plain_text: r.text.content }));
        }
        page.last_edited_time = new Date().toISOString();
      }
      return Response.json(page);
    }
    throw new Error(`unexpected notion ${method} ${url.pathname}`);
  };
}
