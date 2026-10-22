import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";
import { kstDate, toItem } from "../src/notion";
import { syncTodo } from "../src/todo";
import { cookieOf, FakeDiscord, FakeNotion, notionPage, ROLE, testEnv } from "./helpers";

const HUB = "https://team.rescene-remine.com";
const ME = "111111111111111111";
const MEMBER = "333333333333333333";
// 2026-10-20 14:03 KST
const NOW = Date.UTC(2026, 9, 20, 5, 3);

const A = "3fe1046f-a724-8194-b2b1-ca371ce8c0fe";
const B = "3fe1046f-a724-8194-b2b1-ca371ce8c0ff";
const C = "3fe1046f-a724-8194-b2b1-ca371ce8c100";

let env: Env;
let discord: FakeDiscord;
let notion: FakeNotion;
let pending: Promise<unknown>[];
const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext;

const call = (path: string, init: RequestInit & { cookie?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return worker.fetch(new Request(`${HUB}${path}`, { ...init, headers, redirect: "manual" }) as Parameters<typeof worker.fetch>[0], env, ctx);
};
const html = async (path: string, cookie: string | null) => (await call(path, { cookie })).text();

const post = (path: string, cookie: string | null, fields: Record<string, string>, origin = HUB) =>
  call(path, { method: "POST", cookie, headers: { origin }, body: new URLSearchParams(fields) });

const send = (path: string, cookie: string | null, body: unknown, origin = HUB) =>
  call(path, { method: "POST", cookie, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const setStatus = (cookie: string | null, body: unknown, origin = HUB) => send("/todo/status", cookie, body, origin);

type Detail = { t: string; s: string; who: string[]; teams: string[]; ds: string | null; log: string[] };
type Answer = { ok: boolean; key?: string; items: Record<string, Detail>; boards: string; pick: { names: string[]; mine: string } };
const answer = async (res: Response) => (await res.json()) as Answer;
const keyOf = (id: string) => id.replace(/-/g, "");
const lastPatch = () => notion.calls.filter((c) => c.method === "PATCH").at(-1)!.body!;

async function sessionOf(userId: string): Promise<string | null> {
  const start = await call("/login");
  const state = new URL(start.headers.get("location")!).searchParams.get("state");
  const code = `code-${userId}-${Math.random()}`;
  discord.codes.set(code, userId);
  return cookieOf(await call(`/auth/callback?code=${code}&state=${state}`, { cookie: cookieOf(start, "__Host-oauth") }), "__Host-session");
}

const notionCalls = (method: string, part: string) => notion.calls.filter((c) => c.method === method && c.path.includes(part)).length;

// The column for `name` in one of the two boards.
function column(page: string, board: "team" | "person", name: string): string {
  const b = page.slice(page.indexOf(`data-board="${board}"`));
  const start = b.indexOf(`data-col="${name}"`);
  if (start < 0) return "";
  const rest = b.slice(start);
  const end = rest.indexOf('<div class="col"', 1);
  return end < 0 ? rest : rest.slice(0, end);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  env = await testEnv();
  discord = new FakeDiscord();
  discord.users.set(ME, { id: ME, nick: "센마인", roles: [ROLE] });
  discord.users.set(MEMBER, { id: MEMBER, nick: "앵도", roles: [ROLE] });
  notion = new FakeNotion();
  pending = [];
  notion.add(A, { title: "MAMA 1차 인증 운영", status: "진행 중", teams: ["총대", "SNS"], due: "2026-10-22T23:59:00.000+09:00", stage: "1차 인증 받는 중" });
  notion.add(B, { title: "음악방송 투표 가이드", status: "진행 중", teams: ["디자인"], who: ["앵도"], stage: "재편집", next: "평일 마무리" });
  notion.add(C, { title: "FLAREU 인증 인계", status: "시작 전", teams: ["SNS"], due: "2026-10-16" });
  notion.add("empty-row", { title: "", status: "보류" });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.host === "api.notion.com") return notion.fetch(input, init);
    if (url.pathname === "/_auth/health") return new Response(null, { status: 200 });
    return discord.fetch(input, init);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("notion copy", () => {
  it("reads dates in KST and skips untitled rows", () => {
    expect(kstDate("2026-11-03T08:00:00.000Z")).toBe("2026-11-03T17:00");
    expect(kstDate("2026-10-22")).toBe("2026-10-22");
    expect(toItem(notionPage("x", { title: "  " }))).toBeNull();
    expect(toItem(notionPage("x", { title: "t", who: ["앵도"] }))).toMatchObject({ title: "t", assignees: ["앵도"], basis: "근거" });
  });

  it("copies the data source on the first visit, asking only for the properties it uses", async () => {
    const sess = await sessionOf(ME);
    const page = await html("/todo", sess);
    expect(page).toContain("MAMA 1차 인증 운영");
    expect(page).toContain("음악방송 투표 가이드");
    const rows = await env.DB.prepare("SELECT page_id, due_start, teams FROM todo_items ORDER BY page_id").all();
    expect(rows.results).toEqual([
      { page_id: A, due_start: "2026-10-22T23:59", teams: '["총대","SNS"]' },
      { page_id: B, due_start: null, teams: '["디자인"]' },
      { page_id: C, due_start: "2026-10-16", teams: '["SNS"]' }
    ]);
    const query = notion.calls.find((c) => c.path.includes("/query"))!;
    expect(query.path).toContain("filter_properties[]=title");
    expect(query.path.match(/filter_properties/g)!.length).toBe(14);
  });

  it("pages through large data sources and drops removed items", async () => {
    for (let i = 0; i < 130; i++) notion.add(`p${i}`, { title: `항목 ${i}`, status: "보류" });
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    expect(notionCalls("POST", "/query")).toBe(2);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM todo_items").first())!.n).toBe(133);

    for (let i = 0; i < 130; i++) notion.pages.delete(`p${i}`);
    vi.setSystemTime(NOW + 61_000);
    await html("/todo", sess);
    await Promise.all(pending);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM todo_items").first())!.n).toBe(3);
  });

  it("serves the copy for a minute, then refreshes after the response", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    notion.add(A, { title: "이름 바뀜", status: "진행 중" });

    vi.setSystemTime(NOW + 30_000);
    expect(await html("/todo", sess)).not.toContain("이름 바뀜");
    expect(pending.length).toBe(0);

    vi.setSystemTime(NOW + 61_000);
    expect(await html("/", sess)).not.toContain("이름 바뀜");
    await Promise.all(pending);
    expect(await html("/todo", sess)).toContain("이름 바뀜");
  });

  it("keeps the last copy when Notion fails and shows why on the admin page", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    notion.missing = ["담당자"];
    vi.setSystemTime(NOW + 61_000);
    await html("/todo", sess);
    await Promise.all(pending);
    expect(await html("/todo", sess)).toContain("MAMA 1차 인증 운영");
    expect(await html("/admin", sess)).toContain("속성 없음: 담당자");

    notion.missing = [];
    notion.status = 503;
    vi.setSystemTime(NOW + 122_000);
    await html("/todo", sess);
    await Promise.all(pending);
    expect(await html("/admin", sess)).toContain("HTTP 503");
    expect(await html("/todo", sess)).toContain("MAMA 1차 인증 운영");
  });
});

describe("status changes", () => {
  it("writes the status, the done date and who changed it to Notion", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    const res = await setStatus(sess, { page: A, from: "진행 중", to: "완료" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; items: Record<string, { s: string; log: string[]; done: string }>; boards: string };
    expect(body.ok).toBe(true);
    const key = A.replace(/-/g, "");
    expect(body.items[key]).toMatchObject({ s: "완료", done: "10/20", log: ["센마인 · 10/20 14:03 · 진행 중 → 완료"] });

    const patch = notion.calls.find((c) => c.method === "PATCH")!;
    expect(patch.body!.properties).toEqual({
      상태: { status: { name: "완료" } },
      "허브 변경": { rich_text: [{ type: "text", text: { content: "센마인 10/20 14:03 진행 중→완료" } }] },
      완료일: { date: { start: "2026-10-20" } }
    });
    expect(await env.DB.prepare("SELECT user_id, user_name, field, from_value, to_value FROM todo_changes").first()).toEqual({
      user_id: ME,
      user_name: "센마인",
      field: "status",
      from_value: "진행 중",
      to_value: "완료"
    });
    // Off the board, into the fold.
    const page = await html("/todo", sess);
    expect(column(page, "team", "총대")).toContain("완료 1");
  });

  it("leaves an existing done date alone, also when moving back", async () => {
    notion.add(B, { title: "음악방송 투표 가이드", status: "진행 중", done: "2026-10-08" });
    const sess = await sessionOf(MEMBER);
    await html("/todo", sess);
    await setStatus(sess, { page: B, from: "진행 중", to: "완료" });
    expect(notion.calls.find((c) => c.method === "PATCH")!.body!.properties.완료일).toBeUndefined();
    notion.calls = [];
    await setStatus(sess, { page: B, from: "완료", to: "진행 중" });
    expect(notion.calls.find((c) => c.method === "PATCH")!.body!.properties).not.toHaveProperty("완료일");
    expect(notion.pages.get(B)!.properties.완료일.date.start).toBe("2026-10-08");
  });

  it("does not overwrite a change made in Notion meanwhile", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    notion.pages.get(A)!.properties.상태.status = { name: "보류" };
    const res = await setStatus(sess, { page: A, from: "진행 중", to: "완료" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; items: Record<string, { s: string }> };
    expect(body.ok).toBe(false);
    expect(body.items[A.replace(/-/g, "")]!.s).toBe("보류");
    expect(notionCalls("PATCH", "/pages/")).toBe(0);
    expect((await env.DB.prepare("SELECT status FROM todo_items WHERE page_id = ?").bind(A).first())!.status).toBe("보류");
  });

  it("refuses bad requests", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    expect((await setStatus(null, { page: A, from: "진행 중", to: "완료" })).status).toBe(401);
    expect((await setStatus(sess, { page: A, from: "진행 중", to: "완료" }, "https://jachong.rescene-remine.com")).status).toBe(403);
    expect((await setStatus(sess, { page: A, from: "진행 중", to: "삭제" })).status).toBe(400);
    expect((await setStatus(sess, { page: "other", from: "진행 중", to: "완료" })).status).toBe(404);
    // A page the integration can see but outside the TODO data source.
    notion.add("elsewhere", { title: "다른 곳", status: "진행 중", source: "other-source" });
    await env.DB.prepare("INSERT INTO todo_items (page_id, title, teams, assignees, url, edited_at) VALUES ('elsewhere', 'x', '[]', '[]', 'u', 'e')").run();
    expect((await setStatus(sess, { page: "elsewhere", from: "진행 중", to: "완료" })).status).toBe(404);
    expect(notionCalls("PATCH", "/pages/")).toBe(0);
  });

  it("reports a Notion failure without changing anything", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    notion.status = 502;
    expect((await setStatus(sess, { page: A, from: "진행 중", to: "완료" })).status).toBe(502);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM todo_changes").first()).toEqual({ n: 0 });
  });
});

