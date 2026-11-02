// The to-do board in a Discord channel: a few bot messages, posted again at the bottom whenever the
// board changes, so the latest board is always the last thing in the channel. Changes are made on the hub; the last line links there.
import { log, MINUTE, type Env } from "./env";
import type { TodoItem } from "./notion";
import { readItems, readMeta, orderTeams } from "./todo";
import { DONE, HELD, kstDay, TEAM_ORDER } from "./todo-common";

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 8_000;
const NO_TEAM = "팀 없음";
const AHEAD = 7; // days listed under 다가오는 일
const COLOR = { today: 0xe8e8e3, late: 0xe5533d, week: 0x8b8f98, team: 0x4b4e55 };
// Discord's limits: 4096 characters in a description, 6000 and 10 embeds in a message.
const DESC_MAX = 3900;
const MSG_MAX = 5800;
const EMBEDS_MAX = 10;

export interface Embed {
  title: string;
  description: string;
  color: number;
  timestamp?: string;
}
export type Message = { embeds: Embed[] };

const WEEKDAY = "일월화수목금토";
const dayNo = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000;
const ymdOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
const weekday = (ymd: string) => WEEKDAY[new Date(dayNo(ymd) * 86_400_000).getUTCDay()]!;
const md = (ymd: string) => `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}`;
const dayOf = (s: string | null) => (s ? s.slice(0, 10) : null);
const lastDay = (x: TodoItem) => dayOf(x.due_end) ?? dayOf(x.due_start);
const isOpen = (x: TodoItem) => x.status !== HELD && x.status !== DONE;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byDue = (a: TodoItem, b: TodoItem) => cmp(a.due_start ?? "~", b.due_start ?? "~") || cmp(b.edited_at, a.edited_at);

// Titles are people's text: Discord markdown in them shows as typed.
const plain = (s: string) => s.replace(/([\\*_~`|[\]])/g, "\\$1").replace(/\s+/g, " ");

function line(x: TodoItem, today: string, show: { due?: boolean; teams?: boolean }): string {
  const bits = [plain(x.title)];
  if (x.assignees.length) bits.push(x.assignees.map(plain).join(", "));
  if (show.teams && x.teams.length) bits.push(x.teams.map(plain).join(", "));
  if (x.status === "진행 중") bits.push("진행 중");
  const last = lastDay(x);
  if (show.due && last) {
    const n = dayNo(last) - dayNo(today);
    bits.push(n < 0 ? `**${-n}일 지남**` : n === 0 ? "**오늘**" : n <= AHEAD ? `D-${n}` : md(last));
  }
  if (x.due_start && x.due_start.length > 10 && show.due !== false) bits.push(x.due_start.slice(11, 16));
  return `- ${bits.join(" · ")}`;
}

// Lines into one description, ending with "외 N개" when they don't fit.
function fit(head: string, lines: string[]): string {
  let out = head;
  for (let i = 0; i < lines.length; i++) {
    const next = `${out}\n${lines[i]}`;
    if (next.length > DESC_MAX - 20) return `${out}\n-# 외 ${lines.length - i}개`;
    out = next;
  }
  return out;
}

export function renderBoard(items: TodoItem[], teams: string[], today: string, hub: string): Message[] {
  const open = items.filter(isOpen);
  const late = open.filter((x) => (lastDay(x) ?? "~") < today).sort(byDue);
  const due = open
    .filter((x) => {
      const s = dayOf(x.due_start);
      return !!s && s <= today && today <= lastDay(x)!;
    })
    .sort(byDue);
  const doneToday = items.filter((x) => x.status === DONE && (dayOf(x.done_on) ?? lastDay(x)) === today);

  const parts: string[] = [];
  if (late.length) parts.push(fit(`**밀린 일 ${late.length}**`, late.map((x) => line(x, today, { due: true, teams: true }))));
  parts.push(due.length ? fit(`**오늘 할 일 ${due.length}**`, due.map((x) => line(x, today, { teams: true }))) : "**오늘 할 일 없음**");
  if (doneToday.length) parts.push(fit(`**오늘 끝낸 일 ${doneToday.length}**`, doneToday.map((x) => `- ~~${plain(x.title)}~~`)));
  const embeds: Embed[] = [{ title: `${+today.slice(5, 7)}월 ${+today.slice(8, 10)}일 ${weekday(today)}요일`, description: fit("", parts).trim(), color: late.length ? COLOR.late : COLOR.today }];

  // The next week, day by day.
  const t = dayNo(today);
  const week: string[] = [];
  for (let n = 1; n <= AHEAD; n++) {
    const d = ymdOf(t + n);
    const on = open.filter((x) => dayOf(x.due_start) === d).sort(byDue);
    if (on.length) week.push(`**${md(d)} ${weekday(d)}**\n${on.map((x) => line(x, today, { teams: true })).join("\n")}`);
  }
  if (week.length) embeds.push({ title: "다가오는 일", description: fit("", week).trim(), color: COLOR.week });

  // Every open item by team, soonest first.
  const known = [...new Set([...TEAM_ORDER, ...teams, ...items.flatMap((x) => x.teams)])];
  for (const name of [...known, NO_TEAM]) {
    const mine = items.filter((x) => (name === NO_TEAM ? !x.teams.length : x.teams.includes(name)));
    const left = mine.filter(isOpen).sort(byDue);
    const held = mine.filter((x) => x.status === HELD).length;
    if (!left.length && !held) continue;
    const rest = held ? `\n-# 보류 ${held}` : "";
    embeds.push({ title: `${name} · ${left.length}`, description: (fit("", left.map((x) => line(x, today, { due: true }))).trim() || "-# 남은 일 없음") + rest, color: COLOR.team });
  }

  // The last line: where to change things.
  const url = `${hub}/todo`;
  const last = embeds[embeds.length - 1]!;
  last.description += `\n\n[${url.replace(/^https?:\/\//, "")}](${url}) 에서 추가·수정`;

  // Into as few messages as Discord takes.
  const msgs: Message[] = [];
  let size = 0;
  for (const e of embeds) {
    const n = e.title.length + e.description.length;
    const cur = msgs[msgs.length - 1];
    if (!cur || cur.embeds.length >= EMBEDS_MAX || size + n > MSG_MAX) {
      msgs.push({ embeds: [e] });
      size = n;
    } else {
      cur.embeds.push(e);
      size += n;
    }
  }
  return msgs;
}

const hashOf = async (v: unknown) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(v))))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function discord(env: Env, method: string, path: string, body?: unknown): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN!.trim()}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (res.status !== 429 || i) return res;
    const wait = Number((await res.clone().json().catch(() => ({})) as { retry_after?: number }).retry_after ?? 1);
    await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000));
  }
}

