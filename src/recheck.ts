import { seal, unseal } from "./crypto";
import { currentMember, RateLimited, refreshGrant, Unreachable } from "./discord";
import { DAY, HOUR, log, type Env } from "./env";
import { revokeUser } from "./session";

// The Free plan allows 50 subrequests and 50 D1 queries per invocation, and each person
// costs two Discord calls and two or three queries, so the cron takes a few at a time.
const BATCH = 8;
const RECHECK_AFTER = DAY - HOUR;

type Result = "ok" | "no_role" | "left" | "revoked" | "unreachable";

export async function recheck(env: Env, now: number): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT u.id, u.refresh_token FROM users u
      WHERE u.refresh_token IS NOT NULL AND (u.checked_at IS NULL OR u.checked_at < ?)
        AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?)
      ORDER BY u.checked_at LIMIT ?`
  )
    .bind(now - RECHECK_AFTER, now, BATCH)
    .all<{ id: string; refresh_token: string }>();

  for (const u of due.results) {
    let result: Result;
    try {
      result = await checkOne(env, u.id, u.refresh_token, now);
    } catch (e) {
      if (e instanceof RateLimited) {
        log("recheck rate limited", { user: u.id });
        break;
      }
      if (!(e instanceof Unreachable)) throw e;
      log("recheck unreachable", { user: u.id, error: e.message.slice(0, 200) });
      result = "unreachable";
    }
    if (result === "ok") continue;
    if (result === "unreachable") {
      await env.DB.prepare("UPDATE users SET check_result = 'unreachable', checked_at = ? WHERE id = ?").bind(now, u.id).run();
      continue;
    }
    await revokeUser(env, u.id, now);
    await env.DB.prepare("UPDATE users SET check_result = ?, checked_at = ?, refresh_token = NULL WHERE id = ?")
      .bind(result, now, u.id)
      .run();
    log("recheck revoked", { user: u.id, result });
  }

  // Revoked sessions are only needed until they would have expired anyway.
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now - DAY).run();
}

async function checkOne(env: Env, userId: string, sealed: string, now: number): Promise<Result> {
  let refresh: string;
  try {
    refresh = await unseal(env.TOKEN_KEY, sealed, userId);
  } catch {
    return "revoked";
  }
  const grant = await refreshGrant(env, refresh);
  if (!grant) return "revoked";
  // Discord rotates refresh tokens; save the new one before anything else can fail.
  await env.DB.prepare("UPDATE users SET refresh_token = ? WHERE id = ?").bind(await seal(env.TOKEN_KEY, grant.refresh, userId), userId).run();

  const m = await currentMember(env, grant.access);
  if (m === "left" || m === "revoked") return m;
  if (!m.roles.includes(env.DISCORD_ROLE_ID)) return "no_role";
  await env.DB.prepare(
    `UPDATE users SET
       updated_at = CASE WHEN name IS NOT ?1 OR avatar IS NOT ?2 THEN ?3 ELSE updated_at END,
       name = ?1, avatar = ?2, check_result = 'ok', checked_at = ?3
     WHERE id = ?4`
  )
    .bind(m.name, m.avatar, now, userId)
    .run();
  return "ok";
}
