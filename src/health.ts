import { MINUTE } from "./env";

const TIMEOUT_MS = 2_500;
const seen = new Map<string, { up: boolean; at: number }>();

// Caddy routes this endpoint to the app's health check. Only success means healthy;
// redirects, access errors and rate limits must not appear as up.
async function check(host: string, now: number): Promise<boolean> {
  const hit = seen.get(host);
  if (hit && now - hit.at < MINUTE) return hit.up;
  let up = false;
  try {
    const res = await fetch(`https://${host}/_auth/health`, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    up = res.ok;
  } catch {
    up = false;
  }
  seen.set(host, { up, at: now });
  return up;
}

export async function toolHealth(hosts: string[], now: number): Promise<Map<string, boolean>> {
  const ups = await Promise.all(hosts.map((h) => check(h, now)));
  return new Map(hosts.map((h, i) => [h, ups[i]!]));
}

export const forgetHealth = () => seen.clear();
