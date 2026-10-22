import type { Env } from "./env";

const API = "https://api.notion.com/v1";
const VERSION = "2025-09-03";
const TIMEOUT_MS = 8_000;

// Bad token, missing access, a renamed property, a 5xx: the last copy stays in use.
export class NotionError extends Error {}

export const PROPS = {
  title: "할 일",
  status: "상태",
  teams: "작업 팀",
  assignees: "담당자",
  category: "분류",
  due: "마감일",
  stage: "현재 단계",
  next_action: "다음 행동",
  memo: "메모",
  basis: "일정 근거",
  started: "시작일",
  first_seen: "최초 확인일",
  done_on: "완료일",
  hub_change: "허브 변경"
} as const;

export interface TodoItem {
  page_id: string;
  title: string;
  status: string | null;
  teams: string[];
  assignees: string[];
  category: string | null;
  due_start: string | null;
  due_end: string | null;
  stage: string | null;
  next_action: string | null;
  memo: string | null;
  basis: string | null;
  started: string | null;
  first_seen: string | null;
  done_on: string | null;
  hub_change: string | null;
  url: string;
  edited_at: string;
}

export interface Options {
  statuses: string[];
  teams: string[];
  assignees: string[];
}

export interface Schema {
  ids: string[];
  options: Options;
}

type Json = Record<string, any>;

async function notion(env: Env, path: string, init: RequestInit = {}, retry = true): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${(env.NOTION_TOKEN ?? "").trim()}`,
        "notion-version": VERSION,
        "content-type": "application/json"
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    throw new NotionError(String(e).slice(0, 200));
  }
  // Rate limited (3 requests a second on average): wait as asked, at most 2 s, and try once more.
  if (res.status === 429 && retry) {
    const wait = Math.min(Number(res.headers.get("retry-after")) || 1, 2);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return notion(env, path, init, false);
  }
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new NotionError(`HTTP ${res.status} ${String(body.code ?? "")} ${String(body.message ?? "")}`.trim().slice(0, 300));
  return body;
}

const names = (prop: Json | undefined, kind: string): string[] =>
  Array.isArray(prop?.[kind]?.options) ? prop[kind].options.map((o: Json) => String(o.name)) : [];

export async function getSchema(env: Env): Promise<Schema> {
  const ds = await notion(env, `/data_sources/${env.NOTION_TODO_SOURCE}`);
  const props = (ds.properties ?? {}) as Record<string, Json>;
  const missing = Object.values(PROPS).filter((n) => !props[n]);
  if (missing.length) throw new NotionError(`속성 없음: ${missing.join(", ")}`);
  return {
    ids: Object.values(PROPS).map((n) => String(props[n]!.id)),
    options: {
      statuses: names(props[PROPS.status], "status"),
      teams: names(props[PROPS.teams], "multi_select"),
      assignees: names(props[PROPS.assignees], "multi_select")
    }
  };
}

// Property ids come percent-encoded from Notion, so they go into the query string as they are.
const only = (ids: string[], key: string) => ids.map((id) => `${key}=${id}`).join("&");

export async function queryAll(env: Env, schema: Schema): Promise<TodoItem[]> {
  const items: TodoItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await notion(env, `/data_sources/${env.NOTION_TODO_SOURCE}/query?${only(schema.ids, "filter_properties[]")}`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
    });
    for (const r of page.results ?? []) {
      const item = toItem(r);
      if (item) items.push(item);
    }
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return items;
}

export async function getPage(env: Env, pageId: string): Promise<Json> {
  return notion(env, `/pages/${pageId}`);
}

export async function updatePage(env: Env, pageId: string, properties: Json, extra: { in_trash?: boolean } = {}): Promise<Json> {
  return notion(env, `/pages/${pageId}`, { method: "PATCH", body: JSON.stringify({ properties, ...extra }) });
}

export async function createPage(env: Env, properties: Json): Promise<Json> {
  return notion(env, "/pages", {
    method: "POST",
    body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: env.NOTION_TODO_SOURCE }, properties })
  });
}

export const richText = (content: string) => [{ type: "text", text: { content } }];

export const inSource = (env: Env, page: Json) => page.parent?.data_source_id === env.NOTION_TODO_SOURCE;

const kst = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

// "2026-10-22" stays as is; "2026-11-03T17:00:00.000+09:00" becomes "2026-11-03T17:00" in KST.
export function kstDate(s: unknown): string | null {
  if (typeof s !== "string" || !s) return null;
  if (!s.includes("T")) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.slice(0, 16) : kst.format(d).replace(" ", "T");
}

const text = (p: Json | undefined): string | null => {
  const parts = p?.[p?.type];
  if (!Array.isArray(parts)) return null;
  const s = parts.map((x: Json) => String(x.plain_text ?? "")).join("").trim();
  return s || null;
};
const multi = (p: Json | undefined): string[] => (Array.isArray(p?.multi_select) ? p.multi_select.map((o: Json) => String(o.name)) : []);
const date = (p: Json | undefined) => p?.date ?? null;

export function toItem(page: Json): TodoItem | null {
  if (page?.object !== "page" || page.in_trash || page.archived) return null;
  const p = (page.properties ?? {}) as Record<string, Json>;
  const title = text(p[PROPS.title]);
  if (!title) return null;
  const due = date(p[PROPS.due]);
  return {
    page_id: String(page.id),
    title,
    status: p[PROPS.status]?.status?.name ?? null,
    teams: multi(p[PROPS.teams]),
    assignees: multi(p[PROPS.assignees]),
    category: p[PROPS.category]?.select?.name ?? null,
    due_start: kstDate(due?.start),
    due_end: kstDate(due?.end),
    stage: text(p[PROPS.stage]),
    next_action: text(p[PROPS.next_action]),
    memo: text(p[PROPS.memo]),
    basis: text(p[PROPS.basis]),
    started: kstDate(date(p[PROPS.started])?.start)?.slice(0, 10) ?? null,
    first_seen: kstDate(date(p[PROPS.first_seen])?.start)?.slice(0, 10) ?? null,
    done_on: kstDate(date(p[PROPS.done_on])?.start)?.slice(0, 10) ?? null,
    hub_change: text(p[PROPS.hub_change]),
    url: String(page.url ?? ""),
    edited_at: String(page.last_edited_time ?? "")
  };
}
