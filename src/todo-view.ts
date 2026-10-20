import type { TodoItem } from "./notion";
import { DONE, HELD, kstStamp, type TodoData } from "./todo";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const TEAM_ORDER = ["SNS", "총대", "디자인", "개발", "분석", "총무", "기타"];
const NO_TEAM = "팀 없음";
const NO_ONE = "담당자 없음";
const RAIL_BACK = 6;
const RAIL_AHEAD = 27;

interface View extends TodoItem {
  key: string;
  n: number | null; // days until due
  late: boolean;
  dueTag: string;
  dueCls: string;
  dueDate: string;
}

const dayNo = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000;

// "10/22" or "10/22 23:59"
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}${d.length > 10 ? ` ${d.slice(11, 16)}` : ""}`;

function view(x: TodoItem, today: string): View {
  const n = x.due_start ? dayNo(x.due_start) - dayNo(today) : null;
  const late = n !== null && n < 0;
  return {
    ...x,
    key: x.page_id.replace(/-/g, ""),
    n,
    late,
    dueTag: n === null ? "" : late ? `${-n}일 지남` : n === 0 ? "오늘" : `D-${n}`,
    dueCls: late ? "late" : n !== null && n > 7 ? "far" : "",
    dueDate: x.due_start ? md(x.due_start) : ""
  };
}

const isOpen = (x: TodoItem) => x.status !== HELD && x.status !== DONE;
// Plain code-point order: ISO dates sort right and "~" comes after any of them.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byRank = (a: View, b: View) =>
  cmp(a.due_start ?? "~", b.due_start ?? "~") ||
  (a.status === "진행 중" ? 0 : 1) - (b.status === "진행 중" ? 0 : 1) ||
  cmp(b.edited_at, a.edited_at);
const byDone = (a: View, b: View) => cmp(b.done_on ?? "", a.done_on ?? "") || cmp(b.edited_at, a.edited_at);

const unique = (l: string[]) => [...new Set(l)];

interface Group {
  name: string;
  open: View[];
  held: View[];
  done: View[];
}

function groupBy(items: View[], names: string[], has: (x: View, name: string) => boolean): Group[] {
  return names
    .map((name) => {
      const mine = items.filter((x) => has(x, name));
      return {
        name,
        open: mine.filter(isOpen).sort(byRank),
        held: mine.filter((x) => x.status === HELD).sort(byRank),
        done: mine.filter((x) => x.status === DONE).sort(byDone)
      };
    })
    .filter((g) => g.open.length || g.held.length || g.done.length);
}

function teamGroups(items: View[], d: TodoData): Group[] {
  const known = unique([...TEAM_ORDER, ...d.options.teams, ...items.flatMap((x) => x.teams)]);
  const names = unique([...d.myTeams.filter((t) => known.includes(t)), ...known, NO_TEAM]);
  return groupBy(items, names, (x, name) => (name === NO_TEAM ? !x.teams.length : x.teams.includes(name)));
}

function personGroups(items: View[], d: TodoData): Group[] {
  const open = new Map<string, number>();
  for (const x of items) for (const w of x.assignees) open.set(w, (open.get(w) ?? 0) + (isOpen(x) ? 1 : 0));
  const rest = [...open.keys()]
    .filter((n) => !d.me.includes(n))
    .sort((a, b) => open.get(b)! - open.get(a)! || a.localeCompare(b, "ko"));
  const names = [...d.me.filter((n) => open.has(n)), ...rest, NO_ONE];
  return groupBy(items, names, (x, name) => (name === NO_ONE ? !x.assignees.length : x.assignees.includes(name)));
}

function card(x: View, withWho: boolean, folded = false): string {
  const top: string[] = [];
  if (folded) top.push(`<span class="wait">${x.status === DONE ? `완료${x.done_on ? ` ${md(x.done_on)}` : ""}` : HELD}</span>`);
  else {
    if (x.n !== null) top.push(`<span class="due ${x.dueCls}">${x.dueTag}</span>`);
    if (x.status === "시작 전") top.push('<span class="wait">시작 전</span>');
  }
  const who = withWho && x.assignees.length ? `<span class="tc-who">${esc(x.assignees.join(" · "))}</span>` : "";
  return `<button type="button" class="tc${folded ? " dim" : ""}" data-open="${x.key}">${top.length ? `<span class="tc-top">${top.join("")}</span>` : ""}<span class="tc-title">${esc(x.title)}</span>${x.stage ? `<span class="tc-stage clamp">${esc(x.stage)}</span>` : ""}${who}</button>`;
}

function column(g: Group, withWho: boolean): string {
  const fold = [g.held.length ? `보류 ${g.held.length}` : "", g.done.length ? `완료 ${g.done.length}` : ""].filter(Boolean).join(" · ");
  const folded = [...g.held, ...g.done].map((x) => card(x, withWho, true)).join("");
  return `<div class="col" data-col="${esc(g.name)}"><div class="col-h"><b>${esc(g.name)}</b><span>${g.open.length}</span></div>${g.open.map((x) => card(x, withWho)).join("")}${
    fold ? `<button type="button" class="fold" data-fold aria-expanded="false">${fold}</button><div class="folded" hidden>${folded}</div>` : ""
  }</div>`;
}

const board = (by: "team" | "person", groups: Group[]) =>
  `<div class="board" data-board="${by}">${groups.map((g) => column(g, by === "team")).join("")}</div>`;

// Dated open items on a date line from a week back to four weeks ahead. Overdue items older
// than that sit at the left edge; ones further out are left off.
function rail(items: View[], today: string): string {
  const t = dayNo(today);
  const from = t - RAIL_BACK;
  const to = t + RAIL_AHEAD;
  const pos = (day: number) => ((Math.max(day, from) - from) / (to - from)) * 100;
  const dated = items.filter((x) => isOpen(x) && x.n !== null && x.n <= RAIL_AHEAD).sort(byRank);
  if (!dated.length) return "";
  const laneEnd: number[] = [];
  const marks = dated.map((x) => {
    const p = pos(t + x.n!);
    let lane = laneEnd.findIndex((end) => end <= p);
    if (lane < 0) {
      lane = laneEnd.length;
      laneEnd.push(0);
    }
    laneEnd[lane] = p + 19;
    return { x, p, lane };
  });
  const h = laneEnd.length * 40;
  const mk = marks
    .map(
      ({ x, p, lane }) =>
        `<button type="button" class="mk${x.late ? " late" : ""}" style="left:${p.toFixed(2)}%;top:${lane * 40}px" data-open="${x.key}"><span class="stem" style="height:${h - lane * 40 - 32}px"></span><i></i><span class="due ${x.dueCls}">${x.dueTag}</span><span class="mt">${esc(x.title)}</span></button>`
    )
    .join("");
  const ticks = [from, t, t + 7, t + 14, t + 21]
    .map((day) => {
      const d = new Date(day * 86_400_000);
      return `<span class="tick${day === t ? " today" : ""}" style="left:${pos(day).toFixed(2)}%"><span>${d.getUTCMonth() + 1}/${d.getUTCDate()}</span></span>`;
    })
    .join("");
  return `<div class="rail-wrap"><div class="rail"><div class="past" style="width:${pos(t).toFixed(2)}%"></div><div class="rail-lanes" style="height:${h + 4}px">${mk}</div><div class="axis">${ticks}</div></div></div>`;
}

// What the small window shows, keyed by the page id without dashes (also the #link).
function detail(x: View, d: TodoData) {
  return {
    page: x.page_id,
    t: x.title,
    s: x.status,
    teams: x.teams,
    who: x.assignees,
    cat: x.category,
    due: x.n === null ? null : { tag: x.dueTag, cls: x.dueCls, date: x.dueDate },
    done: x.done_on ? md(x.done_on) : null,
    stage: x.stage,
    next: x.next_action,
    url: x.url,
    log: (d.changes.get(x.page_id) ?? []).map((c) => `${c.user_name} · ${kstStamp(c.at)} · ${c.from_status ?? "없음"} → ${c.to_status}`)
  };
}

export interface TodoView {
  rail: string;
  boards: string;
  late: number;
  details: Record<string, ReturnType<typeof detail>>;
}

export function renderTodo(d: TodoData, withBoards = true): TodoView {
  const items = d.items.map((x) => view(x, d.today));
  const details: TodoView["details"] = {};
  const shown = withBoards ? items : items.filter((x) => isOpen(x) && x.n !== null);
  for (const x of shown) details[x.key] = detail(x, d);
  return {
    rail: rail(items, d.today),
    boards: withBoards ? board("team", teamGroups(items, d)) + board("person", personGroups(items, d)) : "",
    late: items.filter((x) => isOpen(x) && x.late).length,
    details
  };
}

// JSON inside <script>: nothing in it may close the tag.
export const inlineJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
