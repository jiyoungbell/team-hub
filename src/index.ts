import { callback, clearSession, login, redirect } from "./auth";
import { isAdmin, type Env } from "./env";
import { gateApi, go } from "./gate";
import { homePage, loginPage } from "./pages";
import { recheck } from "./recheck";
import { currentSession, revokeSession } from "./session";

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

    if (path === "/") return session ? homePage(session.name, session.avatar) : loginPage();
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_ctrl, env): Promise<void> {
    await recheck(env, Date.now());
  }
} satisfies ExportedHandler<Env>;