describe("board", () => {
  it("orders columns with my teams first and folds held and done items", async () => {
    notion.add("held", { title: "보류된 일", status: "보류", teams: ["SNS"] });
    notion.add("undated", { title: "날짜 없는 일", status: "진행 중", teams: ["SNS"] });
    const sess = await sessionOf(ME);
    await post("/settings", sess, {}); // nothing chosen yet
    await html("/todo", sess);
    await post("/settings", sess, { team: "디자인" });
    const page = await html("/todo", sess);
    const team = page.slice(page.indexOf('data-board="team"'), page.indexOf('data-board="person"'));
    const cols = [...team.matchAll(/data-col="([^"]+)"/g)].map((m) => m[1]);
    expect(cols).toEqual(["디자인", "SNS", "총대"]);
    // Overdue first, then by due date.
    const sns = column(page, "team", "SNS");
    expect(sns.indexOf("FLAREU")).toBeLessThan(sns.indexOf("MAMA"));
    expect(sns.indexOf("MAMA")).toBeLessThan(sns.indexOf("날짜 없는 일"));
    expect(sns).toContain("4일 지남");
    expect(sns).toContain('<span class="wait">시작 전</span>');
    expect(sns).toContain("보류 1");
    expect(column(page, "team", "디자인")).toContain("앵도");
  });

  it("puts my own column first by person, matching names by nickname or by the admin's pick", async () => {
    notion.add(A, { title: "MAMA 1차 인증 운영", status: "진행 중", who: ["총대"] });
    const sess = await sessionOf(MEMBER);
    let page = await html("/todo", sess);
    let person = page.slice(page.indexOf('data-board="person"'));
    expect([...person.matchAll(/data-col="([^"]+)"/g)].map((m) => m[1])).toEqual(["앵도", "총대", "담당자 없음"]);

    const admin = await sessionOf(ME);
    expect(await html("/admin", admin)).toContain("자동 · 앵도");
    await post("/admin/todo/people", admin, { name: "총대", user: MEMBER });
    page = await html("/todo", sess);
    person = page.slice(page.indexOf('data-board="person"'));
    expect([...person.matchAll(/data-col="([^"]+)"/g)].map((m) => m[1]).slice(0, 2).sort()).toEqual(["앵도", "총대"]);

    // Members can't edit the pairs.
    expect((await post("/admin/todo/people", sess, { name: "총대", user: "" })).status).toBe(404);
  });

  it("shows overdue counts in the menu and the date rail on home", async () => {
    const sess = await sessionOf(ME);
    const home = await html("/", sess);
    expect(home).toMatch(/<b class="n" data-late>1<\/b>/);
    expect(home).toContain('class="mk late"');
    expect(home).toContain('class="mk"');
    expect(home).toContain("D-2");
    expect(home).not.toContain('data-board="team"');
    expect(await html("/settings", sess)).toMatch(/<b class="n" data-late>1<\/b>/);
  });

  it("keeps the item data from closing its script tag", async () => {
    notion.add(B, { title: "</script><script>alert(1)</script>", status: "진행 중" });
    const page = await html("/todo", await sessionOf(ME));
    const data = page.slice(page.indexOf('id="todo-data">'));
    expect(data.slice(0, data.indexOf("</script>"))).not.toContain("<");
  });
});

describe("settings", () => {
  it("toggles my teams among Notion's teams only", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    await post("/settings", sess, { team: "개발" });
    await post("/settings", sess, { team: "SNS" });
    await post("/settings", sess, { team: "없는 팀" });
    expect((await env.DB.prepare("SELECT teams FROM users WHERE id = ?").bind(ME).first())!.teams).toBe('["개발","SNS"]');
    expect(await html("/settings", sess)).toContain('value="개발" aria-pressed="true"');
    await post("/settings", sess, { team: "개발" });
    expect((await env.DB.prepare("SELECT teams FROM users WHERE id = ?").bind(ME).first())!.teams).toBe('["SNS"]');
  });
});

describe("adding", () => {
  it("creates the item in Notion with who added it, and shows it", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    const res = await send("/todo/items", sess, { title: "  포스터   시안 올리기 ", assignees: ["센마인", "앵도"], teams: ["디자인"], due: "2026-10-25" });
    expect(res.status).toBe(200);
    const body = await answer(res);
    expect(body.ok).toBe(true);
    const create = notion.calls.find((c) => c.method === "POST" && c.path === "/v1/pages")!;
    expect(create.body).toEqual({
      parent: { type: "data_source_id", data_source_id: env.NOTION_TODO_SOURCE },
      properties: {
        "할 일": { title: [{ type: "text", text: { content: "포스터 시안 올리기" } }] },
        상태: { status: { name: "시작 전" } },
        "작업 팀": { multi_select: [{ name: "디자인" }] },
        담당자: { multi_select: [{ name: "센마인" }, { name: "앵도" }] },
        마감일: { date: { start: "2026-10-25" } },
        "허브 변경": { rich_text: [{ type: "text", text: { content: "센마인 10/20 14:03 추가" } }] }
      }
    });
    expect(body.items[body.key!]).toMatchObject({ t: "포스터 시안 올리기", s: "시작 전", who: ["센마인", "앵도"], log: ["센마인 · 10/20 14:03 · 추가"] });
    expect(column(body.boards, "team", "디자인")).toContain("포스터 시안 올리기");
    expect(column(await html("/todo", sess), "person", "앵도")).toContain("포스터 시안 올리기");
  });

  it("offers Notion's names and hub users, mine first", async () => {
    const sess = await sessionOf(MEMBER);
    const page = await html("/todo", sess);
    const data = JSON.parse(page.slice(page.indexOf('id="todo-data">') + 15, page.indexOf("</script>", page.indexOf('id="todo-data">'))));
    expect(data.pick.mine).toBe("앵도");
    expect(data.pick.names[0]).toBe("앵도");
    expect(data.pick.names).toEqual(expect.arrayContaining(["센마인", "총대"]));
    expect(page).toContain('placeholder="할 일 추가"');
  });

  it("refuses an empty title and names or teams that aren't on the list", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    const ok = { title: "x", assignees: [], teams: [], due: null };
    expect((await send("/todo/items", sess, { ...ok, title: "   " })).status).toBe(400);
    expect((await send("/todo/items", sess, { ...ok, title: "가".repeat(201) })).status).toBe(400);
    expect((await send("/todo/items", sess, { ...ok, assignees: ["모르는 사람"] })).status).toBe(400);
    expect((await send("/todo/items", sess, { ...ok, teams: ["없는 팀"] })).status).toBe(400);
    expect((await send("/todo/items", sess, { ...ok, due: "10/25" })).status).toBe(400);
    expect((await send("/todo/items", sess, ok, "https://jachong.rescene-remine.com")).status).toBe(403);
    expect((await send("/todo/items", null, ok)).status).toBe(401);
    expect(notion.calls.filter((c) => c.path === "/v1/pages").length).toBe(0);
  });

  it("waits once when Notion says slow down", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    notion.limited = 1;
    expect((await send("/todo/items", sess, { title: "x", assignees: [], teams: [], due: null })).status).toBe(200);
    notion.limited = 2;
    expect((await send("/todo/items", sess, { title: "y", assignees: [], teams: [], due: null })).status).toBe(502);
  });
});

