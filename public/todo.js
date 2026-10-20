// The small window beside a card (a bottom sheet on phones), the team/person switch, folded
// columns and status changes. The board itself is rendered by the Worker.
(() => {
  const dataEl = document.getElementById("todo-data");
  const overlay = document.getElementById("todo-overlay");
  if (!dataEl || !overlay) return;
  let data = JSON.parse(dataEl.textContent);
  const root = document.documentElement;
  const onTodo = !!document.querySelector("[data-todo-boards]");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const svg = (d, w, sw) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON_X = svg('<path d="M6 6l12 12M18 6 6 18"/>', 20, 2);
  const ICON_OUT = svg('<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>', 16, 2);

  const state = { sel: null, anchor: null, rect: null, busy: false, err: false };

  function setBy(by) {
    if (by === "person") root.dataset.todoBy = "person";
    else delete root.dataset.todoBy;
    document.querySelectorAll("[data-by]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.by === (by === "person" ? "person" : "team"))));
  }
  setBy(root.dataset.todoBy);

  function body(x) {
    const seg = data.statuses.map((s) => `<button type="button" data-status="${esc(s)}" aria-pressed="${x.s === s}">${esc(s)}</button>`).join("");
    const due = x.due ? `<span class="due ${x.due.cls}">${esc(x.due.tag)}</span> · ${esc(x.due.date)}` : "없음";
    const list = (l) => esc(l.join(", ") || "없음");
    return `<div class="d-head"><h2 id="d-title">${esc(x.t)}</h2><button type="button" class="x" data-close aria-label="닫기">${ICON_X}</button></div>
<div class="d-seg" role="group" aria-label="상태"${state.busy ? ' aria-busy="true"' : ""}>${seg}</div>${state.err ? '<p class="d-err" role="alert">저장 실패</p>' : ""}
<dl class="kv"><dt>마감</dt><dd>${due}</dd><dt>작업 팀</dt><dd>${list(x.teams)}</dd><dt>담당자</dt><dd>${list(x.who)}</dd><dt>분류</dt><dd>${esc(x.cat || "없음")}</dd>${x.done ? `<dt>완료일</dt><dd>${esc(x.done)}</dd>` : ""}</dl>
${x.stage ? `<div class="blk"><h3>현재 단계</h3><p>${esc(x.stage)}</p></div>` : ""}${x.next ? `<div class="blk"><h3>다음 행동</h3><p>${esc(x.next)}</p></div>` : ""}${
      x.log.length ? `<div class="blk"><h3>변경 기록</h3><div class="log">${x.log.map((l) => `<span>${esc(l)}</span>`).join("")}</div></div>` : ""
    }<a class="notion full" href="${esc(x.url)}" target="_blank" rel="noopener">노션에서 열기 ${ICON_OUT}</a>`;
  }

  function markSel() {
    document.querySelectorAll("[data-open]").forEach((el) => el.classList.toggle("sel", el.dataset.open === state.sel));
  }

  // Beside the clicked card; flips to the left, or below it, and is nudged to stay on screen.
  function place(el) {
    const r = state.rect;
    if (!r) {
      el.style.left = Math.max(16, (window.innerWidth - el.offsetWidth) / 2) + "px";
      el.style.top = "16vh";
      return;
    }
    const w = el.offsetWidth, h = el.offsetHeight, gap = 10, vw = window.innerWidth, vh = window.innerHeight;
    let left = r.right + gap;
    if (left + w > vw - 16) left = r.left - w - gap;
    if (left < 16) left = Math.min(Math.max(16, r.left), vw - w - 16);
    let top = left === r.right + gap || left === r.left - w - gap ? r.top : r.bottom + gap;
    top = Math.min(Math.max(16, top), vh - h - 16);
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  function render(focus) {
    markSel();
    const x = state.sel && data.items[state.sel];
    const sheet = window.innerWidth < 640;
    // The chat button would sit on top of the sheet's bottom row.
    if (x && sheet) root.dataset.todoSheet = "";
    else delete root.dataset.todoSheet;
    if (!x) { overlay.innerHTML = ""; return; }
    // Same item, same kind of window: only the contents change, so it doesn't fade in again.
    const win = overlay.querySelector(".win");
    if (win && win.dataset.key === state.sel && win.classList.contains("sheet") === sheet) {
      (win.querySelector(".sheet-in") || win).innerHTML = body(x);
      if (!sheet) place(win);
      if (focus) win.querySelector(".x")?.focus();
      return;
    }
    overlay.innerHTML = sheet
      ? `<div class="scrim" data-close></div><div class="win sheet" data-key="${state.sel}" role="dialog" aria-modal="true" aria-labelledby="d-title"><div class="grab"></div><div class="sheet-in">${body(x)}</div></div>`
      : `<div class="win pop" data-key="${state.sel}" role="dialog" aria-labelledby="d-title">${body(x)}</div>`;
    if (!sheet) place(overlay.querySelector(".win.pop"));
    if (focus) overlay.querySelector(".x")?.focus();
  }

  function open(key, el) {
    if (!data.items[key]) return;
    state.sel = key;
    state.anchor = el;
    state.rect = el ? el.getBoundingClientRect() : null;
    state.err = false;
    if (onTodo) history.replaceState(null, "", "#" + key);
    render(true);
  }

  function close() {
    const back = state.anchor;
    state.sel = null;
    state.anchor = state.rect = null;
    if (onTodo && location.hash) history.replaceState(null, "", location.pathname + location.search);
    render(false);
    if (back && back.isConnected) back.focus();
  }

  // New board from the server. Open folds stay open; the window stays where it is.
  function apply(res) {
    const openFolds = [...document.querySelectorAll("[data-fold][aria-expanded='true']")].map((b) => b.closest("[data-board]").dataset.board + "|" + b.closest("[data-col]").dataset.col);
    data = { ...data, items: res.items };
    const rail = document.querySelector("[data-todo-rail]");
    if (rail) rail.innerHTML = res.rail;
    const boards = document.querySelector("[data-todo-boards]");
    if (boards) boards.innerHTML = res.boards;
    for (const b of document.querySelectorAll("[data-fold]")) {
      if (openFolds.includes(b.closest("[data-board]").dataset.board + "|" + b.closest("[data-col]").dataset.col)) toggleFold(b, true);
    }
    const late = document.querySelector("[data-late]");
    if (late) {
      late.textContent = res.late || "";
      late.hidden = !res.late;
    }
    if (state.anchor && !state.anchor.isConnected) state.anchor = null;
  }

  async function setStatus(to) {
    const x = data.items[state.sel];
    if (!x || state.busy || x.s === to) return;
    const key = state.sel;
    const from = x.s;
    state.busy = true;
    state.err = false;
    x.s = to;
    render(false);
    let res = null;
    try {
      const r = await fetch("/todo/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ page: x.page, from, to }),
      });
      res = await r.json();
    } catch (e) {}
    state.busy = false;
    if (res && res.items) apply(res);
    else x.s = from;
    // 409: someone changed it in Notion first; the window now shows that status.
    state.err = !res || (!res.ok && !res.items);
    if (state.sel === key) render(false);
    overlay.querySelector(`[data-status="${CSS.escape(to)}"]`)?.focus();
  }

  function toggleFold(btn, force) {
    const list = btn.nextElementSibling;
    const show = force ?? list.hidden;
    list.hidden = !show;
    btn.setAttribute("aria-expanded", String(show));
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-by],[data-fold],[data-open],[data-close],[data-status]");
    if (!t) {
      if (state.sel && !e.target.closest(".win")) close();
      return;
    }
    if (t.dataset.by) {
      setBy(t.dataset.by);
      store.set("todo-by", t.dataset.by);
    } else if (t.hasAttribute("data-fold")) {
      toggleFold(t);
    } else if (t.dataset.open) {
      open(t.dataset.open, t);
    } else if (t.hasAttribute("data-close")) {
      close();
    } else if (t.dataset.status) {
      setStatus(t.dataset.status);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.sel) close();
  });
  window.addEventListener("resize", () => {
    if (!state.sel) return;
    if (state.anchor && state.anchor.isConnected) state.rect = state.anchor.getBoundingClientRect();
    render(false);
  });
  // Keep the window beside its card while the page or a board scrolls.
  let frame = 0;
  document.addEventListener("scroll", () => {
    if (frame || !state.anchor || !state.anchor.isConnected) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const win = overlay.querySelector(".win.pop");
      if (!win || !state.anchor || !state.anchor.isConnected) return;
      state.rect = state.anchor.getBoundingClientRect();
      place(win);
    });
  }, { capture: true, passive: true });

  // #<item> opens that item, unfolding its column if needed.
  const key = decodeURIComponent(location.hash.slice(1));
  if (onTodo && key && data.items[key]) document.fonts.ready.then(() => openFromHash(key));

  function openFromHash(key) {
    const els = [...document.querySelectorAll(`[data-open="${CSS.escape(key)}"]`)];
    let el = els.find((x) => x.getClientRects().length);
    if (!el) {
      const folded = els.find((x) => x.closest(".folded") && x.closest("[data-board]").getClientRects().length);
      if (folded) {
        toggleFold(folded.closest(".folded").previousElementSibling, true);
        el = folded;
      }
    }
    if (el) el.scrollIntoView({ block: "center", inline: "center" });
    open(key, el || null);
  }
})();
