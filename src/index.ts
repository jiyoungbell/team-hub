import { ADMIN_ERRORS, adminPost, listUsers } from "./admin";
import { callback, clearSession, login, redirect } from "./auth";
import { isAdmin, type Env } from "./env";
import { gateApi, go, listTools } from "./gate";
import { toolHealth } from "./health";
import { adminPage, homePage, loginPage, notFoundPage, settingsPage, type Viewer } from "./pages";
import { recheck } from "./recheck";
import { currentSession, revokeSession } from "./session";

const PAGES = new Set(["/", "/settings", "/admin"]);

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    const now = Date.now();
    const path = url.pathname;

    if (path.startsWith("/api/gate/")) return gateApi(env, req, url, now);
    if (path === "/auth/callback") return callback(env, req, url, now);

    const session = await currentSession(env, req, now);

    if (path === "/login") return session && url.searchParams.get("again") !== "1" ? redirect("/") : login(env, url);

    if (path === "/logout") {
      // GET too, so a tool's logout can bounce through here.
      if (session) await revokeSession(env, session.id, now);
      return redirect("/", [clearSession()]);
    }

    if (path === "/go") {
      if (!session) return redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
      return go(env, url, session, now);
    }

    if (path === "/api/me") {
      if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
      const { userId: id, name, avatar, theme } = session;
      return Response.json({ id, name, avatar, theme, admin: isAdmin(env, id) }, { headers: { "cache-control": "no-store" } });
    }

    const admin = path === "/admin" || path.startsWith("/admin/");
    if (!PAGES.has(path) && !admin) return notFoundPage();
    if (!session) return path === "/" ? loginPage() : redirect(`/login?next=${encodeURIComponent(path)}`);
    const viewer: Viewer = { name: session.name, avatar: session.avatar, theme: session.theme, admin: isAdmin(env, session.userId) };
    if (admin && !viewer.admin) return notFoundPage();

    if (req.method === "POST") {
      // SameSite=Lax already keeps other sites out; this also covers sibling subdomains.
      if (req.headers.get("origin") !== env.HUB_ORIGIN) return new Response("Forbidden", { status: 403 });
      if (path === "/settings") {
        const theme = (await req.formData()).get("theme");
        if (theme === "dark" || theme === "light") {
          await env.DB.prepare("UPDATE users SET theme = ?, updated_at = ? WHERE id = ?").bind(theme, now, session.userId).run();
        }
        return redirect("/settings");
      }
      return (admin && (await adminPost(env, req, path, now))) || notFoundPage();
    }

    const tools = await listTools(env);
    const health = await toolHealth(
      tools.map((t) => t.host),
      now
    );
    if (path === "/") return homePage(viewer, tools, health);
    if (path === "/settings") return settingsPage(viewer, tools, health);
    if (path === "/admin") {
      const error = ADMIN_ERRORS[url.searchParams.get("error") ?? ""] ?? null;
      return adminPage(viewer, tools, health, await listUsers(env, now), error);
    }
    return notFoundPage();
  },

  async scheduled(_ctrl, env): Promise<void> {
    await recheck(env, Date.now());
  }
} satisfies ExportedHandler<Env>;