describe("editing", () => {
  it("renames, keeping a title changed in Notion meanwhile", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    let body = await answer(await send("/todo/edit", sess, { page: B, field: "title", from: "음악방송 투표 가이드", to: "음방 투표 가이드" }));
    expect(lastPatch().properties).toEqual({
      "할 일": { title: [{ type: "text", text: { content: "음방 투표 가이드" } }] },
      "허브 변경": { rich_text: [{ type: "text", text: { content: "센마인 10/20 14:03 제목 변경" } }] }
    });
    expect(body.items[keyOf(B)]).toMatchObject({ t: "음방 투표 가이드", log: ["센마인 · 10/20 14:03 · 제목 변경"] });

    notion.pages.get(B)!.properties["할 일"].title = [{ plain_text: "노션에서 바꿈" }];
    const res = await send("/todo/edit", sess, { page: B, field: "title", from: "음방 투표 가이드", to: "또 바꿈" });
    expect(res.status).toBe(409);
    body = await answer(res);
    expect(body.items[keyOf(B)]!.t).toBe("노션에서 바꿈");
  });

  it("applies only the names added and removed, so a change made meanwhile stays", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    // Someone adds 총대 in Notion while the window shows only 앵도.
    notion.pages.get(B)!.properties.담당자.multi_select = [{ name: "앵도" }, { name: "총대" }];
    const body = await answer(await send("/todo/edit", sess, { page: B, field: "assignees", from: ["앵도"], to: ["센마인"] }));
    expect(lastPatch().properties.담당자).toEqual({ multi_select: [{ name: "총대" }, { name: "센마인" }] });
    expect(lastPatch().properties["허브 변경"].rich_text[0].text.content).toBe("센마인 10/20 14:03 담당자→총대, 센마인");
    expect(body.items[keyOf(B)]).toMatchObject({ who: ["총대", "센마인"], log: ["센마인 · 10/20 14:03 · 담당자 → 총대, 센마인"] });

    await send("/todo/edit", sess, { page: B, field: "teams", from: ["디자인"], to: [] });
    expect(lastPatch().properties["작업 팀"]).toEqual({ multi_select: [] });
    expect((await send("/todo/edit", sess, { page: B, field: "teams", from: [], to: ["없는 팀"] })).status).toBe(400);
  });

  it("sets and clears the due date", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    // A due date with a time compares by its day.
    let body = await answer(await send("/todo/edit", sess, { page: A, field: "due", from: "2026-10-22T23:59", to: "2026-10-24" }));
    expect(lastPatch().properties.마감일).toEqual({ date: { start: "2026-10-24" } });
    expect(lastPatch().properties["허브 변경"].rich_text[0].text.content).toBe("센마인 10/20 14:03 마감일→10/24");
    expect(body.items[keyOf(A)]!.ds).toBe("2026-10-24");
    body = await answer(await send("/todo/edit", sess, { page: A, field: "due", from: "2026-10-24", to: null }));
    expect(lastPatch().properties.마감일).toEqual({ date: null });
    expect(body.items[keyOf(A)]).toMatchObject({ ds: null, log: ["센마인 · 10/20 14:03 · 마감 → 없음", "센마인 · 10/20 14:03 · 마감 → 10/24"] });
    expect((await send("/todo/edit", sess, { page: A, field: "due", from: "2026-10-24", to: "2026-10-30" })).status).toBe(409);
    expect((await send("/todo/edit", sess, { page: A, field: "memo", from: "", to: "x" })).status).toBe(400);
    expect((await send("/todo/edit", sess, { page: "other", field: "title", from: "a", to: "b" })).status).toBe(404);
  });
});