class DiscordError extends Error {}

// Whether the board's messages are the newest in the channel, in order.
async function atBottom(env: Env, channel: string, ids: string[]): Promise<boolean> {
  const res = await discord(env, "GET", `/channels/${channel}/messages?limit=${ids.length}`);
  if (!res.ok) return false;
  const newest = ((await res.json()) as { id: string }[]).map((m) => m.id).reverse();
  return newest.length === ids.length && newest.every((id, i) => id === ids[i]);
}

// Brings the channel up to date. Nothing is sent while the board reads the same. When it changes,
// it's edited in place if it's still the last thing in the channel; if people have talked under
// it, it's posted again at the bottom and the old one deleted.
// One run at a time; a run that finds another going leaves it to that one or the next minute's.
export async function postBoard(env: Env, now: number): Promise<void> {
  const channel = env.DISCORD_TODO_CHANNEL?.trim();
  if (!channel || !env.DISCORD_BOT_TOKEN) return;
  const claim = await env.DB.prepare("UPDATE discord_meta SET busy_at = ?1 WHERE id = 1 AND (busy_at IS NULL OR busy_at < ?2)").bind(now, now - MINUTE).run();
  if (!claim.meta.changes) return;
  try {
    const [items, meta, rows] = await Promise.all([
      readItems(env),
      readMeta(env),
      env.DB.prepare("SELECT slot, message_id, hash FROM discord_board WHERE channel = ? ORDER BY slot").bind(channel).all<{ slot: number; message_id: string; hash: string }>()
    ]);
    if (meta.synced_at === null) return;
    const msgs = renderBoard(items, orderTeams(meta.options.teams), kstDay(now), env.HUB_ORIGIN);
    const hashes = await Promise.all(msgs.map(hashOf));
    const have = rows.results;
    if (have.length === msgs.length && have.every((r, i) => r.hash === hashes[i])) return;

    const stamp = new Date(now).toISOString();
    const body = (m: Message) => ({ embeds: m.embeds.map((e, i) => (i === m.embeds.length - 1 ? { ...e, timestamp: stamp } : e)), allowed_mentions: { parse: [] } });

    // Still the last thing in the channel: the changed messages are edited where they are.
    if (have.length === msgs.length && (await atBottom(env, channel, have.map((r) => r.message_id)))) {
      let edited = true;
      for (let i = 0; i < msgs.length && edited; i++) {
        if (have[i]!.hash === hashes[i]) continue;
        const res = await discord(env, "PATCH", `/channels/${channel}/messages/${have[i]!.message_id}`, body(msgs[i]!));
        if (res.ok) await env.DB.prepare("UPDATE discord_board SET hash = ? WHERE channel = ? AND slot = ?").bind(hashes[i]!, channel, i).run();
        else if (res.status === 404) edited = false; // deleted meanwhile: post it again below
        else throw new DiscordError(`edit ${res.status}`);
      }
      if (edited) return;
    }

    // Something was said under it: the new board goes in at the bottom, then the old one goes. A
    // message already deleted by hand is fine.
    const drop = async (ids: string[]) => {
      for (const id of ids) {
        const res = await discord(env, "DELETE", `/channels/${channel}/messages/${id}`);
        if (!res.ok && res.status !== 404) log("discord board delete failed", { id, status: res.status });
      }
    };
    const posted: string[] = [];
    for (const m of msgs) {
      const res = await discord(env, "POST", `/channels/${channel}/messages`, body(m));
      if (!res.ok) {
        await drop(posted); // half a board would sit under the old one
        throw new DiscordError(`post ${res.status}`);
      }
      posted.push(((await res.json()) as { id: string }).id);
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM discord_board WHERE channel = ?").bind(channel),
      ...posted.map((id, i) => env.DB.prepare("INSERT INTO discord_board (channel, slot, message_id, hash) VALUES (?, ?, ?, ?)").bind(channel, i, id, hashes[i]!))
    ]);
    await drop(have.map((r) => r.message_id));
  } catch (e) {
    if (!(e instanceof DiscordError) && !(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError" || e instanceof TypeError))) throw e;
    log("discord board failed", { error: e.message });
  } finally {
    await env.DB.prepare("UPDATE discord_meta SET busy_at = NULL WHERE id = 1").run();
  }
}
