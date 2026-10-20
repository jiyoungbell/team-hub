import { log, MINUTE, type Env } from "./env";
import { getPage, getSchema, inSource, NotionError, PROPS, queryAll, toItem, updatePage, type Options, type TodoItem } from "./notion";
import type { Session } from "./session";

export const STATUSES = ["시작 전", "진행 중", "보류", "완료"];
export const DONE = "완료";
export const HELD = "보류";

const COLS = [
  "page_id", "title", "status", "teams", "assignees", "category", "due_start", "due_end", "stage", "next_action",
  "memo", "basis", "started", "first_seen", "done_on", "hub_change", "url", "edited_at"
] as const;

// One statement for any number of rows: the items go in as a single JSON parameter.
const UPSERT = `INSERT OR REPLACE INTO todo_items (${COLS.join(", ")})
  SELECT ${COLS.map((c) => `json_extract(value, '$.${c}')`).join(", ")} FROM json_each(?)`;

interface Row extends Omit<TodoItem, "teams" | "assignees"> {
  teams: string;
  assignees: string;
}

const list = (s: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

const fromRow = (r: Row): TodoItem => ({ ...r, teams: list(r.teams), assignees: list(r.assignees) });

export interface Meta {
  synced_at: number | null;
  failed_at: number | null;
  error: string | null;
  options: Options;
}

export async function readMeta(env: Env): Promise<Meta> {
  const r = await env.DB.prepare("SELECT synced_at, failed_at, error, options FROM todo_meta WHERE id = 1").first<{
    synced_at: number | null;
    failed_at: number | null;
    error: string | null;
    options: string | null;
  }>();
  let options: Partial<Options> = {};
  try {
    options = JSON.parse(r?.options ?? "{}");
  } catch {}
  return {
    synced_at: r?.synced_at ?? null,
    failed_at: r?.failed_at ?? null,
    error: r?.error ?? null,
    options: { statuses: options.statuses ?? [], teams: options.teams ?? [], assignees: options.assignees ?? [] }
  };
}

export const readItems = async (env: Env) =>
  (await env.DB.prepare(`SELECT ${COLS.join(", ")} FROM todo_items`).all<Row>()).results.map(fromRow);

// Fetches the whole data source and swaps the copy. At most one sync a minute across all
// instances; a failure keeps the last copy and is shown on the admin page.
export async function syncTodo(env: Env, now: number): Promise<boolean> {
  const claim = await env.DB.prepare(
    `UPDATE todo_meta SET syncing_at = ?1 WHERE id = 1
       AND (synced_at IS NULL OR synced_at < ?2) AND (syncing_at IS NULL OR syncing_at < ?2)`
  )
    .bind(now, now - MINUTE)
    .run();
  if (!claim.meta.changes) return false;
  try {
    const schema = await getSchema(env);
    const items = await queryAll(env, schema);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM todo_items"),
      env.DB.prepare(UPSERT).bind(JSON.stringify(items)),
      env.DB.prepare("UPDATE todo_meta SET synced_at = ?, syncing_at = NULL, options = ? WHERE id = 1").bind(now, JSON.stringify(schema.options))
    ]);
    return true;
  } catch (e) {
    if (!(e instanceof NotionError)) throw e;
    log("todo sync failed", { error: e.message });
    await env.DB.prepare("UPDATE todo_meta SET syncing_at = NULL, failed_at = ?, error = ? WHERE id = 1").bind(now, e.message).run();
    return false;
  }
}

export interface Change {
  page_id: string;
  user_name: string;
  from_status: string | null;
  to_status: string;
  at: number;
}

export interface Person {
  notion_name: string;
  user_id: string;
}

export interface HubUser {
  id: string;
  name: string;
}

// Who a Notion assignee is on the hub: the admin's pick, else the hub user with the same nickname.
export function ownerOf(name: string, people: Person[], users: HubUser[]): string | null {
  const set = people.find((p) => p.notion_name === name);
  if (set) return set.user_id;
  return users.find((u) => u.name === name)?.id ?? null;
}

export interface TodoData {
  items: TodoItem[];
  options: Options;
  me: string[]; // my Notion names
  myTeams: string[];
  changes: Map<string, Change[]>;
  today: string; // KST YYYY-MM-DD
}

export const kstDay = (now: number) => new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);

export const teamsOf = (s: string | null | undefined) => list(s);

const LOG_PER_ITEM = 5;

