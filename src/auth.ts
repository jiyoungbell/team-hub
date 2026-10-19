import { b64url, fromB64, randomId, seal } from "./crypto";
import { authorizeUrl, currentMember, exchangeCode, type Member, Unreachable } from "./discord";
import { log, type Env } from "./env";
import { deniedPage, failedPage } from "./pages";
import { cookie, createSession, readCookie, SESSION_COOKIE } from "./session";

const OAUTH_COOKIE = "__Host-oauth";
const enc = new TextEncoder();
const dec = new TextDecoder();

// A path on the same site: no scheme, no host, no protocol-relative tricks.
export const safePath = (p: string | null): string | null =>
  p && p.length < 2048 && /^\/(?![/\\])[^\s\\]*$/.test(p) ? p : null;

export const redirect = (to: string, cookies: string[] = []) => {
  const h = new Headers({ location: to, "cache-control": "no-store" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
};

export function login(env: Env, url: URL): Response {
  const state = randomId(18);
  const next = safePath(url.searchParams.get("next")) ?? "/";
  return redirect(authorizeUrl(env, state, url.searchParams.get("again") === "1"), [
    cookie(OAUTH_COOKIE, `${state}.${b64url(enc.encode(next))}`, 600)
  ]);
}

export async function callback(env: Env, req: Request, url: URL, now: number): Promise<Response> {
  const clear = cookie(OAUTH_COOKIE, "", 0);
  const [state, nextB64] = readCookie(req, OAUTH_COOKIE)?.split(".") ?? [];
  const code = url.searchParams.get("code");
  if (!state || state !== url.searchParams.get("state")) return failedPage({ "set-cookie": clear });
  // Cancelled on Discord's screen.
  if (!code) return redirect("/", [clear]);
  const next = safePath(nextB64 ? dec.decode(fromB64(nextB64)) : null) ?? "/";

  let member: Member;
  let refresh: string;
  try {
    const grant = await exchangeCode(env, code);
    if (!grant) return failedPage({ "set-cookie": clear });
    const m = await currentMember(env, grant.access);
    if (m === "revoked") return failedPage({ "set-cookie": clear });
    if (m === "left" || !m.roles.includes(env.DISCORD_ROLE_ID)) {
      log("login denied", { reason: m === "left" ? "left" : "no_role" });
      return deniedPage({ "set-cookie": clear });
    }
    member = m;
    refresh = grant.refresh;
  } catch (e) {
    if (!(e instanceof Unreachable)) throw e;
    log("login failed", { error: e.message.slice(0, 200) });
    return failedPage({ "set-cookie": clear });
  }

  await env.DB.prepare(
    `INSERT INTO users (id, name, avatar, refresh_token, check_result, checked_at, last_seen_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'ok', ?5, ?5, ?5, ?5)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = CASE WHEN users.name IS NOT excluded.name OR users.avatar IS NOT excluded.avatar
                         THEN excluded.updated_at ELSE users.updated_at END,
       name = excluded.name, avatar = excluded.avatar, refresh_token = excluded.refresh_token,
       check_result = 'ok', checked_at = excluded.checked_at, last_seen_at = excluded.last_seen_at`
  )
    .bind(member.id, member.name, member.avatar, await seal(env.TOKEN_KEY, refresh, member.id), now)
    .run();
  log("login", { user: member.id });
  return redirect(next, [clear, await createSession(env, member.id, now)]);
}

export const clearSession = () => cookie(SESSION_COOKIE, "", 0);
