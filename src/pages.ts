import type { Tool } from "./gate";
import { ICON, TOOL_ICONS, toolIcon } from "./icons";
import type { HubUser, Meta, Person } from "./todo";
import { inlineJson, type TodoView } from "./todo-view";

export interface Viewer {
  name: string;
  avatar: string;
  theme: string | null;
  admin: boolean;
  late: number; // overdue to-dos, shown next to 할 일
  teams: string[];
}

export interface AdminUser {
  id: string;
  name: string;
  avatar: string;
  last_seen_at: number | null;
  check_result: string | null;
  checked_at: number | null;
  sessions: number;
}

type Section = "home" | "todo" | "settings" | "admin";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const theme = (t: string | null) => (t === "light" ? "light" : "dark");

const time = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
const when = (ms: number | null) => (ms ? time.format(new Date(ms)) : "—");

const CHECK_LABEL: Record<string, string> = {
  ok: "정상",
  no_role: "역할 없음",
  left: "서버 나감",
  revoked: "승인 취소",
  unreachable: "확인 실패"
};

const page = (title: string, t: string | null, body: string, status = 200, headers: HeadersInit = {}, head = "") =>
  new Response(
    `<!doctype html><html lang="ko" data-theme="${theme(t)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/hub.css">${head}
</head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } }
  );

const logo = `<img class="logo-white" src="/logo-white.png" alt="리센느 음원총공팀"><img class="logo-dark" src="/logo-dark.png" alt="리센느 음원총공팀">`;

const status = (up: boolean | undefined) =>
  up ? `<span class="status ok"><i></i>정상</span>` : `<span class="status down"><i></i>응답 없음</span>`;

const toolUrl = (t: Tool) => `https://${t.host}/`;

interface ShellExtra {
  head?: string; // extra <head> markup
  heading?: string; // replaces the plain <h1>
  mainClass?: string;
  tail?: string; // after the layout, before the chat widget
}

function shell(v: Viewer, at: Section, tools: Tool[], health: Map<string, boolean>, title: string, main: string, x: ShellExtra = {}) {
  const item = (href: string, icon: string, label: string, on: boolean, extra = "") =>
    `<a class="item${on ? " on" : ""}" href="${href}"${on ? ' aria-current="page"' : ""}>${icon}<span>${label}</span>${extra}</a>`;
  const toolItems = tools
    .map((t) => {
      const up = health.get(t.host);
      return `<a class="item" href="${esc(toolUrl(t))}">${toolIcon(t.icon)}<span>${esc(t.name)}</span><i class="dot ${up ? "ok" : "down"}" title="${up ? "정상" : "응답 없음"}"></i></a>`;
    })
    .join("");
  return page(
    `${title} · 리센느 음원총공팀`,
    v.theme,
    `<div class="app">
<aside class="side">
<a class="logo" href="/">${logo}</a>
<nav class="nav">
${item("/", ICON.home, "홈", at === "home")}
${item("/todo", ICON.todo, "할 일", at === "todo", v.late ? `<b class="n" data-late>${v.late}</b>` : `<b class="n" data-late hidden></b>`)}
${tools.length ? `<p class="label">도구</p>${toolItems}` : ""}
</nav>
<div class="me">
<div class="who"><img class="avatar" src="${esc(v.avatar)}" alt=""><b>${esc(v.name)}</b></div>
${item("/settings", ICON.settings, "설정", at === "settings")}
${v.admin ? item("/admin", ICON.admin, "관리자", at === "admin") : ""}
<form method="post" action="/logout"><button class="item">${ICON.logout}<span>로그아웃</span></button></form>
</div>
</aside>
<main class="main${x.mainClass ? ` ${x.mainClass}` : ""}">
${x.heading ?? `<h1>${esc(title)}</h1>`}
${main}
</main>
</div>${x.tail ?? ""}<script src="/chat-widget.js" defer></script>`,
    200,
    {},
    x.head
  );
}

const todoAssets = (t: TodoView, statuses: string[]) => ({
  head: `<link rel="stylesheet" href="/todo.css"><script src="/todo.js" defer></script>`,
  tail: `<div id="todo-overlay"></div><script type="application/json" id="todo-data">${inlineJson({ items: t.details, statuses })}</script>`
});

export function homePage(v: Viewer, tools: Tool[], health: Map<string, boolean>, todo: TodoView, statuses: string[]) {
  const cards = tools
    .map(
      (t) => `<a class="card" href="${esc(toolUrl(t))}">
<span class="card-top"><span class="tile">${toolIcon(t.icon)}</span>${status(health.get(t.host))}</span>
<span class="card-name">${esc(t.name)}</span>
<span class="host">${esc(t.host)}</span>
</a>`
    )
    .join("");
  return shell(
    v,
    "home",
    tools,
    health,
    "홈",
    `<div data-todo-rail>${todo.rail}</div>${tools.length ? `<div class="cards">${cards}</div>` : `<p class="empty">도구 없음</p>`}`,
    todoAssets(todo, statuses)
  );
}

// The team/person choice is applied before first paint so the board doesn't flip after loading.
const BY_SCRIPT = `<script>try { if (localStorage.getItem("todo-by") === "person") document.documentElement.dataset.todoBy = "person"; } catch (e) {}</script>`;

export function todoPage(v: Viewer, tools: Tool[], health: Map<string, boolean>, todo: TodoView, statuses: string[]) {
  const assets = todoAssets(todo, statuses);
  return shell(
    v,
    "todo",
    tools,
    health,
    "할 일",
    `<div data-todo-rail>${todo.rail}</div><div data-todo-boards>${todo.boards || ""}</div>${
      Object.keys(todo.details).length ? "" : `<p class="empty">할 일 없음</p>`
    }`,
    {
      ...assets,
      head: BY_SCRIPT + assets.head,
      mainClass: "todo",
      heading: `<div class="head"><h1>할 일</h1><div class="seg" role="group" aria-label="묶는 기준"><button type="button" data-by="team" aria-pressed="true">팀별</button><button type="button" data-by="person" aria-pressed="false">사람별</button></div></div>`
    }
  );
}

export function settingsPage(v: Viewer, tools: Tool[], health: Map<string, boolean>, teams: string[]) {
  const choice = (value: string, label: string) => {
    const on = theme(v.theme) === value;
    return `<button class="choice${on ? " on" : ""}" name="theme" value="${value}" aria-pressed="${on}"><span class="swatch ${value}"><i></i><i></i></span>${label}</button>`;
  };
  return shell(
    v,
    "settings",
    tools,
    health,
    "설정",
    `<section class="block"><h2>테마</h2>
<form method="post" action="/settings" class="choices">${choice("dark", "다크")}${choice("light", "라이트")}</form>
</section>${
      teams.length
        ? `<section class="block"><h2>내 팀</h2>
<form method="post" action="/settings" class="pills">${teams
            .map((t) => {
              const on = v.teams.includes(t);
              return `<button class="pill${on ? " on" : ""}" name="team" value="${esc(t)}" aria-pressed="${on}">${esc(t)}</button>`;
            })
            .join("")}</form>
</section>`
        : ""
    }`
  );
}

export interface AdminTodo {
  meta: Meta;
  names: string[]; // Notion assignee names
  people: Person[];
  users: HubUser[];
}

function adminTodo(t: AdminTodo) {
  const auto = (name: string) => t.users.find((u) => u.name === name);
  const rows = t.names
    .map((name) => {
      const set = t.people.find((p) => p.notion_name === name)?.user_id ?? "";
      const a = auto(name);
      return `<form class="prow" method="post" action="/admin/todo/people">
<input type="hidden" name="name" value="${esc(name)}">
<b>${esc(name)}</b>
<select name="user" aria-label="허브 사용자"><option value="">자동 · ${esc(a?.name ?? "없음")}</option>${t.users
        .map((u) => `<option value="${esc(u.id)}"${u.id === set ? " selected" : ""}>${esc(u.name)}</option>`)
        .join("")}</select>
<button class="btn">저장</button>
</form>`;
    })
    .join("");
  const m = t.meta;
  return `<section class="block"><h2>노션</h2>
<dl class="facts"><dt>마지막 동기화</dt><dd>${when(m.synced_at)}</dd>${
    m.failed_at ? `<dt>마지막 실패</dt><dd>${when(m.failed_at)} <span class="muted">${esc(m.error ?? "")}</span></dd>` : ""
  }</dl>
</section>
<section class="block"><h2>이름 짝</h2>
${rows || `<p class="empty">담당자 없음</p>`}
</section>`;
}

export function adminPage(v: Viewer, tools: Tool[], health: Map<string, boolean>, users: AdminUser[], error: string | null, todo: AdminTodo) {
  const iconSelect = (current: string | null) =>
    `<select name="icon" aria-label="아이콘">${Object.entries(TOOL_ICONS)
      .map(([k, i]) => `<option value="${k}"${(current ?? "box") === k ? " selected" : ""}>${i.label}</option>`)
      .join("")}</select>`;
  const toolRows = tools
    .map(
      (t) => `<form class="trow" method="post" action="/admin/tools">
<input type="hidden" name="host" value="${esc(t.host)}">
<input name="position" type="number" min="0" max="999" value="${t.position}" aria-label="순서">
<span class="tile small">${toolIcon(t.icon)}</span>
${iconSelect(t.icon)}
<input name="name" value="${esc(t.name)}" maxlength="40" required aria-label="이름">
<span class="host">${esc(t.host)}</span>
<span class="actions"><button class="btn">저장</button><button class="btn quiet" formaction="/admin/tools/delete" formnovalidate>삭제</button></span>
</form>`
    )
    .join("");
  const userRows = users
    .map(
      (u) => `<tr>
<td><span class="who"><img class="avatar" src="${esc(u.avatar)}" alt=""><b>${esc(u.name)}</b></span></td>
<td class="host">${esc(u.id)}</td>
<td>${when(u.last_seen_at)}</td>
<td>${esc(CHECK_LABEL[u.check_result ?? ""] ?? "—")} <span class="muted">${when(u.checked_at)}</span></td>
<td>${u.sessions}</td>
<td>${
        u.sessions
          ? `<form method="post" action="/admin/users/logout"><input type="hidden" name="id" value="${esc(u.id)}"><button class="btn quiet">강제 로그아웃</button></form>`
          : ""
      }</td>
</tr>`
    )
    .join("");
  return shell(
    v,
    "admin",
    tools,
    health,
    "관리자",
    `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<section class="block"><h2>도구</h2>
<div class="thead" aria-hidden="true"><span>순서</span><span></span><span>아이콘</span><span>이름</span><span>주소</span><span></span></div>
${toolRows}
<form class="trow add" method="post" action="/admin/tools">
<input name="position" type="number" min="0" max="999" value="${tools.length + 1}" aria-label="순서">
<span class="tile small">${toolIcon(null)}</span>
${iconSelect(null)}
<input name="name" maxlength="40" required placeholder="이름" aria-label="이름">
<input name="host" required placeholder="xxx.rescene-remine.com" aria-label="주소">
<span class="actions"><button class="btn">추가</button></span>
</form>
</section>
<section class="block"><h2>사용자</h2>
<div class="table-wrap"><table>
<thead><tr><th>닉네임</th><th>디코 번호</th><th>마지막 접속</th><th>역할 확인</th><th>세션</th><th></th></tr></thead>
<tbody>${userRows}</tbody>
</table></div>
</section>
${adminTodo(todo)}`
  );
}

const center = (body: string, status = 200, headers: HeadersInit = {}) =>
  page("리센느 음원총공팀", null, `<main class="center"><span class="logo big">${logo}</span>${body}</main>`, status, headers);

// Always a click away from Discord: right after a logout, an open tool tab that reloads
// must not sign the person straight back in (Discord skips its screen for a known app).
export const loginPage = (next?: string) =>
  center(`<a class="btn primary" href="/login${next ? `?next=${esc(encodeURIComponent(next))}` : ""}">디스코드로 로그인</a>`);

export const deniedPage = (headers: HeadersInit) =>
  center(`<p class="lead">권한 없음</p><a class="btn primary" href="/login?again=1">다른 계정으로 로그인</a>`, 403, headers);

export const failedPage = (headers: HeadersInit = {}) =>
  center(`<p class="lead">로그인 실패</p><a class="btn primary" href="/login">다시 시도</a>`, 502, headers);

export const notFoundPage = () => center(`<p class="lead">없는 페이지</p><a class="btn primary" href="/">홈</a>`, 404);
