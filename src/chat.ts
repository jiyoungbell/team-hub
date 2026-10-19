import type { Env } from './env';
import { listTools } from './gate';

export async function chatFrame(env: Env, userId: string): Promise<Response> {
  const hosts = (await listTools(env)).map(t => `https://${t.host}`).filter(h => /^https:\/\/[a-z0-9.-]+$/.test(h));
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/chat.css"><title>별이와 대화</title></head><body data-user="${userId}" data-parent-origins="${encodeURIComponent(JSON.stringify([env.HUB_ORIGIN, ...hosts]))}">
<header><strong>별이</strong><button id="reset" title="새 대화">새 대화</button><button id="close" aria-label="채팅 닫기">✕</button></header>
<main id="messages" role="log" aria-label="대화"></main><p id="status" role="status"></p>
<p id="attachment" aria-live="polite">화면 확인 중…</p>
<form><label class="sr" for="message">별이에게 보낼 메시지</label><textarea id="message" rows="2" maxlength="4000" placeholder="별이에게 물어보세요"></textarea><button id="send" type="submit">보내기</button></form><script src="/chat.js" defer></script></body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': `default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' ${hosts.join(' ')}` }
  });
}

export async function chatReply(req: Request, env: Env, userId: string): Promise<Response> {
  const json = (value: unknown, status: number) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (req.headers.get('origin') !== env.HUB_ORIGIN) return json({ error: 'forbidden' }, 403);
  let data;
  try {
    // Bound the streamed body too; Content-Length is not authoritative.
    const reader = req.body?.getReader();
    if (!reader) return json({ error: 'invalid' }, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 40000) { await reader.cancel(); return json({ error: 'too_large' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return json({ error: 'invalid' }, 400); }
  const { conversation, message } = data ?? {};
  if (typeof conversation !== 'string' || !/^[a-f0-9-]{36}$/.test(conversation) || typeof message !== 'string' || !message.trim() || message.length > 4000) return json({ error: 'invalid' }, 400);
  let context: Record<string, unknown> | undefined;
  if (data.context !== undefined && data.context !== null) {
    const c = data.context;
    if (!c || typeof c !== 'object' || !['page','issue','item','chart','song'].includes(c.kind) || typeof c.title !== 'string' || c.title.length > 200 || typeof c.url !== 'string' || c.url.length > 500) return json({ error: 'context' }, 400);
    let url: URL;
    try { url = new URL(c.url); } catch { return json({ error: 'context' }, 400); }
    const tools = await listTools(env);
    const origins = [env.HUB_ORIGIN, ...tools.map(t => `https://${t.host}`)];
    if (!origins.includes(url.origin) || url.username || url.password || url.search) return json({ error: 'context' }, 400);
    // A page without a heading sends no title; name it after the tool.
    const title = c.title.trim() || (url.origin === env.HUB_ORIGIN ? '팀 허브' : tools.find(t => t.host === url.host)?.name ?? url.host);
    if (['issue','item'].includes(c.kind) && (!Number.isSafeInteger(c.id) || c.id <= 0 || url.hostname !== 'monitor.rescene-remine.com')) return json({ error: 'context' }, 400);
    if (c.date !== undefined && (typeof c.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.date))) return json({ error: 'context' }, 400);
    context = { kind: c.kind, title, url: url.href, ...(['issue','item'].includes(c.kind) ? { id: c.id } : {}), ...(c.date ? { date: c.date } : {}) };
      if (c.comments !== undefined) {
        const m = c.comments;
        if (c.kind !== 'item' || !m || typeof m !== 'object' || m.itemId !== c.id || typeof m.text !== 'string' || m.text.length > 6000 || !Number.isSafeInteger(m.count) || m.count < 0 || m.count > 10000 || !Number.isSafeInteger(m.total) || m.total < m.count || m.total > 1000000 || !Number.isSafeInteger(m.at) || m.at < 0 || typeof m.truncated !== 'boolean') return json({ error: 'comments' }, 400);
        context.comments = { itemId: m.itemId, count: m.count, total: m.total, at: m.at, text: m.text, truncated: m.truncated };
      }
  }
  try {
    const res = await fetch('https://monitor.rescene-remine.com/_chat/bridge', {
      method: 'POST', headers: { authorization: `Bearer ${env.GATE_TOKEN.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ userId, conversation, message, ...(context ? { context } : {}) }), signal: AbortSignal.timeout(115000)
    });
    if (!res.ok) return json({ error: res.status === 429 ? 'busy' : 'unavailable' }, res.status === 429 ? 429 : 502);
    const result = await res.json() as { answer?: unknown };
    if (typeof result.answer !== 'string') throw new Error('invalid reply');
    return json({ answer: result.answer }, 200);
  } catch { return json({ error: 'unavailable' }, 502); }
}
