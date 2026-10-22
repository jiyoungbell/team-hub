import { log, MINUTE, type Env } from "./env";
import {
  createPage,
  getPage,
  getSchema,
  inSource,
  NotionError,
  PROPS,
  queryAll,
  richText,
  toItem,
  updatePage,
  type Options,
  type TodoItem
} from "./notion";
import type { Session } from "./session";
import { DONE, HELD, kstDay, kstStamp, monthDay, TEAM_ORDER, type Change, type Field, type TodoData } from "./todo-common";

export { DONE, HELD, kstDay, kstStamp, TEAM_ORDER, type Change, type TodoData } from "./todo-common";

export const STATUSES = ["시작 전", "진행 중", "보류", "완료"];
const NEW = "시작 전";
const MAX_TITLE = 200;

// Notion's team options in board order.
export const orderTeams = (teams: string[]) => [...TEAM_ORDER.filter((t) => teams.includes(t)), ...teams.filter((t) => !TEAM_ORDER.includes(t))];

const COLS = [
  "page_id", "title", "status", "teams", "assignees", "category", "due_start", "due_end", "stage", "next_action",
  "memo", "basis", "started", "first_seen", "done_on", "hub_change", "url", "edited_at"
] as const;

// One statement for any number of rows: the items go in as a single JSON parameter.
const PICK = COLS.map((c) => `json_extract(value, '$.${c}')`).join(", ");
const UPSERT = `INSERT OR REPLACE INTO todo_items (${COLS.join(", ")}) SELECT ${PICK} FROM json_each(?)`;

