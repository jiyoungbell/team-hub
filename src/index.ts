import { ADMIN_ERRORS, adminPost, listUsers } from "./admin";
import { callback, clearSession, login, redirect } from "./auth";
import { isAdmin, log, type Env } from "./env";
import { gateApi, go, listTools } from "./gate";
import { toolHealth } from "./health";
import { MelonError, search } from "./melon";
import { adminPage, homePage, loginPage, notFoundPage, settingsPage, smingIndexPage, smingPage, todoPage, type Viewer } from "./pages";
import { recheck } from "./recheck";
import { currentSession, revokeSession, type Session } from "./session";
import { canDelete, createList, deleteList, LIST_ID, listLists, loadList, saveList } from "./sming-list";
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
import { clientData, renderTodo } from "./todo-view";

const PAGES = new Set(["/", "/todo", "/settings", "/admin"]);

// /sming-list/<id> as a page; other /sming-list/... paths are its search, save and delete.
const smingPageId = (path: string) => {
  const id = path.slice("/sming-list/".length);
  return path.startsWith("/sming-list/") && LIST_ID.test(id) ? id : null;
};

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

// Every answer carries the whole copy; the page redraws the board from it.
const todoJson = async (env: Env, session: Session, now: number, ctx?: ExecutionContext) => {
  const d = await loadTodo(env, session, now, ctx);
  return clientData(d, statusesOf(d.options.statuses), session.name);
};

async function todoWrite(env: Env, req: Request, session: Session, now: number, write: TodoWrite, ctx?: ExecutionContext): Promise<Response> {
  if (req.headers.get("origin") !== env.HUB_ORIGIN) return json({ ok: false }, 403);
  const result = await write(env, session, await req.json().catch(() => null), now);
  if (result.status !== 200 && result.status !== 409) return json({ ok: false }, result.status);
  // 409: someone changed it in Notion first; the item now shows Notion's value.
  return json({ ok: result.status === 200, key: result.item?.page_id.replace(/-/g, ""), data: await todoJson(env, session, now, ctx) }, result.status);
}

// Open without signing in; a signed-in person's edits carry their name.
async function smingApi(env: Env, req: Request, url: URL, session: Session | null, now: number): Promise<Response> {
  const userId = session?.userId ?? null;
  const path = url.pathname;
  if (path === "/sming-list/search" && req.method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    if (!q) return json({ ok: true, songs: [] });
    try {
      return json({ ok: true, songs: await search(q) });
    } catch (e) {
      if (!(e instanceof MelonError) && !(e instanceof Error && e.name === "TimeoutError")) throw e;
      log("melon_failed", { error: String(e) });
      return json({ ok: false }, 502);
    }
  }
  if (req.method !== "POST") return notFoundPage();
  if (req.headers.get("origin") !== env.HUB_ORIGIN) return json({ ok: false }, 403);

  if (path === "/sming-list") {
    const copy = (await req.formData().catch(() => null))?.get("copy") ?? null;
    const from = typeof copy === "string" ? await loadList(env, copy) : null;
    if (copy !== null && !from) return notFoundPage();
    return redirect(`/sming-list/${await createList(env, userId, now, from)}`);
  }
  const m = /^\/sming-list\/([\w-]{8})(\/delete)?$/.exec(path);
  if (!m) return notFoundPage();
  const id = m[1]!;
  if (m[2]) {
    const list = await loadList(env, id);
    if (!list) return redirect("/sming-list");
    if (!canDelete(list, userId, !!userId && isAdmin(env, userId))) return new Response("Forbidden", { status: 403 });
    await deleteList(env, id);
    return redirect("/sming-list");
  }
  const result = await saveList(env, userId, id, await req.json().catch(() => null), now);
  if (result.status !== 200 && result.status !== 409) return json({ ok: false }, result.status);
  const { list } = result;
  return json({ ok: result.status === 200, list: { id: list.id, name: list.name, songs: list.songs, items: list.items, version: list.version } }, result.status);
}

export default {
  async fetch(req, env, ctx?): Promise<Response> {
    const url = new URL(req.url);
    const now = Date.now();
    const path = url.pathname;

    if (path.startsWith("/api/gate/")) return gateApi(env, req, url, now);
    if (path === "/auth/callback") return callback(env, req, url, now);

    // Pages need the tool list too; fetch it alongside the session instead of after it.
    const smingId = smingPageId(path);
    const sming = path === "/sming-list" || smingId !== null;
    const pageTools = req.method === "GET" && (PAGES.has(path) || path.startsWith("/admin/") || sming) ? listTools(env) : null;
    pageTools?.catch(() => {});
    const session = await currentSession(env, req, now);

    const write = req.method === "POST" ? TODO_WRITES[path] : undefined;
    if (write || (path === "/todo/board" && req.method === "GET")) {
      if (!session) return json({ ok: false }, 401);
      if (write) return todoWrite(env, req, session, now, write, ctx);
      return json({ ok: true, data: await todoJson(env, session, now, ctx) });
    }

    // A link pasted with a trailing slash still opens the page.
    if (req.method === "GET" && /^\/sming-list(\/[\w-]{8})?\/$/.test(path)) return redirect(path.slice(0, -1) + url.search);
    if (path.startsWith("/sming-list") && !(req.method === "GET" && sming)) {
      if (path !== "/sming-list" && !path.startsWith("/sming-list/")) return notFoundPage();
      return smingApi(env, req, url, session, now);
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
    if (!PAGES.has(path) && !admin && !sming) return notFoundPage();
    if (!session) {
      if (!sming) return loginPage(path === "/" ? undefined : path);
      const list = smingId ? await loadList(env, smingId) : null;
      if (!smingId) return smingIndexPage(null, [], new Map(), await listLists(env));
      return list ? smingPage(null, [], new Map(), list, false) : notFoundPage();
    }
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
      return (path === "/" ? homePage : todoPage)(viewer, tools, health, todo, clientData(data, statusesOf(data.options.statuses), session.name));
    }
    if (sming) {
      const [health, late, list] = await Promise.all([toolHealth(env, tools, now, ctx), lateCount(env, now), smingId ? loadList(env, smingId) : null]);
      viewer.late = late;
      if (!smingId) return smingIndexPage(viewer, tools, health, await listLists(env));
      if (!list) return notFoundPage();
      return smingPage(viewer, tools, health, list, canDelete(list, session.userId, viewer.admin));
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
