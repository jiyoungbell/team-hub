// The small window beside a card (a bottom sheet on phones), the team/person switch, folded
// columns, the add row and every change. The page keeps a copy of the data and draws the board
// with the Worker's own code (window.TodoView, from /todo-view.js), so a change shows the moment
// it is made. Saves go out behind it; each answers with the server's copy, which replaces the
// page's once nothing else is on the way.
(() => {
  const dataEl = document.getElementById("todo-data");
  const overlay = document.getElementById("todo-overlay");
  if (!dataEl || !overlay || !window.TodoView) return;
  let data = JSON.parse(dataEl.textContent);
  const root = document.documentElement;
  const onTodo = !!document.querySelector("[data-todo-boards]");
  const toastEl = document.getElementById("todo-toast");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const EASE = "cubic-bezier(.2,.7,.2,1)";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const svg = (d, w, sw) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON_X = svg('<path d="M6 6l12 12M18 6 6 18"/>', 20, 2);
  const ICON_X_SM = svg('<path d="M6 6l12 12M18 6 6 18"/>', 14, 2.2);
  const ICON_PLUS = svg('<path d="M12 5v14M5 12h14"/>', 14, 2.2);
  const ICON_OUT = svg('<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>', 16, 2);

  const DONE = "완료";
  const NEW = "시작 전";
  // Item fields that can be edited → what /todo/edit calls them.
  const API = { title: "title", assignees: "assignees", teams: "teams", due_start: "due" };
  // Lists in the window → item fields.
  const LIST = { who: "assignees", teams: "teams" };
  const LABEL = { who: "담당자", teams: "작업 팀" };
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const copy = (v) => (Array.isArray(v) ? v.slice() : v);
  const typing = (el) => !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT");
  const keyOf = (id) => id.replace(/-/g, "");
  const item = (key) => data.items.find((x) => keyOf(x.page_id) === key);
  const stamp = () => new Date().toISOString();

  // pick: which list in the window is spread out to choose from ("who" | "teams").
  const state = { sel: null, anchor: null, anchorCol: null, rect: null, err: false, pick: null };

  function setBy(by) {
    if (by === "person") root.dataset.todoBy = "person";
    else delete root.dataset.todoBy;
    document.querySelectorAll("[data-by]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.by === (by === "person" ? "person" : "team"))));
  }
  setBy(root.dataset.todoBy);

  // ---- Drawing
  const paint = () => window.TodoView.renderTodo({ ...data, changes: new Map(Object.entries(data.changes)) }, true);
  let view = paint(); // the page arrives drawn by the Worker; this is the same drawing
  const flashKeys = new Set();
  const alias = new Map(); // a just-saved item's placeholder key → its real key, so the card stays put

  const colOf = (el) => el.closest("[data-col]")?.dataset.col || "";
  const ident = (el) => (el.classList.contains("mk") ? "mk:" : "tc:") + (alias.get(el.dataset.open) || el.dataset.open);
  function measure() {
    const out = [];
    for (const el of document.querySelectorAll("[data-open]")) {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) out.push({ el, r, id: ident(el), col: colOf(el) });
    }
    return out;
  }

  // Cards glide from where they were to where they are; ones that left fade out in place, new ones
  // fade in. A card is matched in the same column first, so one moving between columns slides across.
  function slide(before) {
    const olds = new Map();
    for (const o of before) (olds.get(o.id) || olds.set(o.id, []).get(o.id)).push(o);
    const pairs = [];
    const rest = [];
    for (const n of measure()) {
      const l = olds.get(n.id);
      const i = l ? l.findIndex((o) => o.col === n.col) : -1;
      if (i >= 0) pairs.push([l.splice(i, 1)[0], n]);
      else rest.push(n);
    }
    for (const n of rest) {
      const l = olds.get(n.id);
      if (l && l.length) pairs.push([l.shift(), n]);
      else if (n.r.bottom > 0 && n.r.top < innerHeight) n.el.animate([{ opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1 }], { duration: 220, easing: EASE });
    }
    for (const l of olds.values()) l.forEach(ghost);
    for (const [o, n] of pairs) {
      const dx = o.r.left - n.r.left;
      const dy = o.r.top - n.r.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      if ((o.r.bottom < 0 || o.r.top > innerHeight) && (n.r.bottom < 0 || n.r.top > innerHeight)) continue;
      n.el.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 240, easing: EASE });
    }
  }

  function ghost(o) {
    if (o.r.bottom < 0 || o.r.top > innerHeight) return;
    const g = o.el.cloneNode(true);
    g.removeAttribute("data-open");
    g.classList.remove("sel");
    g.setAttribute("aria-hidden", "true");
    g.tabIndex = -1;
    Object.assign(g.style, {
      position: "fixed", left: o.r.left + "px", top: o.r.top + "px", width: o.r.width + "px", height: o.r.height + "px",
      margin: "0", transform: "none", pointerEvents: "none", zIndex: "5",
    });
    document.body.append(g);
    g.animate([{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.96 }], { duration: 180, easing: "ease-in" }).onfinish = () => g.remove();
  }

  // Redraws the rail and boards from `data`. Open folds, sideways scroll and the window stay.
  function draw(opts = {}) {
    view = paint();
    const before = still.matches ? null : measure();
    const where = (b) => b.closest("[data-board]").dataset.board + "|" + b.closest("[data-col]").dataset.col;
    const openFolds = [...document.querySelectorAll("[data-fold][aria-expanded='true']")].map(where);
    const scrolls = [...document.querySelectorAll("[data-board], .rail-wrap")].map((el) => [el.dataset.board || "", el.scrollLeft]);
    const rail = document.querySelector("[data-todo-rail]");
    if (rail) rail.innerHTML = view.rail;
    const boards = document.querySelector("[data-todo-boards]");
    if (boards) boards.innerHTML = view.boards;
    for (const b of document.querySelectorAll("[data-fold]")) if (openFolds.includes(where(b))) toggleFold(b, true);
    for (const [name, left] of scrolls) {
      const el = name ? document.querySelector(`[data-board="${name}"]`) : document.querySelector(".rail-wrap");
      if (el) el.scrollLeft = left;
    }
    const late = document.querySelector("[data-late]");
    if (late) {
      late.textContent = view.late || "";
      late.hidden = !view.late;
    }
    const empty = document.querySelector("[data-todo-empty]");
    if (empty) empty.hidden = data.items.length > 0;
    document.querySelectorAll('[data-open^="tmp"]').forEach((el) => el.classList.add("pending"));
    for (const k of flashKeys) cardsOf(k).forEach((el) => el.classList.add("new"));
    flashKeys.clear();
    if (before) slide(before);

    if (!state.sel) return;
    if (!view.details[state.sel]) return close();
    if (!state.anchor || !state.anchor.isConnected) state.anchor = cardFor(state.sel, state.anchorCol);
    if (state.anchor) state.rect = state.anchor.getBoundingClientRect();
    if (opts.window !== false) render(false);
  }

  const cardsOf = (key) => document.querySelectorAll(`[data-open="${CSS.escape(key)}"]`);
  function cardFor(key, col) {
    const shown = [...cardsOf(key)].filter((el) => el.getClientRects().length);
    return shown.find((el) => colOf(el) === col) || shown[0] || null;
  }

  // Slides a board sideways to a card's column, so an add always shows where it went.
  function reveal(el) {
    const col = el && el.closest(".col");
    const board = col && col.parentElement;
    if (!board) return;
    const left = col.offsetLeft - board.offsetLeft;
    if (left < board.scrollLeft || left + col.offsetWidth > board.scrollLeft + board.clientWidth) board.scrollTo({ left: Math.max(0, left - 14), behavior: still.matches ? "auto" : "smooth" });
  }

  // A line in the window's change log right away; the server's own replaces it.
  function note(it, field, from, to) {
    const l = data.changes[it.page_id] || (data.changes[it.page_id] = []);
    l.unshift({ page_id: it.page_id, user_name: data.user, field, from_value: from, to_value: to, at: Date.now() });
    l.length = Math.min(l.length, 5);
  }

  // ---- Saving
  // Saves for one item go out one at a time, in order. The server's copy is taken from the latest
  // answer once nothing is left to send, so an older answer never undoes a newer change.
  let inflight = 0;
  let latest = null;
  let lastFetch = Date.now();
  const queues = new Map();
  const keep = new Map(); // deleted items being brought back: shown even if an answer predates it

  function send(path, body, key) {
    inflight++;
    const run = async () => {
      let res = null;
      try {
        const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true });
        res = await r.json();
      } catch (e) {}
      inflight--;
      lastFetch = Date.now();
      if (res && res.ok && res.key && path === "/todo/items") {
        alias.set(key, res.key);
        flashKeys.add(res.key);
      }
      if (res && res.data) latest = res;
      if (!inflight && latest) {
        const l = latest;
        latest = null;
        try { apply(l.data); } catch (e) {}
      }
      return res;
    };
    const p = (queues.get(key) || Promise.resolve()).then(run);
    queues.set(key, p);
    return p;
  }

  // The server's copy, with changes not sent yet put back on top.
  function apply(next) {
    data = next;
    for (const w of waiting.values()) {
      const it = item(w.key);
      if (it) it[w.field] = copy(w.to);
    }
    for (const [k, it] of keep) if (!item(k)) data.items.push(it);
    draw();
    alias.clear();
  }

  // A change to the open item. On failure the item goes back and the window says so; a 409 on a
  // status means Notion had another one, and the window just shows it.
  async function save(key, path, body, revert) {
    const res = await send(path, body, key);
    const failed = !res || !res.data;
    if (failed) {
      const it = item(key);
      if (it && revert) revert(it);
      draw({ window: false });
    }
    if (state.sel === key) {
      state.err = failed || (!res.ok && path !== "/todo/status");
      render(false);
    }
    return res;
  }

  // Taps on chips and date changes wait a moment and go as one save (Notion allows ~3 a second).
  const waiting = new Map();
  function queueEdit(key, field, from, to, delay) {
    const id = key + "|" + field;
    const w = waiting.get(id);
    if (w) clearTimeout(w.timer);
    const entry = { key, field, from: w ? w.from : copy(from), to: copy(to) };
    entry.timer = setTimeout(() => flush(id), delay);
    waiting.set(id, entry);
  }
  function flush(id) {
    const w = waiting.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    waiting.delete(id);
    const it = item(w.key);
    if (!it || same(w.from, w.to)) return;
    const shown = (v) => (Array.isArray(v) ? v.join(", ") : v);
    note(it, API[w.field], shown(w.from), shown(w.to));
    // A title is saved as it loses focus, often on the way to a click in the window: leave the
    // window alone so that click still lands.
    draw({ window: w.field !== "title" });
    save(w.key, "/todo/edit", { page: it.page_id, field: API[w.field], from: w.from, to: w.to }, (x) => (x[w.field] = copy(w.from)));
  }
  const flushAll = () => [...waiting.keys()].forEach(flush);

  // ---- Window
  function chips(list, x) {
    const on = list === "who" ? x.who : x.teams;
    if (state.pick === list) {
      const all = list === "who" ? view.pick.names : view.pick.teams;
      return `<div class="chips">${[...all, ...on.filter((v) => !all.includes(v))]
        .map((v) => `<button type="button" class="chip" data-toggle="${list}" data-v="${esc(v)}" aria-pressed="${on.includes(v)}">${esc(v)}</button>`)
        .join("")}</div>`;
    }
    return `<div class="chips">${on.map((v) => `<button type="button" class="chip on" data-pick="${list}" data-v="${esc(v)}">${esc(v)}</button>`).join("")}<button type="button" class="chip add" data-pick="${list}" aria-label="${LABEL[list]} 고르기">${ICON_PLUS}</button></div>`;
  }

  const dueTag = (x) => (x.due ? `<span class="due ${x.due.cls}">${esc(x.due.tag)}</span>${x.ds && x.ds.length > 10 ? ` <span class="muted">${esc(x.ds.slice(11, 16))}</span>` : ""}` : "");

  // The title is kept apart: while it is being typed, only the rest is redrawn.
  const body = (x) =>
    `<div class="d-head"><textarea class="d-title" rows="1" maxlength="200" aria-label="제목" spellcheck="false">${esc(x.t)}</textarea><button type="button" class="x" data-close aria-label="닫기">${ICON_X}</button></div><div class="d-rest">${rest(x)}</div>`;

  function rest(x) {
    const seg = data.statuses.map((s) => `<button type="button" data-status="${esc(s)}" aria-pressed="${x.s === s}">${esc(s)}</button>`).join("");
    return `<div class="d-seg" role="group" aria-label="상태">${seg}</div>${state.err ? '<p class="d-err" role="alert">저장 실패</p>' : ""}
<dl class="kv"><dt>마감</dt><dd class="d-due"><input type="date" data-due value="${esc(x.ds ? x.ds.slice(0, 10) : "")}" aria-label="마감일">${
      x.ds ? `<button type="button" class="chip-x" data-due-clear aria-label="마감일 지우기">${ICON_X_SM}</button>` : ""
    }<span data-due-tag>${dueTag(x)}</span></dd><dt>작업 팀</dt><dd>${chips("teams", x)}</dd><dt>담당자</dt><dd>${chips("who", x)}</dd><dt>분류</dt><dd>${esc(x.cat || "없음")}</dd>${
      x.done ? `<dt>완료일</dt><dd>${esc(x.done)}</dd>` : ""
    }</dl>
${x.stage ? `<div class="blk"><h3>현재 단계</h3><p>${esc(x.stage)}</p></div>` : ""}${x.next ? `<div class="blk"><h3>다음 행동</h3><p>${esc(x.next)}</p></div>` : ""}${
      x.log.length ? `<div class="blk"><h3>변경 기록</h3><div class="log">${x.log.map((l) => `<span>${esc(l)}</span>`).join("")}</div></div>` : ""
    }<div class="d-foot"><a class="notion" href="${esc(x.url)}" target="_blank" rel="noopener">노션에서 열기 ${ICON_OUT}</a><button type="button" class="del" data-delete>삭제</button></div>`;
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

  const fit = (win) => {
    const t = win && win.querySelector(".d-title");
    if (!t) return;
    t.style.height = "auto";
    t.style.height = t.scrollHeight + "px";
  };

  // The control that had focus, to find again after the window is redrawn.
  function focusKey() {
    const a = document.activeElement;
    if (!a || !overlay.contains(a)) return null;
    const v = a.dataset.v !== undefined ? `[data-v="${CSS.escape(a.dataset.v)}"]` : "";
    if (a.dataset.status !== undefined) return `[data-status="${CSS.escape(a.dataset.status)}"]`;
    if (a.dataset.toggle) return `[data-toggle="${a.dataset.toggle}"]${v}`;
    if (a.dataset.pick) return `[data-pick="${a.dataset.pick}"]${v}`;
    return null;
  }

  function render(focus) {
    markSel();
    const x = state.sel && view.details[state.sel];
    const sheet = window.innerWidth < 640;
    // The chat button would sit on top of the sheet's bottom row.
    if (x && sheet) root.dataset.todoSheet = "";
    else delete root.dataset.todoSheet;
    if (!x) { overlay.innerHTML = ""; return; }
    // Same item, same kind of window: only the contents change, so it doesn't fade in again.
    const win = overlay.querySelector(".win");
    if (win && win.dataset.key === state.sel && win.classList.contains("sheet") === sheet) {
      // Never under someone's typing: a date being picked waits for the next redraw, a title
      // being typed stays as it is.
      const a = document.activeElement;
      if (typing(a) && win.contains(a)) {
        if (a.matches(".d-title")) win.querySelector(".d-rest").innerHTML = rest(x);
        if (!sheet) place(win);
        return;
      }
      const fk = focusKey();
      (win.querySelector(".sheet-in") || win).innerHTML = body(x);
      win.setAttribute("aria-label", x.t);
      fit(win);
      if (!sheet) place(win);
      if (focus) win.querySelector(".x")?.focus();
      else if (fk) win.querySelector(fk)?.focus();
      return;
    }
    overlay.innerHTML = sheet
      ? `<div class="scrim" data-close></div><div class="win sheet" data-key="${state.sel}" role="dialog" aria-modal="true" aria-label="${esc(x.t)}"><div class="grab"></div><div class="sheet-in">${body(x)}</div></div>`
      : `<div class="win pop" data-key="${state.sel}" role="dialog" aria-label="${esc(x.t)}">${body(x)}</div>`;
    const w = overlay.querySelector(".win");
    fit(w);
    if (!sheet) place(w);
    if (focus) overlay.querySelector(".x")?.focus();
  }

  function open(key, el) {
    if (!view.details[key] || key.startsWith("tmp")) return;
    state.sel = key;
    state.anchor = el;
    state.anchorCol = el ? colOf(el) : null;
    state.rect = el ? el.getBoundingClientRect() : null;
    state.err = false;
    state.pick = null;
    if (onTodo) history.replaceState(null, "", "#" + key);
    render(true);
  }

  function close() {
    const back = state.anchor;
    // A title being typed is saved, not dropped.
    const t = overlay.querySelector(".d-title");
    if (t && document.activeElement === t) commitTitle(t);
    state.sel = null;
    state.anchor = state.rect = state.anchorCol = null;
    state.pick = null;
    if (onTodo && location.hash) history.replaceState(null, "", location.pathname + location.search);
    render(false);
    if (back && back.isConnected) back.focus();
  }

  function setStatus(to) {
    const key = state.sel;
    const it = item(key);
    if (!it || it.status === to) return;
    const from = it.status;
    const doneBefore = it.done_on;
    it.status = to;
    if (to === DONE && !it.done_on) it.done_on = data.today;
    it.edited_at = stamp();
    note(it, "status", from, to);
    state.err = false;
    draw();
    save(key, "/todo/status", { page: it.page_id, from, to }, (x) => {
      x.status = from;
      x.done_on = doneBefore;
    });
  }

  function toggle(list, v) {
    const key = state.sel;
    const it = item(key);
    if (!it) return;
    const f = LIST[list];
    const before = it[f].slice();
    it[f] = before.includes(v) ? before.filter((n) => n !== v) : [...before, v];
    it.edited_at = stamp();
    state.err = false;
    queueEdit(key, f, before, it[f], 700);
    draw();
  }

  function commitTitle(el) {
    const key = el.closest(".win")?.dataset.key;
    const it = key && item(key);
    if (!it) return;
    const v = clean(el.value);
    if (!v || v === it.title) {
      el.value = it.title;
      fit(el.closest(".win"));
      return;
    }
    const before = it.title;
    it.title = v;
    el.value = v;
    state.err = false;
    queueEdit(key, "title", before, v, 0);
    draw({ window: false });
  }

  function setDue(v) {
    const key = state.sel;
    const it = item(key);
    if (!it || (it.due_start ? it.due_start.slice(0, 10) : null) === v) return;
    const before = it.due_start;
    it.due_start = v;
    it.due_end = null;
    state.err = false;
    queueEdit(key, "due_start", before, v, 800);
    draw();
    // While the date field has focus the window isn't redrawn; the D-day next to it is.
    const tag = overlay.querySelector("[data-due-tag]");
    if (tag && view.details[key]) tag.innerHTML = dueTag(view.details[key]);
  }

  // ---- Delete, with a few seconds to take it back
  function remove() {
    const key = state.sel;
    const it = item(key);
    if (!it) return;
    flushAll();
    close();
    data.items = data.items.filter((x) => x !== it);
    draw();
    const gone = send("/todo/delete", { page: it.page_id }, key).then((res) => {
      if (!res || !res.ok) {
        if (!item(key)) data.items.push(it);
        draw();
        toast("삭제 실패");
      }
      return res;
    });
    toast("삭제됨", "되돌리기", () => {
      keep.set(key, it);
      if (!item(key)) data.items.push(it);
      draw();
      gone.then((res) => {
        if (!res || !res.ok) return keep.delete(key);
        send("/todo/restore", { page: it.page_id }, key).then((r) => {
          keep.delete(key);
          if (r && r.ok) return;
          data.items = data.items.filter((x) => keyOf(x.page_id) !== key);
          draw();
          toast("되돌리기 실패");
        });
      });
    });
  }

  let toastTimer = 0;
  let toastAction = null;
  function toast(text, action, onAction) {
    if (!toastEl) return;
    clearTimeout(toastTimer);
    toastEl.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" data-toast>${esc(action)}</button>` : ""}`;
    toastEl.hidden = false;
    toastAction = onAction || null;
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
      toastAction = null;
    }, action ? 6000 : 3000);
  }

  function toggleFold(btn, force) {
    const list = btn.nextElementSibling;
    const show = force ?? list.hidden;
    list.hidden = !show;
    btn.setAttribute("aria-expanded", String(show));
  }

  // ---- Adding: type, @name #team or tap chips, Enter, and the row is ready for the next one.
  let tmpN = 0;
  function add(b) {
    const id = "tmp-" + ++tmpN;
    const key = keyOf(id);
    data.items.push({
      page_id: id, title: b.title, status: data.statuses.includes(NEW) ? NEW : data.statuses[0], teams: b.teams, assignees: b.assignees,
      category: null, due_start: b.due, due_end: null, stage: null, next_action: null, done_on: null, url: "", edited_at: stamp(),
    });
    draw();
    reveal(cardFor(key));
    send("/todo/items", b, key).then((res) => {
      if (res && res.ok) return;
      data.items = data.items.filter((x) => x.page_id !== id);
      draw();
      toast("추가 실패", "다시", () => add(b));
    });
  }

  const qa = document.querySelector("[data-qa]");
  if (qa) {
    const input = qa.querySelector(".qa-in");
    const more = qa.querySelector(".qa-more");
    const rows = qa.querySelector(".qa-rows");
    const sug = qa.querySelector(".qa-sug");
    // touched: the chips for that list were set by hand or by @/#, so the defaults are gone.
    const fresh = () => ({
      who: view.pick.mine && view.pick.names.includes(view.pick.mine) ? [view.pick.mine] : [],
      teams: view.pick.myTeams.filter((t) => view.pick.teams.includes(t)),
      due: "",
      touched: {},
    });
    let draft = fresh();
    const row = (label, field, all) =>
      `<div class="qa-row"><span class="qa-k">${label}</span><div class="chips">${all
        .map((v) => `<button type="button" class="chip" data-qa-toggle="${field}" data-v="${esc(v)}" aria-pressed="${draft[field].includes(v)}">${esc(v)}</button>`)
        .join("")}</div></div>`;
    const drawRows = () => {
      rows.innerHTML =
        row("담당자", "who", view.pick.names) +
        row("작업 팀", "teams", view.pick.teams) +
        `<div class="qa-row"><span class="qa-k">마감</span><input type="date" class="qa-due" value="${esc(draft.due)}" aria-label="마감일"></div>`;
    };
    const choose = (f, v) => {
      if (!draft.touched[f]) {
        draft[f] = [];
        draft.touched[f] = true;
      }
      if (!draft[f].includes(v)) draft[f].push(v);
    };

    // @이름 / #팀 while typing. Matches the start of a name, a syllable still being typed
    // ("까ㅇ", "까어" → 까엉), initial consonants ("ㄲㅇ") or anywhere in it.
    const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
    const cho = (s) => [...s].map((c) => { const n = c.charCodeAt(0) - 0xac00; return n >= 0 && n < 11172 ? CHO[Math.floor(n / 588)] : c; }).join("");
    const conjoin = (s) => s.replace(/[ㄱ-ㅎ]/g, (c) => { const i = CHO.indexOf(c); return i < 0 ? c : String.fromCharCode(0x1100 + i); });
    function candidates(sign, q) {
      const all = sign === "@" ? view.pick.names : view.pick.teams;
      const l = q.toLowerCase();
      if (!l) return all.slice(0, 8);
      const nl = conjoin(l).normalize("NFD");
      const onlyCho = [...l].every((c) => CHO.includes(c));
      const score = (n) => {
        const m = n.toLowerCase();
        if (m.startsWith(l)) return 0;
        if (m.normalize("NFD").startsWith(nl)) return 1;
        if (onlyCho && cho(m).startsWith(l)) return 2;
        return m.includes(l) ? 3 : -1;
      };
      return all.map((n) => [score(n), n]).filter(([s]) => s >= 0).sort((a, b) => a[0] - b[0]).map(([, n]) => n).slice(0, 8);
    }
    const TOKEN = /(^|\s)([@#])([^\s@#]*)$/;
    let sugTok = null;
    let sugList = [];
    let sugAt = 0;
    function token() {
      const pos = input.selectionStart ?? input.value.length;
      const m = TOKEN.exec(input.value.slice(0, pos));
      return m ? { sign: m[2], q: m[3], start: pos - m[3].length - 1, end: pos } : null;
    }
    function drawSug() {
      if (!sugList.length) {
        sug.hidden = true;
        sug.innerHTML = "";
        return;
      }
      sug.innerHTML = sugList.map((n, i) => `<button type="button" class="sug" role="option" data-sug="${esc(n)}" aria-selected="${i === sugAt}">${sugTok.sign}${esc(n)}</button>`).join("");
      sug.hidden = false;
    }
    function updateSug() {
      sugTok = token();
      sugList = sugTok ? candidates(sugTok.sign, sugTok.q) : [];
      sugAt = 0;
      drawSug();
    }
    const hideSug = () => {
      sugList = [];
      drawSug();
    };
    // The token turns into a chip and leaves the title.
    function pick(tok, value) {
      choose(tok.sign === "@" ? "who" : "teams", value);
      const head = input.value.slice(0, tok.start);
      const tail = input.value.slice(tok.end).replace(/^\s+/, "");
      input.value = head + (head && tail && !/\s$/.test(head) ? " " : "") + tail;
      input.setSelectionRange(head.length, head.length);
      hideSug();
      drawRows();
    }

    const show = () => {
      if (qa.classList.contains("on")) return;
      draft = fresh();
      drawRows();
      qa.classList.add("on");
      more.inert = false;
    };
    const fold = () => {
      qa.classList.remove("on");
      more.inert = true;
      hideSug();
    };
    const submit = () => {
      hideSug();
      // @이름 #팀 still in the text: an exact or only match becomes a chip; anything else stays as typed.
      const text = input.value.replace(/(^|\s)([@#])([^\s@#]+)/g, (all, sp, sign, q) => {
        const c = candidates(sign, q);
        const v = c.find((n) => n.toLowerCase() === q.toLowerCase()) || (c.length === 1 ? c[0] : null);
        if (!v) return all;
        choose(sign === "@" ? "who" : "teams", v);
        return sp;
      });
      const title = clean(text);
      if (!title) return drawRows();
      add({ title, assignees: draft.who.slice(), teams: draft.teams.slice(), due: draft.due || null });
      input.value = "";
      draft = fresh();
      drawRows();
      input.focus();
    };

    input.addEventListener("focus", show);
    input.addEventListener("input", (e) => {
      // "@까엉 " with a space: an exact name becomes a chip at once.
      const pos = input.selectionStart ?? input.value.length;
      const m = !e.isComposing && /(^|\s)([@#])([^\s@#]+)\s$/.exec(input.value.slice(0, pos));
      if (m) {
        const all = m[2] === "@" ? view.pick.names : view.pick.teams;
        const exact = all.find((n) => n.toLowerCase() === m[3].toLowerCase());
        if (exact) return pick({ sign: m[2], start: pos - m[3].length - 2, end: pos }, exact);
      }
      updateSug();
    });
    input.addEventListener("click", updateSug);
    input.addEventListener("keyup", (e) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) updateSug();
    });
    input.addEventListener("keydown", (e) => {
      // Enter that only finishes a Korean syllable doesn't save.
      if (e.isComposing || e.keyCode === 229) return;
      if (sugList.length) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          sugAt = (sugAt + (e.key === "ArrowDown" ? 1 : -1) + sugList.length) % sugList.length;
          return drawSug();
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          return pick(sugTok, sugList[sugAt]);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          return hideSug();
        }
      }
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        input.value = "";
        input.blur();
        fold();
      }
    });
    qa.addEventListener("submit", (e) => {
      e.preventDefault();
      submit();
    });
    // Chips and suggestions don't take focus, so the phone keyboard stays up and Enter still saves.
    for (const ev of ["pointerdown", "mousedown"]) {
      qa.addEventListener(ev, (e) => {
        if (e.target.closest("[data-qa-toggle], [data-sug], .qa-go")) e.preventDefault();
        else if (e.target.closest(".qa-line") && e.target !== input) {
          e.preventDefault();
          input.focus();
        }
      });
    }
    qa.addEventListener("click", (e) => {
      const s = e.target.closest("[data-sug]");
      if (s) return pick(sugTok, s.dataset.sug);
      const c = e.target.closest("[data-qa-toggle]");
      if (!c) return;
      const f = c.dataset.qaToggle;
      const v = c.dataset.v;
      draft.touched[f] = true;
      draft[f] = draft[f].includes(v) ? draft[f].filter((n) => n !== v) : [...draft[f], v];
      c.setAttribute("aria-pressed", String(draft[f].includes(v)));
    });
    rows.addEventListener("change", (e) => {
      if (e.target.matches(".qa-due")) draft.due = e.target.value;
    });
    qa.addEventListener("focusout", (e) => {
      if (qa.contains(e.relatedTarget)) return;
      hideSug();
      if (!clean(input.value)) fold();
    });
  }

  // ---- Events
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-by],[data-fold],[data-open],[data-close],[data-status],[data-pick],[data-toggle],[data-delete],[data-due-clear],[data-toast]");
    if (!t) {
      const inWin = e.target.closest(".win");
      if (inWin && state.pick && !e.target.closest(".chips")) {
        state.pick = null;
        render(false);
      } else if (state.sel && !inWin && !e.target.closest(".toast")) close();
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
    } else if (t.dataset.pick) {
      state.pick = t.dataset.pick;
      render(false);
      const v = t.dataset.v;
      (overlay.querySelector(`[data-toggle="${state.pick}"]${v !== undefined ? `[data-v="${CSS.escape(v)}"]` : ""}`) || overlay.querySelector(`[data-toggle="${state.pick}"]`))?.focus();
    } else if (t.dataset.toggle) {
      toggle(t.dataset.toggle, t.dataset.v);
    } else if (t.hasAttribute("data-due-clear")) {
      setDue(null);
    } else if (t.hasAttribute("data-delete")) {
      remove();
    } else if (t.hasAttribute("data-toast")) {
      const f = toastAction;
      clearTimeout(toastTimer);
      toastEl.hidden = true;
      toastAction = null;
      if (f) f();
    }
  });

  overlay.addEventListener("keydown", (e) => {
    if (!e.target.matches(".d-title") || e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
    }
  });
  overlay.addEventListener("input", (e) => {
    if (e.target.matches(".d-title")) fit(e.target.closest(".win"));
  });
  overlay.addEventListener("focusout", (e) => {
    if (e.target.matches(".d-title")) commitTitle(e.target);
  });
  overlay.addEventListener("change", (e) => {
    if (e.target.matches("[data-due]")) setDue(e.target.value || null);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !state.sel) return;
    if (e.target.matches && e.target.matches(".d-title")) {
      // Back to the saved title, window stays open.
      e.target.value = view.details[state.sel]?.t ?? e.target.value;
      e.target.blur();
      return;
    }
    if (state.pick) {
      state.pick = null;
      render(false);
      return;
    }
    close();
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

  // Leaving the tab sends what is waiting; coming back after a minute fetches others' changes.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return flushAll();
    if (Date.now() - lastFetch < 60_000 || inflight || waiting.size) return;
    lastFetch = Date.now();
    fetch("/todo/board")
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res && res.data && !inflight && !waiting.size && !typing(document.activeElement)) apply(res.data);
      })
      .catch(() => {});
  });

  // #<item> opens that item, unfolding its column if needed.
  const key = decodeURIComponent(location.hash.slice(1));
  if (onTodo && key && view.details[key]) document.fonts.ready.then(() => openFromHash(key));

  function openFromHash(key) {
    const els = [...cardsOf(key)];
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
