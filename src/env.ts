export interface Env {
  DB: D1Database;
  HUB_ORIGIN: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_GUILD_ID: string;
  DISCORD_ROLE_ID: string;
  NOTION_TODO_SOURCE: string; // data source id of the TODO database
  // Secrets
  DISCORD_CLIENT_SECRET: string;
  SIGNING_KEY: string; // Ed25519 private key as JWK, from `npm run keygen`
  TOKEN_KEY: string; // 32 random bytes, base64
  GATE_TOKEN: string; // shared with team-gate for /api/gate/*
  ADMIN_DISCORD_ID?: string;
  NOTION_TOKEN?: string;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const SESSION_TTL = 30 * DAY;
export const TOOL_TOKEN_TTL = 7 * DAY;
export const TICKET_TTL = MINUTE;

export const log = (event: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ...data }));

export const isAdmin = (env: Env, userId: string) => !!env.ADMIN_DISCORD_ID && env.ADMIN_DISCORD_ID.trim() === userId;
