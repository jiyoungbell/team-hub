(() => {
  const key = `team-chat:${document.body.dataset.user}`;
  const fresh = () => ({ conversation: crypto.randomUUID(), messages: [] });
  let state = fresh();
  try { const saved = JSON.parse(sessionStorage.getItem(key)); if (saved && /^[a-f0-9-]{36}$/.test(saved.conversation) && Array.isArray(saved.messages)) state = saved; } catch {}
  const messages = document.querySelector('#messages');
  const status = document.querySelector('#status');
  const input = document.querySelector('textarea');
  const send = document.querySelector('#send');
  const reset = document.querySelector('#reset');
  let busy = false;
  let context = null;
  const parents = JSON.parse(decodeURIComponent(document.body.dataset.parentOrigins));
  const pending = new Map();
  const label = c => c ? `${({ issue: '이슈', item: '글', song: '곡', chart: '차트', page: '화면' })[c.kind] || '화면'} · ${c.title}${c.date ? ` · ${c.date}` : ''}${c.comments ? ` · 댓글 ${c.comments.count}개${c.comments.truncated ? ' (일부)' : ''}` : ''}` : '화면 정보 없음';
  window.addEventListener('message', e => {
    if (e.source !== window.parent || !parents.includes(e.origin) || e.data?.type !== 'team-chat-context') return;
    const c = e.data.context;
    if (!c || typeof c.title !== 'string' || c.title.length > 200 || typeof c.url !== 'string' || c.url.length > 500) return;
    try { if (new URL(c.url).origin !== e.origin) return; } catch { return; }
    context = c;
    document.querySelector('#attachment').textContent = label(context);
    pending.get(e.data.requestId)?.(context);
  });
  const snapshot = () => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('화면 정보를 확인하지 못했어요. 채팅창을 새로 열어주세요.')); }, 2000);
    pending.set(requestId, c => { clearTimeout(timer); pending.delete(requestId); resolve(c); });
    window.parent.postMessage({ type: 'team-chat-context-request', requestId }, '*');
  });
  const save = () => { try { sessionStorage.setItem(key, JSON.stringify(state)); } catch {} };
  const render = (animate = false) => {
    messages.replaceChildren();
    if (!state.messages.length) {
      const p = document.createElement('p'); p.className = 'welcome'; p.textContent = '안녕하세요, 별이예요 🐶'; messages.append(p);
    }
    for (const m of state.messages) {
      const p = document.createElement('div'); p.className = `message ${m.role === 'user' ? 'user' : 'assistant'}`; p.textContent = m.text; if (m.context) { const note = document.createElement('small'); note.className = 'sent-context'; note.textContent = label(m.context); p.prepend(note); } messages.append(p);
    }
    if (animate) messages.lastElementChild?.classList.add('fresh');
    messages.scrollTop = messages.scrollHeight;
  };
  const close = () => window.parent.postMessage('team-chat-close', '*');
  document.querySelector('#close').onclick = close;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  reset.onclick = () => { if (busy) return; state = fresh(); save(); render(); status.textContent = ''; input.focus(); };
  document.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const message = input.value.trim();
    if (busy || !message) return;
    busy = true; send.disabled = reset.disabled = true; input.readOnly = true;
    let attached;
    try { attached = await snapshot(); } catch (e) { status.textContent = e.message; busy = false; send.disabled = reset.disabled = false; input.readOnly = false; return; }
    input.value = '';
    state.messages.push({ role: 'user', text: message, context: attached }); render(true);
    status.textContent = '별이가 답변하고 있어요…';
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversation: state.conversation, message, context: attached }), signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(res.status === 401 ? '로그인이 만료되었어요. 허브에서 로그인해 주세요.' : res.status === 429 ? '지금 답변 중인 대화가 있어요. 잠시 후 다시 보내주세요.' : '답변을 받지 못했어요. 잠시 후 다시 시도해 주세요.');
      const result = await res.json();
      state.messages.push({ role: 'assistant', text: result.answer });
      state.messages = state.messages.slice(-100); save(); status.textContent = '';
    } catch (e) {
      state.messages.pop(); input.value = message;
      status.textContent = e.name === 'TimeoutError' ? '답변이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.' : e.message;
    } finally { busy = false; send.disabled = reset.disabled = false; input.readOnly = false; render(!status.textContent); if (document.hasFocus()) input.focus(); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); document.querySelector('form').requestSubmit(); } });
  render(); input.focus();
})();
