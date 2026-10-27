// Melon song search and play time. Search and JSONP handling follow bill-ji-maker's worker.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const TIMEOUT_MS = 8_000;
const CALLBACK = "smingCallback";
const QUERY_MAX_CHARS = 20;
const MAX_RESULTS = 8;

export class MelonError extends Error {}

export interface MelonSong {
  melon: string;
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  sec: number | null;
}

const get = (url: string) => fetch(url, { headers: { "user-agent": UA, referer: "https://www.melon.com/" }, signal: AbortSignal.timeout(TIMEOUT_MS) });

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, b: string) => {
    if (b[0] !== "#") return NAMED[b.toLowerCase()] ?? m;
    const code = b[1] === "x" || b[1] === "X" ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });

// Melon answers nothing once the query passes 20 characters, not counting spaces.
// It matches from the start of the title, so the first 20 are enough.
export function fitQuery(query: string): string {
  let kept = 0;
  let end = 0;
  for (const ch of query) {
    if (!/\s/.test(ch)) {
      if (kept === QUERY_MAX_CHARS) break;
      kept++;
    }
    end += ch.length;
  }
  return query.slice(0, end).trim();
}

function parseJsonp(text: string): unknown {
  let body = text.trim();
  if (!body.startsWith(`${CALLBACK}(`)) throw new MelonError("unexpected jsonp");
  body = body.slice(CALLBACK.length + 1).replace(/;$/, "");
  if (!body.endsWith(")")) throw new MelonError("unexpected jsonp");
  return JSON.parse(body.slice(0, -1));
}

interface Content {
  SONGID?: string;
  SONGNAME?: string;
  ARTISTNAME?: string;
  ALBUMNAME?: string;
  ALBUMIMG?: string;
}

// Melon's own pages double-encode the query.
export async function searchSongs(query: string): Promise<Omit<MelonSong, "sec">[]> {
  const q = encodeURIComponent(encodeURIComponent(fitQuery(query)));
  const res = await get(`https://www.melon.com/search/keyword/index.json?query=${q}&jscallback=${CALLBACK}`);
  if (!res.ok) throw new MelonError(`melon search ${res.status}`);
  const parsed = parseJsonp(await res.text()) as { SONGCONTENTS?: Content[] };
  const list = Array.isArray(parsed.SONGCONTENTS) ? parsed.SONGCONTENTS : [];
  return list
    .filter((c) => typeof c.SONGID === "string" && /^\d+$/.test(c.SONGID) && typeof c.SONGNAME === "string")
    .slice(0, MAX_RESULTS)
    .map((c) => ({
      melon: c.SONGID!,
      title: decode(c.SONGNAME!),
      artist: decode(c.ARTISTNAME ?? ""),
      album: decode(c.ALBUMNAME ?? ""),
      cover: coverOf(c.ALBUMIMG)
    }));
}

// The search hands out a 40px cover; ask for 80 so it's sharp on a phone.
function coverOf(url: string | undefined): string | null {
  if (!url?.startsWith("https://cdnimg.melon.co.kr/")) return null;
  return url.replace(/\/resize\/\d+$/, "/resize/80");
}

// The app API has the play time in seconds; the web pages don't.
export async function playTime(id: string): Promise<number | null> {
  const res = await get(`https://m2.melon.com/m6/v2/song/info.json?songId=${id}`);
  if (!res.ok) throw new MelonError(`melon song ${res.status}`);
  const body = (await res.json()) as { response?: { SONGINFO?: { SONGID?: string; PLAYTIME?: string | number } } };
  const info = body.response?.SONGINFO;
  const sec = Number(info?.PLAYTIME);
  return info?.SONGID === id && Number.isInteger(sec) && sec > 0 ? sec : null;
}

export async function search(query: string): Promise<MelonSong[]> {
  const songs = await searchSongs(query);
  const secs = await Promise.all(songs.map((s) => playTime(s.melon).catch(() => null)));
  return songs.map((s, i) => ({ ...s, sec: secs[i] ?? null }));
}
