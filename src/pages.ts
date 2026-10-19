// Placeholder screens until the real design lands.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (body: string, status = 200, headers: HeadersInit = {}) =>
  new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>리센느 음원총공팀</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;color:#111}
main{display:grid;gap:16px;justify-items:center}
img{width:96px;height:96px;border-radius:50%}
a,button{font:inherit;padding:8px 16px;border:1px solid #111;border-radius:6px;background:#fff;color:#111;text-decoration:none;cursor:pointer}
</style></head><body><main>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } }
  );

export const loginPage = () => page(`<a href="/login">디스코드로 로그인</a>`);

export const homePage = (name: string, avatar: string) =>
  page(`<img src="${esc(avatar)}" alt=""><strong>${esc(name)}</strong>
<form method="post" action="/logout"><button>로그아웃</button></form>`);

export const deniedPage = (headers: HeadersInit) =>
  page(`<strong>권한 없음</strong><a href="/login?again=1">다른 계정으로 로그인</a>`, 403, headers);

export const failedPage = (headers: HeadersInit = {}) =>
  page(`<strong>로그인 실패</strong><a href="/login">다시 시도</a>`, 502, headers);