export async function loadTodo(env: Env, session: Session, now: number, ctx?: ExecutionContext): Promise<TodoData> {
  const read = () => Promise.all([readMeta(env), readItems(env)]);
  const [[meta0, items0], people, users, changes] = await Promise.all([
    read(),
    env.DB.prepare("SELECT notion_name, user_id FROM todo_people").all<Person>(),
    env.DB.prepare("SELECT id, name FROM users").all<HubUser>(),
    env.DB.prepare("SELECT page_id, user_name, from_status, to_status, at FROM todo_changes ORDER BY at DESC LIMIT 500").all<Change>()
  ]);
  let meta = meta0;
  let items = items0;
  if (meta.synced_at === null) {
    // Nothing to show yet: wait for the first copy.
    if (await syncTodo(env, now)) [meta, items] = await read();
  } else if (meta.synced_at < now - MINUTE) {
    const job = syncTodo(env, now);
    if (ctx) ctx.waitUntil(job);
    else await job;
  }

  const byPage = new Map<string, Change[]>();
  for (const c of changes.results) {
    const l = byPage.get(c.page_id) ?? [];
    if (l.length < LOG_PER_ITEM) l.push(c);
    byPage.set(c.page_id, l);
  }
  const names = new Set([...meta.options.assignees, ...items.flatMap((x) => x.assignees)]);
  const me = [...names].filter((n) => ownerOf(n, people.results, users.results) === session.userId);
  return { items, options: meta.options, me, myTeams: teamsOf(session.teams), changes: byPage, today: kstDay(now) };
}

export async function lateCount(env: Env, now: number): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM todo_items
      WHERE (status IS NULL OR status NOT IN (?1, ?2)) AND due_start IS NOT NULL AND substr(due_start, 1, 10) < ?3`
  )
    .bind(HELD, DONE, kstDay(now))
    .first<{ n: number }>();
  return r?.n ?? 0;
}

const stamp = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

// "10/20 14:03"
export function kstStamp(ms: number): string {
  const p = Object.fromEntries(stamp.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

export type ChangeResult =
  | { status: 200 | 409; item: TodoItem }
  | { status: 400 | 404 | 502; item?: undefined };

// The status is checked against Notion first, so a change made there meanwhile isn't overwritten.
export async function changeStatus(env: Env, session: Session, input: unknown, now: number): Promise<ChangeResult> {
  const { page, from, to } = (input ?? {}) as Record<string, unknown>;
  if (typeof page !== "string" || typeof to !== "string" || (from !== null && typeof from !== "string")) return { status: 400 };
  const allowed = (await readMeta(env)).options.statuses;
  if (!(allowed.length ? allowed : STATUSES).includes(to)) return { status: 400 };
  if (!(await env.DB.prepare("SELECT 1 FROM todo_items WHERE page_id = ?").bind(page).first())) return { status: 404 };

  let item: TodoItem | null;
  try {
    const current = await getPage(env, page);
    if (!inSource(env, current)) return { status: 404 };
    item = toItem(current);
    if (!item) {
      await env.DB.prepare("DELETE FROM todo_items WHERE page_id = ?").bind(page).run();
      return { status: 404 };
    }
    if (item.status !== from) {
      await env.DB.prepare(UPSERT).bind(JSON.stringify([item])).run();
      return { status: 409, item };
    }
    if (from === to) return { status: 200, item };

    const props: Record<string, unknown> = {
      [PROPS.status]: { status: { name: to } },
      [PROPS.hub_change]: {
        rich_text: [{ type: "text", text: { content: `${session.name} ${kstStamp(now)} ${from ?? "없음"}→${to}` } }]
      }
    };
    if (to === DONE && !item.done_on) props[PROPS.done_on] = { date: { start: kstDay(now) } };
    item = toItem(await updatePage(env, page, props)) ?? { ...item, status: to };
  } catch (e) {
    if (!(e instanceof NotionError)) throw e;
    log("todo status failed", { page, error: e.message });
    return { status: 502 };
  }

  await env.DB.batch([
    env.DB.prepare(UPSERT).bind(JSON.stringify([item])),
    env.DB.prepare("INSERT INTO todo_changes (page_id, user_id, user_name, from_status, to_status, at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      page,
      session.userId,
      session.name,
      from,
      to,
      now
    )
  ]);
  log("todo status", { page, user: session.userId, from, to });
  return { status: 200, item };
}
