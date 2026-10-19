import { safePath, redirect } from "./auth";
import { publicJwk, randomId, safeEqual, signJwt } from "./crypto";
import { MINUTE, TICKET_TTL, TOOL_TOKEN_TTL, type Env } from "./env";
import { revokeSession, type Session } from "./session";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export interface Tool {
  host: string;
  name: string;
  position: number;
  icon: string | null;
}

export const listTools = async (env: Env) =>
  (await env.DB.prepare("SELECT host, name, position, icon FROM tools ORDER BY position, host").all<Tool>()).results;

// /go?to=<tool host>&next=<path>&state=<from team-gate>
// Hands the tool a one-time ticket; the tool token inside it becomes the tool's cookie.
export async function go(env: Env, url: URL, session: Session, now: number): Promise<Response> {
  const host = (url.searchParams.get("to") ?? "").toLowerCase();
  const state = url.searchParams.get("state") ?? "";
  const next = safePath(url.searchParams.get("next")) ?? "/";
  if (!/^[\w-]{16,128}$/.test(state)) return json({ error: "bad state" }, 400);
  const tool = await env.DB.prepare("SELECT host FROM tools WHERE host = ?").bind(host).first();
  if (!tool) return json({ error: "unknown tool" }, 400);

  const iat = Math.floor(now / 1000);
  const base = { iss: new URL(env.HUB_ORIGIN).host, aud: host, sub: session.userId, sid: session.id, iat };
  const tok = await signJwt(env.SIGNING_KEY, {
    ...base,
    kind: "tool",
    exp: Math.floor(Math.min(now + TOOL_TOKEN_TTL, session.expiresAt) / 1000)
  });
  const ticket = await signJwt(env.SIGNING_KEY, {
    ...base,
    kind: "ticket",
    exp: iat + TICKET_TTL / 1000,
    jti: randomId(16),
    state,
    next,
    tok
  });
  return redirect(`https://${host}/_auth/callback?ticket=${ticket}`);
}

const authorized = (env: Env, req: Request) => {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") && !!env.GATE_TOKEN && safeEqual(h.slice(7), env.GATE_TOKEN.trim());
};

// Clocks of different Worker instances may disagree a little; overlap so nothing falls between two polls.
const SYNC_OVERLAP = MINUTE;

export async function gateApi(env: Env, req: Request, url: URL, now: number): Promise<Response> {
  if (url.pathname === "/api/gate/public-key" && req.method === "GET") return json(publicJwk(env.SIGNING_KEY));
  if (!(await authorized(env, req))) return json({ error: "unauthorized" }, 401);

  if (url.pathname === "/api/gate/sync" && req.method === "GET") {
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0) - SYNC_OVERLAP;
    const [revoked, profiles, tools] = await Promise.all([
      env.DB.prepare("SELECT id FROM sessions WHERE revoked_at IS NOT NULL AND revoked_at >= ? AND expires_at > ?")
        .bind(since, now)
        .all<{ id: string }>(),
      env.DB.prepare("SELECT id, name, avatar, theme FROM users WHERE updated_at >= ?").bind(since).all(),
      listTools(env)
    ]);
    return json({ cursor: now, revoked: revoked.results.map((r) => r.id), profiles: profiles.results, tools });
  }

  // A tool's logout button: team-gate knows the sid from its cookie.
  if (url.pathname === "/api/gate/logout" && req.method === "POST") {
    const { sid } = (await req.json().catch(() => ({}))) as { sid?: unknown };
    if (typeof sid !== "string" || !sid) return json({ error: "sid required" }, 400);
    await revokeSession(env, sid, now);
    return new Response(null, { status: 204 });
  }

  return json({ error: "not found" }, 404);
}
