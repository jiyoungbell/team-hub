import { redirect } from "./auth";
import type { Env } from "./env";
import { TOOL_ICONS } from "./icons";
import type { AdminUser } from "./pages";
import { revokeUser } from "./session";

// Tools live on sibling subdomains of the hub; anything else could turn /go into an open redirect.
export function validHost(env: Env, host: string): boolean {
  const hub = new URL(env.HUB_ORIGIN).hostname;
  const parent = hub.slice(hub.indexOf(".") + 1);
  const m = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.(.+)$/.exec(host);
  return !!m && m[2] === parent && host !== hub;
}

export const listUsers = async (env: Env, now: number) =>
  (
    await env.DB.prepare(
      `SELECT u.id, u.name, u.avatar, u.last_seen_at, u.check_result, u.checked_at,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?1) AS sessions
         FROM users u ORDER BY u.last_seen_at DESC`
    )
      .bind(now)
      .all<AdminUser>()
  ).results;

export const ADMIN_ERRORS: Record<string, string> = { host: "잘못된 주소", name: "잘못된 이름", position: "잘못된 순서" };

const back = (error?: keyof typeof ADMIN_ERRORS) => redirect(error ? `/admin?error=${error}` : "/admin");

export async function adminPost(env: Env, req: Request, path: string, now: number): Promise<Response | null> {
  const form = await req.formData();
  const field = (k: string) => String(form.get(k) ?? "").trim();

  if (path === "/admin/tools") {
    const host = field("host").toLowerCase();
    const name = field("name");
    const position = Number(field("position"));
    const icon = field("icon");
    if (!validHost(env, host)) return back("host");
    if (!name || name.length > 40) return back("name");
    if (!Number.isInteger(position) || position < 0 || position > 999) return back("position");
    await env.DB.prepare(
      `INSERT INTO tools (host, name, position, icon) VALUES (?, ?, ?, ?)
       ON CONFLICT(host) DO UPDATE SET name = excluded.name, position = excluded.position, icon = excluded.icon`
    )
      .bind(host, name, position, icon in TOOL_ICONS ? icon : null)
      .run();
    return back();
  }

  if (path === "/admin/tools/delete") {
    await env.DB.prepare("DELETE FROM tools WHERE host = ?").bind(field("host").toLowerCase()).run();
    return back();
  }

  if (path === "/admin/users/logout") {
    await revokeUser(env, field("id"), now);
    return back();
  }

  return null;
}