describe("deleting", () => {
  it("moves the item to Notion's trash and brings it back", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    let res = await send("/todo/delete", sess, { page: B });
    expect(res.status).toBe(200);
    expect(lastPatch()).toEqual({ properties: { "허브 변경": { rich_text: [{ type: "text", text: { content: "센마인 10/20 14:03 삭제" } }] } }, in_trash: true });
    expect(notion.pages.get(B)!.in_trash).toBe(true);
    expect((await answer(res)).items[keyOf(B)]).toBeUndefined();
    expect(await html("/todo", sess)).not.toContain("음악방송 투표 가이드");

    res = await send("/todo/restore", sess, { page: B });
    expect(res.status).toBe(200);
    expect(notion.pages.get(B)!.in_trash).toBe(false);
    expect((await answer(res)).items[keyOf(B)]!.log).toEqual(["센마인 · 10/20 14:03 · 되돌림", "센마인 · 10/20 14:03 · 삭제"]);
    expect(await html("/todo", sess)).toContain("음악방송 투표 가이드");
  });

  it("only restores pages deleted from the hub", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    expect((await send("/todo/restore", sess, { page: A })).status).toBe(404);
    expect((await send("/todo/delete", sess, { page: "other" })).status).toBe(404);
    expect(notionCalls("PATCH", "/pages/")).toBe(0);
  });
});

