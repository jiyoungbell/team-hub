import { randomId, sha256 } from "./crypto";
import { HOUR, SESSION_TTL, type Env } from "./env";

export const SESSION_COOKIE = "__Host-session";

export interface Session {
  id: string;
  userId: string;
  expiresAt: number;
  name: string;
  avatar: string;
  theme: string | null;
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export const cookie = (name: string, value: string, maxAgeSec: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;

// The cookie holds `<sid>.<secret>`. Only the secret's hash is stored, and only the sid
// ever leaves the hub (in tool tokens and the revoked list).
export async function createSession(env: Env, userId: string, now: number): Promise<string> {
  const sid = randomId(18);
  const secret = randomId(32);
  await env.DB.prepare("INSERT INTO sessions (id, user_id, secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(sid, userId, await sha256(secret), now, now + SESSION_TTL)
    .run();
  return cookie(SESSION_COOKIE, `${sid}.${secret}`, SESSION_TTL / 1000);
}

interface Row {
  id: string;
  user_id: string;
  secret_hash: string;
  expires_at: number;
  revoked_at: number | null;
  name: string;
  avatar: string;
  theme: string | null;
  last_seen_at: number | null;
}

export async function currentSession(env: Env, req: Request, now: number): Promise<Session | null> {
  const raw = readCookie(req, SESSION_COOKIE);
  const [sid, secret] = raw?.split(".") ?? [];
  if (!sid || !secret) return null;
  const row = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.secret_hash, s.expires_at, s.revoked_at, u.name, u.avatar, u.theme, u.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
  )
    .bind(sid)
    .first<Row>();
  if (!row || row.revoked_at !== null || row.expires_at <= now || row.secret_hash !== (await sha256(secret))) return null;
  if ((row.last_seen_at ?? 0) < now - HOUR) {
    await env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(now, row.user_id).run();
  }
  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at, name: row.name, avatar: row.avatar, theme: row.theme };
}

export const revokeSession = (env: Env, sid: string, now: number) =>
  env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, sid).run();

export const revokeUser = (env: Env, userId: string, now: number) =>
  env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, userId).run();
