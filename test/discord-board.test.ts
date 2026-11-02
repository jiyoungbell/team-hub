import { beforeEach, describe, expect, it, vi } from "vitest";
import { postBoard, renderBoard } from "../src/discord-board";
import type { Env } from "../src/env";
import type { TodoItem } from "../src/notion";
import { testEnv } from "./helpers";

const HUB = "https://team.rescene-remine.com";
// 2026-11-02 10:00 KST
const NOW = Date.UTC(2026, 10, 2, 1, 0);
const TODAY = "2026-11-02";

const item = (page_id: string, f: Partial<TodoItem>): TodoItem => ({
  page_id,
  title: page_id,
  status: "시작 전",
  teams: [],
  assignees: [],
  category: null,
  due_start: null,
  due_end: null,
  stage: null,
  next_action: null,
  memo: null,
  basis: null,
  started: null,
  first_seen: null,
  done_on: null,
  hub_change: null,
  url: "u",
  edited_at: "2026-11-01T00:00:00.000Z",
  ...f
});

const ITEMS = [
  item("late", { title: "FLAREU 인증 인계", teams: ["SNS"], assignees: ["앵도"], due_start: "2026-10-16" }),
  item("today", { title: "X 공지 백업 담당 지정", teams: ["SNS"], assignees: ["센마인"], due_start: TODAY, status: "진행 중" }),
  item("timed", { title: "굿즈 *시안* 확인", teams: ["디자인"], due_start: "2026-11-02T18:00" }),
  item("soon", { title: "팬싸 응모 안내문", teams: ["총무"], due_start: "2026-11-05" }),
  item("undated", { title: "음악방송 투표 가이드", teams: ["디자인"] }),
  item("done", { title: "회고 정리", status: "완료", done_on: TODAY }),
  item("held", { title: "보류된 일", status: "보류", teams: ["총무"], due_start: TODAY })
];

describe("discord board", () => {
  it("lays out today, the week ahead and each team, linking to the hub at the end", () => {
    const msgs = renderBoard(ITEMS, ["SNS", "디자인", "총무"], TODAY, HUB);
    const embeds = msgs.flatMap((m) => m.embeds);
    const [today, week] = embeds;
    expect(today!.title).toBe("11월 2일 월요일");
    expect(today!.description).toContain("**밀린 일 1**\n- FLAREU 인증 인계 · 앵도 · SNS · **17일 지남**");
    expect(today!.description).toContain("**오늘 할 일 2**\n- X 공지 백업 담당 지정 · 센마인 · SNS · 진행 중\n- 굿즈 \\*시안\\* 확인 · 디자인 · 18:00");
    expect(today!.description).toContain("**오늘 끝낸 일 1**\n- ~~회고 정리~~");
    expect(today!.description).not.toContain("보류된 일");
    expect(week!.title).toBe("다가오는 일");
    expect(week!.description).toBe("**11/5 목**\n- 팬싸 응모 안내문 · 총무");
    expect(embeds.map((e) => e.title).slice(2)).toEqual(["SNS · 2", "디자인 · 2", "총무 · 1"]);
    expect(embeds.find((e) => e.title === "총무 · 1")!.description.startsWith("- 팬싸 응모 안내문 · D-3\n-# 보류 1\n\n[")).toBe(true);
    expect(embeds.at(-1)!.description.endsWith("\n\n[team.rescene-remine.com/todo](https://team.rescene-remine.com/todo) 에서 추가·수정")).toBe(true);
  });

  it("splits a long board over messages within Discord's limits", () => {
    const many = Array.from({ length: 400 }, (_, i) => item(`p${i}`, { title: `할 일 ${i} `.repeat(4), teams: [["SNS", "디자인", "총무", "개발"][i % 4]!], due_start: TODAY }));
    const msgs = renderBoard(many, [], TODAY, HUB);
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) {
      expect(m.embeds.length).toBeLessThanOrEqual(10);
      expect(m.embeds.reduce((n, e) => n + e.title.length + e.description.length, 0)).toBeLessThanOrEqual(6000);
      for (const e of m.embeds) expect(e.description.length).toBeLessThanOrEqual(4096);
    }
    expect(msgs[0]!.embeds[0]!.description).toMatch(/외 \d+개/);
  });
});

describe("posting", () => {
  let env: Env;
  let calls: { method: string; path: string; body?: { embeds: { description: string }[] } }[];
  let gone: Set<string>;
  let n: number;

  beforeEach(async () => {
    env = { ...(await testEnv()), DISCORD_BOT_TOKEN: "bot-token\n", DISCORD_TODO_CHANNEL: "chan" };
    await env.DB.prepare("UPDATE todo_meta SET synced_at = ?, options = ? WHERE id = 1").bind(NOW, JSON.stringify({ statuses: [], teams: ["SNS"], assignees: [] })).run();
    await env.DB.prepare("INSERT INTO todo_items (page_id, title, status, teams, assignees, due_start, url, edited_at) VALUES ('a', '첫 일', '시작 전', '[\"SNS\"]', '[]', ?, 'u', 'e')").bind(TODAY).run();
    calls = [];
    gone = new Set();
    n = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bot bot-token");
      const path = url.pathname.replace("/api/v10", "");
      calls.push({ method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (init?.method === "POST") return Response.json({ id: `m${++n}` });
      if (gone.has(path.split("/").at(-1)!)) return Response.json({ code: 10008 }, { status: 404 });
      return Response.json({});
    });
  });

  it("posts once, then moves to the bottom only when the board changed", async () => {
    await postBoard(env, NOW);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /channels/chan/messages"]);
    expect(calls[0]!.body!.embeds[0]!.description).toContain("첫 일");

    calls = [];
    await postBoard(env, NOW + 60_000);
    expect(calls).toEqual([]);

    // The new one goes in first, so the channel is never without a board.
    await env.DB.prepare("UPDATE todo_items SET title = '바뀐 일'").run();
    await postBoard(env, NOW + 120_000);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /channels/chan/messages", "DELETE /channels/chan/messages/m1"]);
    expect(calls[0]!.body!.embeds[0]!.description).toContain("바뀐 일");
    expect((await env.DB.prepare("SELECT message_id FROM discord_board").all()).results).toEqual([{ message_id: "m2" }]);
  });

  it("doesn't mind an old message already deleted by hand", async () => {
    await postBoard(env, NOW);
    gone.add("m1");
    await env.DB.prepare("UPDATE todo_items SET title = '바뀐 일'").run();
    await postBoard(env, NOW + 60_000);
    expect((await env.DB.prepare("SELECT message_id FROM discord_board").first())!.message_id).toBe("m2");
    expect((await env.DB.prepare("SELECT busy_at FROM discord_meta").first())!.busy_at).toBeNull();
  });

  it("does nothing until the bot and channel are set, or while another run is going", async () => {
    await postBoard({ ...env, DISCORD_TODO_CHANNEL: undefined }, NOW);
    await env.DB.prepare("UPDATE discord_meta SET busy_at = ?").bind(NOW - 10_000).run();
    await postBoard(env, NOW);
    expect(calls).toEqual([]);
  });
});
