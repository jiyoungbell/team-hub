import { MINUTE, type Env } from "./env";
import type { Tool } from "./gate";

const TIMEOUT_MS = 2_500;

// Caddy routes this endpoint to the app's health check. Only success means healthy;
// redirects, access errors and rate limits must not appear as up.
async function probe(host: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}/_auth/health`, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

async function refresh(env: Env, host: string, now: number): Promise<boolean> {
  // Claim the check so concurrent requests don't all probe the same host.
  const claim = await env.DB.prepare("UPDATE tools SET checked_at = ? WHERE host = ? AND (checked_at IS NULL OR checked_at < ?)")
    .bind(now, host, now - MINUTE)
    .run();
  if (!claim.meta.changes) return false;
  const up = await probe(host);
  await env.DB.prepare("UPDATE tools SET up = ? WHERE host = ?").bind(up ? 1 : 0, host).run();
  return up;
}

// Answers from the last stored check; stale ones are rechecked after the response
// (waitUntil), so a dead home server never slows the hub down. Only a tool that was
// never checked is probed inline.
export async function toolHealth(env: Env, tools: Tool[], now: number, ctx?: ExecutionContext): Promise<Map<string, boolean>> {
  const health = new Map<string, boolean>();
  await Promise.all(
    tools.map(async (t) => {
      if (t.up === null) {
        health.set(t.host, await refresh(env, t.host, now));
        return;
      }
      health.set(t.host, t.up === 1);
      if ((t.checked_at ?? 0) < now - MINUTE) {
        const job = refresh(env, t.host, now);
        if (ctx) ctx.waitUntil(job);
        else await job;
      }
    })
  );
  return health;
}
