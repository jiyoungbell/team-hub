import { randomId } from "./crypto";
import type { Env } from "./env";

export interface Song {
  title: string;
  sec: number;
  melon?: string; // absent for a song typed in before release
  artist?: string;
  cover?: string;
}

export interface SmingList {
  id: string;
  name: string;
  songs: Record<string, Song>;
  items: string[];
  version: number;
  created_by: string | null;
  updated_name: string;
  updated_at: number;
}

export interface SmingRow {
  id: string;
  name: string;
  count: number;
  sec: number;
  updated_name: string;
  updated_at: number;
}

export const NEW_NAME = "새 슴리";
const MAX_ITEMS = 300;
const KEY = /^[mu][\w-]{1,24}$/;
export const LIST_ID = /^[\w-]{8}$/;

export const totalSec = (songs: Record<string, Song>, items: string[]) => items.reduce((n, k) => n + (songs[k]?.sec ?? 0), 0);

interface Row {
  id: string;
  name: string;
  songs: string;
  items: string;
  version: number;
  created_by: string | null;
  updated_name: string | null;
  updated_at: number;
}

const SELECT = `SELECT l.id, l.name, l.songs, l.items, l.version, l.created_by, u.name AS updated_name, l.updated_at
  FROM slists l LEFT JOIN users u ON u.id = l.updated_by`;

const toList = (r: Row): SmingList => ({
  id: r.id,
  name: r.name,
  songs: JSON.parse(r.songs) as Record<string, Song>,
  items: JSON.parse(r.items) as string[],
  version: r.version,
  created_by: r.created_by,
  updated_name: r.updated_name ?? "",
  updated_at: r.updated_at
});

export async function listLists(env: Env): Promise<SmingRow[]> {
  const { results } = await env.DB.prepare(`${SELECT} ORDER BY l.updated_at DESC`).all<Row>();
  return results.map((r) => {
    const l = toList(r);
    return { id: l.id, name: l.name, count: l.items.length, sec: totalSec(l.songs, l.items), updated_name: l.updated_name, updated_at: l.updated_at };
  });
}

export async function loadList(env: Env, id: string): Promise<SmingList | null> {
  if (!LIST_ID.test(id)) return null;
  const r = await env.DB.prepare(`${SELECT} WHERE l.id = ?`).bind(id).first<Row>();
  return r ? toList(r) : null;
}

// A new empty list, or a copy of `from` under "<name> 사본". `userId` is null for someone not signed in.
export async function createList(env: Env, userId: string | null, now: number, from: SmingList | null): Promise<string> {
  const id = randomId(6);
  await env.DB.prepare("INSERT INTO slists (id, name, songs, items, version, created_by, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)")
    .bind(id, from ? `${from.name} 사본`.slice(0, 60) : NEW_NAME, JSON.stringify(from?.songs ?? {}), JSON.stringify(from?.items ?? []), userId, userId, now)
    .run();
  return id;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function cleanSong(v: unknown): Song | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const title = text(s.title, 100);
  const sec = s.sec;
  if (!title || typeof sec !== "number" || !Number.isInteger(sec) || sec < 1 || sec >= 3600) return null;
  const song: Song = { title, sec };
  if (s.melon !== undefined) {
    if (typeof s.melon !== "string" || !/^\d{1,12}$/.test(s.melon)) return null;
    song.melon = s.melon;
  }
  const artist = text(s.artist, 100);
  if (artist) song.artist = artist;
  if (typeof s.cover === "string" && s.cover.startsWith("https://cdnimg.melon.co.kr/") && s.cover.length <= 300) song.cover = s.cover;
  return song;
}

// What a save may hold. Songs no row points at are dropped.
export function cleanInput(input: unknown): { version: number; name: string; songs: Record<string, Song>; items: string[] } | null {
  if (!input || typeof input !== "object") return null;
  const b = input as Record<string, unknown>;
  if (typeof b.version !== "number" || !Array.isArray(b.items) || b.items.length > MAX_ITEMS) return null;
  if (!b.songs || typeof b.songs !== "object") return null;
  const given = b.songs as Record<string, unknown>;
  const songs: Record<string, Song> = {};
  for (const key of b.items) {
    if (typeof key !== "string" || !KEY.test(key) || !Object.hasOwn(given, key)) return null;
    if (songs[key]) continue;
    const song = cleanSong(given[key]);
    if (!song) return null;
    songs[key] = song;
  }
  return { version: b.version, name: text(b.name, 60) || NEW_NAME, songs, items: b.items as string[] };
}

export type SaveResult = { status: 200 | 409; list: SmingList } | { status: 400 | 404 };

// Saves only over the version the person saw; otherwise they get the newer list back.
export async function saveList(env: Env, userId: string | null, id: string, input: unknown, now: number): Promise<SaveResult> {
  const v = cleanInput(input);
  if (!v) return { status: 400 };
  const r = await env.DB.prepare(
    "UPDATE slists SET name = ?, songs = ?, items = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?"
  )
    .bind(v.name, JSON.stringify(v.songs), JSON.stringify(v.items), userId, now, id, v.version)
    .run();
  const list = await loadList(env, id);
  if (!list) return { status: 404 };
  return { status: r.meta.changes ? 200 : 409, list };
}

// Signed in only: the maker, or the admin. A list made without signing in is the admin's to delete.
export const canDelete = (list: SmingList, userId: string | null, admin: boolean) => admin || (!!userId && list.created_by === userId);

export async function deleteList(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM slists WHERE id = ?").bind(id).run();
}

export function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}
