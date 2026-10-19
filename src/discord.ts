import type { Env } from "./env";

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 8_000;
export const SCOPES = "identify guilds.members.read";

export interface Grant {
  access: string;
  refresh: string;
}

export interface Member {
  id: string;
  name: string;
  avatar: string;
  roles: string[];
}

// Discord didn't answer usefully (timeout, 5xx); try again later.
export class Unreachable extends Error {}
export class RateLimited extends Unreachable {}

export const redirectUri = (env: Env) => `${env.HUB_ORIGIN}/auth/callback`;

// `again` is for someone who was turned away and wants to pick another account:
// prompt=consent shows Discord's screen so they can switch.
export function authorizeUrl(env: Env, state: string, again: boolean): string {
  const q = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(env),
    scope: SCOPES,
    state,
    prompt: again ? "consent" : "none"
  });
  return `https://discord.com/oauth2/authorize?${q}`;
}

async function call(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Unreachable(String(e));
  }
  const text = await res.text().catch(() => "");
  if (res.status === 429) throw new RateLimited(`HTTP 429 ${url}`);
  if (res.status >= 500) throw new Unreachable(`HTTP ${res.status} ${url}`);
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body: body && typeof body === "object" ? (body as Record<string, unknown>) : {} };
}

async function token(env: Env, params: Record<string, string>): Promise<Grant | null> {
  const r = await call(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET.trim(), ...params })
  });
  // Only invalid_grant means the person's grant is gone. Anything else (a wrong client
  // secret, say) must not look like it, or the recheck would log everyone out.
  if (r.status === 400 && r.body.error === "invalid_grant") return null;
  if (r.status !== 200) throw new Unreachable(`token HTTP ${r.status} ${String(r.body.error ?? "")}`);
  const { access_token, refresh_token, scope } = r.body;
  if (typeof access_token !== "string" || typeof refresh_token !== "string") throw new Unreachable("token response without tokens");
  if (typeof scope !== "string" || !scope.split(" ").includes("guilds.members.read")) return null;
  return { access: access_token, refresh: refresh_token };
}

export const exchangeCode = (env: Env, code: string) =>
  token(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri(env) });

// null means the grant is gone (user removed the app, or the token is stale).
export const refreshGrant = (env: Env, refresh: string) => token(env, { grant_type: "refresh_token", refresh_token: refresh });

// The member as the person sees themselves in the team server; "left" if they aren't in it,
// "revoked" if the access token no longer works.
export async function currentMember(env: Env, access: string): Promise<Member | "left" | "revoked"> {
  const r = await call(`${API}/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, { headers: { authorization: `Bearer ${access}` } });
  if (r.status === 404) return "left";
  if (r.status === 401 || r.status === 403) return "revoked";
  if (r.status !== 200) throw new Unreachable(`member HTTP ${r.status}`);
  return toMember(env.DISCORD_GUILD_ID, r.body);
}

interface RawUser {
  id?: unknown;
  username?: unknown;
  global_name?: unknown;
  avatar?: unknown;
}

export function toMember(guildId: string, body: Record<string, unknown>): Member {
  const user = (body.user ?? {}) as RawUser;
  if (typeof user.id !== "string" || !/^\d{5,25}$/.test(user.id)) throw new Unreachable("member without user id");
  const id = user.id;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const name = str(body.nick) ?? str(user.global_name) ?? str(user.username) ?? id;
  const ext = (hash: string) => (hash.startsWith("a_") ? "gif" : "png");
  const guildAvatar = str(body.avatar);
  const userAvatar = str(user.avatar);
  const avatar = guildAvatar
    ? `https://cdn.discordapp.com/guilds/${guildId}/users/${id}/avatars/${guildAvatar}.${ext(guildAvatar)}?size=128`
    : userAvatar
      ? `https://cdn.discordapp.com/avatars/${id}/${userAvatar}.${ext(userAvatar)}?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
  const roles = Array.isArray(body.roles) ? body.roles.filter((r): r is string => typeof r === "string") : [];
  return { id, name, avatar, roles };
}