// A sync replaces the copy with what it fetched, except pages the hub changed since the sync
// started (its copy of those is older), and rows that are already the same (fewer D1 writes).
const KEY = "json_extract(value, '$.page_id')";
const CHANGED_SINCE = "SELECT page_id FROM todo_changes WHERE at >= ?2";
const SYNC_DELETE = `DELETE FROM todo_items WHERE page_id NOT IN (SELECT ${KEY} FROM json_each(?1)) AND page_id NOT IN (${CHANGED_SINCE})`;
const SYNC_UPSERT = `INSERT OR REPLACE INTO todo_items (${COLS.join(", ")}) SELECT ${PICK} FROM json_each(?1)
  WHERE ${KEY} NOT IN (${CHANGED_SINCE})
    AND NOT EXISTS (SELECT 1 FROM todo_items t WHERE ${COLS.map((c) => `t.${c} IS json_extract(value, '$.${c}')`).join(" AND ")})`;

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
    const items = JSON.stringify(await queryAll(env, schema));
    await env.DB.batch([
      env.DB.prepare(SYNC_DELETE).bind(items, now),
      env.DB.prepare(SYNC_UPSERT).bind(items, now),
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

const isOpen = (x: TodoItem) => x.status !== HELD && x.status !== DONE;

// Names to pick as assignees: Notion's options, names already on items and every hub user (by
// the Notion name the admin matched, else the nickname). Mine first, then busiest, then 가나다.
// Notion doesn't take commas in option names.
export function assigneeNames(items: TodoItem[], options: Options, people: Person[], users: HubUser[], myId: string) {
  const nameOf = (u: HubUser) => people.find((p) => p.user_id === u.id)?.notion_name ?? u.name;
  const open = new Map<string, number>();
  for (const x of items) for (const w of x.assignees) open.set(w, (open.get(w) ?? 0) + (isOpen(x) ? 1 : 0));
  const me = users.find((u) => u.id === myId);
  const mine = me ? nameOf(me) : "";
  const rest = [...new Set([...options.assignees, ...items.flatMap((x) => x.assignees), ...users.map(nameOf)])]
    .filter((n) => n && n !== mine && !n.includes(","))
    .sort((a, b) => (open.get(b) ?? 0) - (open.get(a) ?? 0) || a.localeCompare(b, "ko"));
  return { names: mine && !mine.includes(",") ? [mine, ...rest] : rest, mine };
}

export const teamsOf = (s: string | null | undefined) => list(s);

const LOG_PER_ITEM = 5;

const readPeople = (env: Env) =>
  Promise.all([
    env.DB.prepare("SELECT notion_name, user_id FROM todo_people").all<Person>(),
    env.DB.prepare("SELECT id, name FROM users").all<HubUser>()
  ]).then(([p, u]) => ({ people: p.results, users: u.results }));

export async function loadTodo(env: Env, session: Session, now: number, ctx?: ExecutionContext): Promise<TodoData> {
  const read = () => Promise.all([readMeta(env), readItems(env)]);
  const [[meta0, items0], { people, users }, changes] = await Promise.all([
    read(),
    readPeople(env),
    env.DB.prepare("SELECT page_id, user_name, field, from_value, to_value, at FROM todo_changes ORDER BY at DESC LIMIT 500").all<Change>()
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
  const me = [...names].filter((n) => ownerOf(n, people, users) === session.userId);
  return {
    items,
    options: meta.options,
    me,
    myTeams: teamsOf(session.teams),
    changes: byPage,
    today: kstDay(now),
    ...assigneeNames(items, meta.options, people, users, session.userId),
    teams: orderTeams(meta.options.teams)
  };
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

export type WriteResult = { status: 200 | 409; item?: TodoItem } | { status: 400 | 404 | 502; item?: undefined };

const str = (v: unknown): v is string => typeof v === "string";
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const isDay = (v: unknown): v is string => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const cleanTitle = (v: unknown) => (str(v) ? v.replace(/\s+/g, " ").trim() : "");
const day = (v: string | null | undefined) => v?.slice(0, 10) ?? null;

// `허브 변경` in Notion keeps the last change only: "센마인 10/22 14:03 추가".
const hubNote = (session: Session, now: number, what: string) => ({
  [PROPS.hub_change]: { rich_text: richText(`${session.name} ${kstStamp(now)} ${what}`) }
});

// `at` is taken after Notion has the change, so a sync that fetched before it leaves the page alone.
const logChange = (env: Env, session: Session, page: string, field: Field, from: string | null, to: string | null) =>
  env.DB.prepare("INSERT INTO todo_changes (page_id, user_id, user_name, field, from_value, to_value, at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
    page,
    session.userId,
    session.name,
    field,
    from,
    to,
    Date.now()
  );

const saved = (env: Env, session: Session, item: TodoItem, field: Field, from: string | null, to: string | null) =>
  env.DB.batch([env.DB.prepare(UPSERT).bind(JSON.stringify([item])), logChange(env, session, item.page_id, field, from, to)]);

const inCopy = async (env: Env, page: string) => !!(await env.DB.prepare("SELECT 1 FROM todo_items WHERE page_id = ?").bind(page).first());

// The page as Notion has it now, if it is still a TODO item. One gone from Notion leaves the copy too.
async function current(env: Env, page: string): Promise<TodoItem | null> {
  const p = await getPage(env, page);
  if (!inSource(env, p)) return null;
  const item = toItem(p);
  if (!item) await env.DB.prepare("DELETE FROM todo_items WHERE page_id = ?").bind(page).run();
  return item;
}

// Someone changed it in Notion first: the copy takes Notion's value and the screen shows it.
async function conflict(env: Env, item: TodoItem): Promise<WriteResult> {
  await env.DB.prepare(UPSERT).bind(JSON.stringify([item])).run();
  return { status: 409, item };
}

async function notionWrite(what: string, page: string | null, f: () => Promise<WriteResult>): Promise<WriteResult> {
  try {
    return await f();
  } catch (e) {
    if (!(e instanceof NotionError)) throw e;
    log(`todo ${what} failed`, { page, error: e.message });
    return { status: 502 };
  }
}

async function choices(env: Env, userId: string) {
  const [meta, items, { people, users }] = await Promise.all([readMeta(env), readItems(env), readPeople(env)]);
  return {
    statuses: meta.options.statuses.length ? meta.options.statuses : STATUSES,
    teams: meta.options.teams.length ? meta.options.teams : TEAM_ORDER,
    names: assigneeNames(items, meta.options, people, users, userId).names
  };
}

// The status is checked against Notion first, so a change made there meanwhile isn't overwritten.
export async function changeStatus(env: Env, session: Session, input: unknown, now: number): Promise<WriteResult> {
  const { page, from, to } = (input ?? {}) as Record<string, unknown>;
  if (!str(page) || !str(to) || (from !== null && !str(from))) return { status: 400 };
  const allowed = (await readMeta(env)).options.statuses;
  if (!(allowed.length ? allowed : STATUSES).includes(to)) return { status: 400 };
  if (!(await inCopy(env, page))) return { status: 404 };

  return notionWrite("status", page, async () => {
    let item = await current(env, page);
    if (!item) return { status: 404 };
    if (item.status !== from) return conflict(env, item);
    if (from === to) return { status: 200, item };

    const props: Record<string, unknown> = { [PROPS.status]: { status: { name: to } }, ...hubNote(session, now, `${from ?? "없음"}→${to}`) };
    if (to === DONE && !item.done_on) props[PROPS.done_on] = { date: { start: kstDay(now) } };
    item = toItem(await updatePage(env, page, props)) ?? { ...item, status: to };
    await saved(env, session, item, "status", from, to);
    log("todo status", { page, user: session.userId, from, to });
    return { status: 200, item };
  });
}

// POST /todo/items {title, assignees, teams, due}: a new item, 시작 전.
export async function createItem(env: Env, session: Session, input: unknown, now: number): Promise<WriteResult> {
  const { title, assignees, teams, due } = (input ?? {}) as Record<string, unknown>;
  const t = cleanTitle(title);
  if (!t || t.length > MAX_TITLE || !strs(assignees) || !strs(teams) || !(due == null || isDay(due))) return { status: 400 };
  const c = await choices(env, session.userId);
  const who = [...new Set(assignees)];
  const tms = [...new Set(teams)];
  if (!who.every((n) => c.names.includes(n)) || !tms.every((n) => c.teams.includes(n))) return { status: 400 };

  return notionWrite("create", null, async () => {
    const item = toItem(
      await createPage(env, {
        [PROPS.title]: { title: richText(t) },
        [PROPS.status]: { status: { name: c.statuses.includes(NEW) ? NEW : c.statuses[0]! } },
        [PROPS.teams]: { multi_select: tms.map((name) => ({ name })) },
        [PROPS.assignees]: { multi_select: who.map((name) => ({ name })) },
        ...(due ? { [PROPS.due]: { date: { start: due } } } : {}),
        ...hubNote(session, now, "추가")
      })
    );
    if (!item) return { status: 502 };
    await saved(env, session, item, "create", null, t);
    log("todo create", { page: item.page_id, user: session.userId });
    return { status: 200, item };
  });
}

const SET_FIELDS = { assignees: [PROPS.assignees, "담당자"], teams: [PROPS.teams, "작업 팀"] } as const;

// POST /todo/edit {page, field, from, to}. Title and due date are only written if Notion still
// has what the person saw. Assignees and teams apply what was added and removed to Notion's
// current list, so someone else's change to the same list stays.
export async function editItem(env: Env, session: Session, input: unknown, now: number): Promise<WriteResult> {
  const { page, field, from, to } = (input ?? {}) as Record<string, unknown>;
  if (!str(page)) return { status: 400 };
  if (field === "title") {
    const t = cleanTitle(to);
    if (!str(from) || !t || t.length > MAX_TITLE) return { status: 400 };
  } else if (field === "assignees" || field === "teams") {
    if (!strs(from) || !strs(to)) return { status: 400 };
    const allowed = (await choices(env, session.userId))[field === "teams" ? "teams" : "names"];
    if (!to.filter((n) => !from.includes(n)).every((n) => allowed.includes(n))) return { status: 400 };
  } else if (field === "due") {
    if (!(from === null || str(from)) || !(to === null || isDay(to))) return { status: 400 };
  } else return { status: 400 };
  if (!(await inCopy(env, page))) return { status: 404 };

  return notionWrite("edit", page, async () => {
    const item = await current(env, page);
    if (!item) return { status: 404 };
    let props: Record<string, unknown>;
    let what: string;
    let before: string | null;
    let after: string | null;
    if (field === "title") {
      const t = cleanTitle(to);
      if (item.title !== from) return conflict(env, item);
      if (item.title === t) return { status: 200, item };
      props = { [PROPS.title]: { title: richText(t) } };
      [what, before, after] = ["제목 변경", item.title, t];
    } else if (field === "due") {
      const d = to as string | null;
      if (day(item.due_start) !== day(from as string | null)) return conflict(env, item);
      if (day(item.due_start) === d) return { status: 200, item };
      props = { [PROPS.due]: { date: d ? { start: d } : null } };
      [what, before, after] = [`마감일→${d ? monthDay(d) : "없음"}`, day(item.due_start), d];
    } else {
      const [prop, label] = SET_FIELDS[field];
      const was = item[field];
      const add = (to as string[]).filter((n) => !(from as string[]).includes(n));
      const drop = (from as string[]).filter((n) => !(to as string[]).includes(n));
      const next = [...was.filter((n) => !drop.includes(n)), ...add.filter((n) => !was.includes(n))];
      if (next.length === was.length && next.every((n) => was.includes(n))) return { status: 200, item };
      props = { [prop]: { multi_select: next.map((name) => ({ name })) } };
      [what, before, after] = [`${label}→${next.join(", ") || "없음"}`, was.join(", "), next.join(", ")];
    }
    const updated = toItem(await updatePage(env, page, { ...props, ...hubNote(session, now, what) }));
    if (!updated) return { status: 502 };
    await saved(env, session, updated, field, before, after);
    log("todo edit", { page, user: session.userId, field });
    return { status: 200, item: updated };
  });
}

// POST /todo/delete {page}: into Notion's trash, where it can still be restored.
export async function deleteItem(env: Env, session: Session, input: unknown, now: number): Promise<WriteResult> {
  const { page } = (input ?? {}) as Record<string, unknown>;
  if (!str(page)) return { status: 400 };
  if (!(await inCopy(env, page))) return { status: 404 };

  return notionWrite("delete", page, async () => {
    const item = await current(env, page);
    if (!item) return { status: 404 };
    await updatePage(env, page, hubNote(session, now, "삭제"), { in_trash: true });
    await env.DB.batch([env.DB.prepare("DELETE FROM todo_items WHERE page_id = ?").bind(page), logChange(env, session, page, "delete", item.title, null)]);
    log("todo delete", { page, user: session.userId });
    return { status: 200 };
  });
}

// POST /todo/restore {page}: back out of the trash. Only pages deleted from the hub.
export async function restoreItem(env: Env, session: Session, input: unknown, now: number): Promise<WriteResult> {
  const { page } = (input ?? {}) as Record<string, unknown>;
  if (!str(page)) return { status: 400 };
  if (!(await env.DB.prepare("SELECT 1 FROM todo_changes WHERE page_id = ? AND field = 'delete'").bind(page).first())) return { status: 404 };

  return notionWrite("restore", page, async () => {
    const p = await updatePage(env, page, hubNote(session, now, "되돌림"), { in_trash: false });
    const item = inSource(env, p) ? toItem(p) : null;
    if (!item) return { status: 404 };
    await saved(env, session, item, "restore", null, item.title);
    log("todo restore", { page, user: session.userId });
    return { status: 200, item };
  });
}
