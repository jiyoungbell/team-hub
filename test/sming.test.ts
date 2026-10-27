import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";
import { fitQuery, search } from "../src/melon";
import { cleanInput, clock } from "../src/sming-list";
import { cookieOf, FakeDiscord, ROLE, testEnv } from "./helpers";

const HUB = "https://team.rescene-remine.com";
const ME = "111111111111111111"; // admin
const MEMBER = "333333333333333333";
const OTHER = "444444444444444444";
const NOW = Date.UTC(2026, 9, 27, 5, 3);

let env: Env;
let discord: FakeDiscord;
let melonDown = false;
let melonCalls: string[];
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

const call = (path: string, init: RequestInit & { cookie?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return worker.fetch(new Request(`${HUB}${path}`, { ...init, headers, redirect: "manual" }) as Parameters<typeof worker.fetch>[0], env, ctx);
};
const form = (path: string, cookie: string | null, fields: Record<string, string> = {}, origin = HUB) =>
  call(path, { method: "POST", cookie, headers: { origin }, body: new URLSearchParams(fields) });
const send = (path: string, cookie: string | null, body: unknown, origin = HUB) =>
  call(path, { method: "POST", cookie, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

async function sessionOf(userId: string): Promise<string | null> {
  const start = await call("/login");
  const state = new URL(start.headers.get("location")!).searchParams.get("state");
  const code = `code-${userId}-${Math.random()}`;
  discord.codes.set(code, userId);
  return cookieOf(await call(`/auth/callback?code=${code}&state=${state}`, { cookie: cookieOf(start, "__Host-oauth") }), "__Host-session");
}

const SEARCH = {
  STATUS: "0",
  SONGCONTENTS: [
    { SONGID: "37928381", SONGNAME: "LOVE ATTACK", ARTISTNAME: "RESCENE (리센느)", ALBUMNAME: "SCENEDROME", ALBUMIMG: "https://cdnimg.melon.co.kr/cm2/album/images/115/75/849/11575849_1.jpg?x/melon/resize/40" },
    { SONGID: "37928383", SONGNAME: "Pinball &amp; Me", ARTISTNAME: "RESCENE (리센느)", ALBUMNAME: "SCENEDROME", ALBUMIMG: "http://evil.example/x.jpg" },
    { SONGID: "nope", SONGNAME: "bad" }
  ]
};
const PLAYTIME: Record<string, string> = { "37928381": "182" };

function melon(url: URL): Response {
  melonCalls.push(url.href);
  if (melonDown) return new Response("down", { status: 503 });
  if (url.host === "www.melon.com") return new Response(`smingCallback(${JSON.stringify(SEARCH)});`);
  const id = url.searchParams.get("songId")!;
  if (!PLAYTIME[id]) return Response.json({ response: { RESULTCODE: "0" } });
  return Response.json({ response: { SONGINFO: { SONGID: id, PLAYTIME: PLAYTIME[id] } } });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  env = await testEnv();
  discord = new FakeDiscord();
  discord.users.set(ME, { id: ME, nick: "센마인", roles: [ROLE] });
  discord.users.set(MEMBER, { id: MEMBER, nick: "앵도", roles: [ROLE] });
  discord.users.set(OTHER, { id: OTHER, nick: "리부", roles: [ROLE] });
  melonDown = false;
  melonCalls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.host.endsWith("melon.com")) return melon(url);
    if (url.pathname === "/_auth/health") return new Response(null, { status: 200 });
    return discord.fetch(input, init);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ST = { title: "Star Trace", sec: 179 };
const LA = { title: "LOVE ATTACK", sec: 182, melon: "37928381", artist: "RESCENE (리센느)" };

async function newList(cookie: string | null) {
  const res = await form("/sming-list", cookie);
  expect(res.status).toBe(302);
  return res.headers.get("location")!.split("/").pop()!;
}

describe("melon", () => {
  it("keeps the query to 20 characters not counting spaces", () => {
    expect(fitQuery("Always Remember Us This Way")).toBe("Always Remember Us This");
    expect(fitQuery("리센느 LOVE ATTACK")).toBe("리센느 LOVE ATTACK");
  });

  it("searches, double-encodes and adds play times", async () => {
    const songs = await search("리센느 LOVE");
    expect(melonCalls[0]).toContain(`query=${encodeURIComponent(encodeURIComponent("리센느 LOVE"))}`);
    expect(songs).toEqual([
      { melon: "37928381", title: "LOVE ATTACK", artist: "RESCENE (리센느)", album: "SCENEDROME", cover: "https://cdnimg.melon.co.kr/cm2/album/images/115/75/849/11575849_1.jpg?x/melon/resize/80", sec: 182 },
      { melon: "37928383", title: "Pinball & Me", artist: "RESCENE (리센느)", album: "SCENEDROME", cover: null, sec: null }
    ]);
  });
});

describe("times", () => {
  it("shows minutes, and hours past an hour", () => {
    expect(clock(179)).toBe("02:59");
    expect(clock(3600)).toBe("1:00:00");
    expect(clock(3641)).toBe("1:00:41");
  });
});

describe("save input", () => {
  const ok = { version: 1, name: " 컴백  당일 ", songs: { u1: ST, m37928381: LA, m1: { title: "unused", sec: 1 } }, items: ["u1", "m37928381", "u1"] };

  it("keeps used songs and tidies the name", () => {
    expect(cleanInput(ok)).toEqual({ version: 1, name: "컴백 당일", songs: { u1: ST, m37928381: LA }, items: ["u1", "m37928381", "u1"] });
    expect(cleanInput({ ...ok, name: "" })?.name).toBe("새 슴리");
  });

  it("drops covers from anywhere but Melon", () => {
    expect(cleanInput({ ...ok, songs: { ...ok.songs, u1: { ...ST, cover: "https://evil.example/a.png" } } })?.songs.u1).toEqual(ST);
  });

  it("refuses broken lists", () => {
    expect(cleanInput({ ...ok, items: ["u2"] })).toBeNull();
    expect(cleanInput({ ...ok, items: ["toString"] })).toBeNull();
    expect(cleanInput({ ...ok, songs: { ...ok.songs, u1: { title: "x", sec: 0 } } })).toBeNull();
    expect(cleanInput({ ...ok, songs: { ...ok.songs, u1: { title: " ", sec: 10 } } })).toBeNull();
    expect(cleanInput({ ...ok, songs: { ...ok.songs, u1: { ...ST, melon: "abc" } } })).toBeNull();
    expect(cleanInput({ ...ok, items: Array(301).fill("u1") })).toBeNull();
    expect(cleanInput({ ...ok, version: "1" })).toBeNull();
  });
});

describe("/sming-list", () => {
  it("works without signing in", async () => {
    const id = await newList(null);
    const page = await (await call(`/sming-list/${id}`)).text();
    expect(page).toContain('value="새 슴리"');
    expect(page).not.toContain("디스코드로 로그인");
    expect(page).not.toContain("chat-widget.js");
    expect(page).not.toContain("/delete");
    expect((await send(`/sming-list/${id}`, null, { version: 1, name: "비로그인", songs: { u1: ST }, items: ["u1"] })).status).toBe(200);
    expect((await call("/sming-list/search?q=LOVE")).status).toBe(200);
    const index = await (await call("/sming-list")).text();
    expect(index).toContain("비로그인");
    expect(index).not.toContain(" · 10."); // no name before the time

    for (const p of ["/sming-list/", `/sming-list/${id}/`]) {
      const r = await call(p);
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe(p.slice(0, -1));
    }

    // Deleting still needs the maker or the admin; a list made signed out is the admin's.
    expect((await form(`/sming-list/${id}/delete`, null)).status).toBe(403);
    expect((await form(`/sming-list/${id}/delete`, await sessionOf(MEMBER))).status).toBe(403);
    expect((await form(`/sming-list/${id}/delete`, await sessionOf(ME))).status).toBe(302);

    // A signed-in edit carries the name; the rest of the hub still needs a session.
    const id2 = await newList(null);
    await send(`/sming-list/${id2}`, await sessionOf(MEMBER), { version: 1, name: "x", songs: {}, items: [] });
    expect(await (await call("/sming-list")).text()).toContain("앵도");
    expect(await (await call("/todo")).text()).toContain("디스코드로 로그인");
  });

  it("creates, saves and lists", async () => {
    const me = await sessionOf(ME);
    const id = await newList(me);
    const page = await (await call(`/sming-list/${id}`, { cookie: me })).text();
    expect(page).toContain('value="새 슴리"');
    expect(page).toContain('"version":1');

    const res = await send(`/sming-list/${id}`, me, { version: 1, name: "HYPERDRIVE 1시간", songs: { u1: ST, m37928381: LA }, items: ["u1", "m37928381", "u1"] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { list: { version: number } }).list.version).toBe(2);

    const index = await (await call("/sming-list", { cookie: me })).text();
    expect(index).toContain("HYPERDRIVE 1시간");
    expect(index).toContain(">3<"); // songs
    expect(index).toContain("09:00"); // 179 + 182 + 179
    expect(index).toContain("센마인");
  });

  it("keeps the newer list when two people save over the same version", async () => {
    const me = await sessionOf(ME);
    const member = await sessionOf(MEMBER);
    const id = await newList(me);
    await send(`/sming-list/${id}`, member, { version: 1, name: "A", songs: { u1: ST }, items: ["u1"] });
    const res = await send(`/sming-list/${id}`, me, { version: 1, name: "B", songs: {}, items: [] });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; list: { name: string; version: number; items: string[] } };
    expect(body).toMatchObject({ ok: false, list: { name: "A", version: 2, items: ["u1"] } });
  });

  it("checks origin and input", async () => {
    const me = await sessionOf(ME);
    const id = await newList(me);
    expect((await send(`/sming-list/${id}`, me, { version: 1, name: "x", songs: {}, items: [] }, "https://chart.rescene-remine.com")).status).toBe(403);
    expect((await form("/sming-list", me, {}, "https://evil.example")).status).toBe(403);
    expect((await send(`/sming-list/${id}`, me, { version: 1, songs: {}, items: ["u9"] })).status).toBe(400);
    expect((await send("/sming-list/AAAAAAAA", me, { version: 1, songs: {}, items: [] })).status).toBe(404);
    expect((await call("/sming-list/AAAAAAAA", { cookie: me })).status).toBe(404);
  });

  it("copies a list", async () => {
    const me = await sessionOf(ME);
    const id = await newList(me);
    await send(`/sming-list/${id}`, me, { version: 1, name: "원본", songs: { u1: ST }, items: ["u1", "u1"] });
    const copy = (await form("/sming-list", me, { copy: id })).headers.get("location")!.split("/").pop()!;
    expect(copy).not.toBe(id);
    const page = await (await call(`/sming-list/${copy}`, { cookie: me })).text();
    expect(page).toContain('value="원본 사본"');
    expect(page).toContain('"items":["u1","u1"]');
  });

  it("lets only the maker and the admin delete", async () => {
    const me = await sessionOf(ME);
    const member = await sessionOf(MEMBER);
    const other = await sessionOf(OTHER);
    const id = await newList(member);
    expect(await (await call(`/sming-list/${id}`, { cookie: other })).text()).not.toContain("/delete");
    expect((await form(`/sming-list/${id}/delete`, other)).status).toBe(403);
    expect(await (await call(`/sming-list/${id}`, { cookie: member })).text()).toContain(`/sming-list/${id}/delete`);
    expect((await form(`/sming-list/${id}/delete`, member)).status).toBe(302);
    expect((await call(`/sming-list/${id}`, { cookie: member })).status).toBe(404);

    const id2 = await newList(member);
    expect((await form(`/sming-list/${id2}/delete`, me)).status).toBe(302);
  });

  it("searches Melon for signed-in people", async () => {
    const me = await sessionOf(ME);
    const res = await call(`/sming-list/search?q=${encodeURIComponent("LOVE ATTACK")}`, { cookie: me });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { songs: { sec: number | null }[] }).songs.map((s) => s.sec)).toEqual([182, null]);
    melonDown = true;
    expect((await call("/sming-list/search?q=x", { cookie: me })).status).toBe(502);
  });

  it("escapes names", async () => {
    const me = await sessionOf(ME);
    const id = await newList(me);
    await send(`/sming-list/${id}`, me, { version: 1, name: "</script><b>x", songs: {}, items: [] });
    const page = await (await call(`/sming-list/${id}`, { cookie: me })).text();
    expect(page).not.toContain("</script><b>");
    expect(await (await call("/sming-list", { cookie: me })).text()).not.toContain("<b>x");
  });

  it("shows in the menu", async () => {
    const me = await sessionOf(ME);
    expect(await (await call("/", { cookie: me })).text()).toContain('href="/sming-list"');
  });
});
