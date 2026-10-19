(() => {
  if (document.getElementById('team-chat-widget')) return;
  const hub = new URL(document.currentScript.src).origin;
  const host = document.createElement('div');
  host.id = 'team-chat-widget';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<link rel="stylesheet" href="${hub}/chat-widget.css"><button class="launcher" aria-label="별이와 대화하기" aria-expanded="false">별이</button><div class="panel" hidden><div class="loading" role="status" aria-label="불러오는 중"><div class="lh">별이</div><div class="lb"><i></i></div></div></div>`;
  document.body.append(host);
  const button = root.querySelector('button');
  const panel = root.querySelector('.panel');
  let frame;
  let lastContext = '';
  const readContext = () => {
    const el = document.querySelector('[data-team-chat-kind]');
    const kind = el?.dataset.teamChatKind || 'page';
    const title = (el?.dataset.teamChatTitle || document.querySelector('h1')?.textContent || '').trim().slice(0, 200);
    const context = { kind, title, url: (location.origin + location.pathname + location.hash).slice(0, 500) };
    if (kind === 'issue' || kind === 'item') context.id = Number(el?.dataset.teamChatId);
    if (el?.dataset.teamChatDate) context.date = el.dataset.teamChatDate;
    if (kind === 'item') {
      for (const section of document.querySelectorAll('[data-team-chat-comments]')) {
        if (section.closest('[hidden]')) continue;
        try {
          const comments = JSON.parse(section.dataset.teamChatComments);
          if (comments.itemId === context.id) { context.comments = comments; break; }
        } catch {}
      }
    }
    return context;
  };
  const publish = (requestId) => {
    if (!frame) return;
    const context = readContext();
    const serialized = JSON.stringify(context);
    if (requestId || serialized !== lastContext) {
      frame.contentWindow.postMessage({ type: 'team-chat-context', context, requestId }, hub);
      lastContext = serialized;
    }
  };
  let scheduled = false;
  const changed = () => {
    if (scheduled || !frame) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; publish(); });
  };
  new MutationObserver(changed).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-team-chat-kind','data-team-chat-id','data-team-chat-title','data-team-chat-date','data-team-chat-comments'] });
  window.addEventListener('hashchange', changed);
  window.addEventListener('popstate', changed);
  let closeTimer;
  const close = () => {
    clearTimeout(closeTimer);
    button.setAttribute('aria-expanded', 'false'); button.focus();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { panel.hidden = true; return; }
    panel.classList.add('closing');
    closeTimer = setTimeout(() => { panel.hidden = true; panel.classList.remove('closing'); }, 160);
  };
  button.onclick = () => {
    if (!panel.hidden && !panel.classList.contains('closing')) return close();
    clearTimeout(closeTimer); panel.classList.remove('closing');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = '별이와 대화';
      frame.src = `${hub}/chat/embed`;
      // Keep the loading screen until the frame has painted, so the panel never shows up empty.
      frame.className = 'wait';
      frame.addEventListener('load', () => { frame.className = ''; panel.querySelector('.loading')?.remove(); lastContext = ''; publish(); });
      panel.append(frame);
    }
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    frame.focus();
  };
  window.addEventListener('message', e => {
    if (e.origin !== hub || e.source !== frame?.contentWindow) return;
    if (e.data === 'team-chat-close') close();
    if (e.data?.type === 'team-chat-context-request') publish(e.data.requestId);
  });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
})();