describe("sync and hub changes", () => {
  it("leaves pages the hub changed after the sync started alone, and drops them once a later sync agrees", async () => {
    const sess = await sessionOf(ME);
    await html("/todo", sess);
    const { key } = await answer(await send("/todo/items", sess, { title: "새로 넣은 일", assignees: [], teams: [], due: null }));
    const id = [...notion.pages.keys()].find((k) => keyOf(k) === key)!;
    // A sync that fetched just before the add: the new page isn't in it, B has a new title.
    notion.pages.delete(id);
    notion.add(B, { title: "노션에서 바뀐 제목", status: "진행 중" });
    await env.DB.prepare("UPDATE todo_meta SET synced_at = 0").run();
    expect(await syncTodo(env, NOW - 1)).toBe(true);
    const titles = async () => (await env.DB.prepare("SELECT title FROM todo_items ORDER BY title").all<{ title: string }>()).results.map((r) => r.title);
    expect(await titles()).toEqual(expect.arrayContaining(["새로 넣은 일", "노션에서 바뀐 제목"]));

    // Really gone from Notion: a sync that started after the add follows Notion.
    expect(await syncTodo(env, NOW + 61_000)).toBe(true);
    expect(await titles()).not.toContain("새로 넣은 일");
  });

  it("serves the board as JSON for a tab coming back", async () => {
    const sess = await sessionOf(ME);
    expect((await call("/todo/board")).status).toBe(401);
    const res = await call("/todo/board", { cookie: sess });
    expect(res.status).toBe(200);
    const body = await answer(res);
    expect(body.items[keyOf(A)]!.t).toBe("MAMA 1차 인증 운영");
    expect(body.boards).toContain('data-board="team"');
  });
});
