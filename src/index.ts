import { chatFrame, chatReply } from "./chat";
import { ADMIN_ERRORS, adminPost, listUsers } from "./admin";
import { callback, clearSession, login, redirect } from "./auth";
import { isAdmin, type Env } from "./env";
import { gateApi, go, listTools } from "./gate";
import { toolHealth } from "./health";
import { adminPage, homePage, loginPage, notFoundPage, settingsPage, todoPage, type Viewer } from "./pages";
import { recheck } from "./recheck";
import { currentSession, revokeSession, type Session } from "./session";
import {
  changeStatus,
  createItem,
  deleteItem,
  editItem,
  lateCount,
  loadTodo,
  orderTeams,
  readMeta,
  restoreItem,
  STATUSES,
  teamsOf,
  type HubUser,
  type Person,
  type WriteResult
} from "./todo";
import { renderTodo, type TodoView } from "./todo-view";

const PAGES = new Set(["/", "/todo", "/settings", "/admin"]);

const statusesOf = (s: string[]) => (s.length ? s : STATUSES);

type TodoWrite = (env: Env, session: Session, input: unknown, now: number) => Promise<WriteResult>;
const TODO_WRITES: Record<string, TodoWrite> = {
  "/todo/status": changeStatus,
  "/todo/items": createItem,
  "/todo/edit": editItem,
  "/todo/delete": deleteItem,
  "/todo/restore": restoreItem
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

// The board is drawn here only, so every answer carries the new one.
const boardJson = (v: TodoView) => ({ rail: v.rail, boards: v.boards, late: v.late, items: v.details, pick: v.pick });

async function todoWrite(env: Env, req: Request, session: Session, now: number, write: TodoWrite, ctx?: ExecutionContext): Promise<Response> {
  if (req.headers.get("origin") !== env.HUB_ORIGIN) return json({ ok: false }, 403);
  const result = await write(env, session, await req.json().catch(() => null), now);
  if (result.status !== 200 && result.status !== 409) return json({ ok: false }, result.status);
  const view = renderTodo(await loadTodo(env, session, now, ctx));
  // 409: someone changed it in Notion first; the item now shows Notion's value.
  return json({ ok: result.status === 200, key: result.item?.page_id.replace(/-/g, ""), ...boardJson(view) }, result.status);
}

export default {
  async fetch(req, env, ctx?): Promise<Response> {
    const url = new URL(req.url);
    const now = Date.now();
    const path = url.pathname;

    if (path.startsWith("/api/gate/")) return gateApi(env, req, url, now);
    if (path === "/auth/callback") return callback(env, req, url, now);

    // Pages need the tool list too; fetch it alongside the session instead of after it.
    const pageTools = req.method === "GET" && (PAGES.has(path) || path.startsWith("/admin/")) ? listTools(env) : null;
    pageTools?.catch(() => {});
    const session = await currentSession(env, req, now);

    if (path === "/chat/embed" || path === "/api/chat") {
      if (!session) return new Response("로그인이 만료되었습니다. 허브에서 로그인한 뒤 다시 열어주세요.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      if (path === "/api/chat") return chatReply(req, env, session.userId);
      return chatFrame(env, session.userId);
    }

    const write = req.method === "POST" ? TODO_WRITES[path] : undefined;
    if (write || (path === "/todo/board" && req.method === "GET")) {
      if (!session) return json({ ok: false }, 401);
      if (write) return todoWrite(env, req, session, now, write, ctx);
      return json({ ok: true, ...boardJson(renderTodo(await loadTodo(env, session, now, ctx))) });
    }

    if (path === "/login") return session && url.searchParams.get("again") !== "1" ? redirect("/") : login(env, url);

    if (path === "/logout") {
      // GET too, so a tool's logout can bounce through here.
      if (session) await revokeSession(env, session.id, now);
      return redirect("/", [clearSession()]);
    }

    if (path === "/go") {
      if (!session) return loginPage(path + url.search);
      return go(env, url, session, now);
    }

    if (path === "/api/me") {
      if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
      const { userId: id, name, avatar, theme } = session;
      return Response.json({ id, name, avatar, theme, admin: isAdmin(env, id) }, { headers: { "cache-control": "no-store" } });
    }

    const admin = path === "/admin" || path.startsWith("/admin/");
    if (!PAGES.has(path) && !admin) return notFoundPage();
    if (!session) return loginPage(path === "/" ? undefined : path);
    const viewer: Viewer = {
      name: session.name,
      avatar: session.avatar,
      theme: session.theme,
      admin: isAdmin(env, session.userId),
      late: 0,
      teams: teamsOf(session.teams)
    };
    if (admin && !viewer.admin) return notFoundPage();

    if (req.method === "POST") {
      // SameSite=Lax already keeps other sites out; this also covers sibling subdomains.
      if (req.headers.get("origin") !== env.HUB_ORIGIN) return new Response("Forbidden", { status: 403 });
      if (path === "/settings") {
        const form = await req.formData();
        const theme = form.get("theme");
        const team = form.get("team");
        if (theme === "dark" || theme === "light") {
          await env.DB.prepare("UPDATE users SET theme = ?, updated_at = ? WHERE id = ?").bind(theme, now, session.userId).run();
        }
        if (typeof team === "string" && (await readMeta(env)).options.teams.includes(team)) {
          const teams = viewer.teams.includes(team) ? viewer.teams.filter((t) => t !== team) : [...viewer.teams, team];
          await env.DB.prepare("UPDATE users SET teams = ? WHERE id = ?").bind(JSON.stringify(teams), session.userId).run();
        }
        return redirect("/settings");
      }
      return (admin && (await adminPost(env, req, path, now))) || notFoundPage();
    }

    const tools = await (pageTools ?? listTools(env));
    if (path === "/" || path === "/todo") {
      const [health, data] = await Promise.all([toolHealth(env, tools, now, ctx), loadTodo(env, session, now, ctx)]);
      const todo = renderTodo(data, path === "/todo");
      viewer.late = todo.late;
      const statuses = statusesOf(data.options.statuses);
      return (path === "/" ? homePage : todoPage)(viewer, tools, health, todo, statuses);
    }
    const [health, late, meta] = await Promise.all([toolHealth(env, tools, now, ctx), lateCount(env, now), readMeta(env)]);
    viewer.late = late;
    if (path === "/settings") {
      return settingsPage(viewer, tools, health, orderTeams(meta.options.teams));
    }
    if (path === "/admin") {
      const error = ADMIN_ERRORS[url.searchParams.get("error") ?? ""] ?? null;
      const [users, people, hubUsers, assignees] = await Promise.all([
        listUsers(env, now),
        env.DB.prepare("SELECT notion_name, user_id FROM todo_people").all<Person>(),
        env.DB.prepare("SELECT id, name FROM users ORDER BY name").all<HubUser>(),
        env.DB.prepare("SELECT DISTINCT j.value AS name FROM todo_items, json_each(todo_items.assignees) j").all<{ name: string }>()
      ]);
      const names = [...new Set([...meta.options.assignees, ...assignees.results.map((r) => r.name)])];
      return adminPage(viewer, tools, health, users, error, { meta, names, people: people.results, users: hubUsers.results });
    }
    return notFoundPage();
  },

  async scheduled(_ctrl, env): Promise<void> {
    await recheck(env, Date.now());
  }
} satisfies ExportedHandler<Env>;
