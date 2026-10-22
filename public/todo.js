// The small window beside a card (a bottom sheet on phones), the team/person switch, folded
// columns, the add row and every change. Changes show at once and save behind; the board itself
// is drawn by the Worker, and each save answers with the new one.
(() => {
  const dataEl = document.getElementById("todo-data");
  const overlay = document.getElementById("todo-overlay");
  if (!dataEl || !overlay) return;
  let data = JSON.parse(dataEl.textContent);
  const root = document.documentElement;
  const onTodo = !!document.querySelector("[data-todo-boards]");
  const toastEl = document.getElementById("todo-toast");

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

  // Window fields → what /todo/edit calls them.
  const FIELD = { t: "title", who: "assignees", teams: "teams", ds: "due" };
  const LABEL = { who: "담당자", teams: "작업 팀" };
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const typing = (el) => !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT");

  // pick: which list in the window is spread out to choose from ("who" | "teams").
  const state = { sel: null, anchor: null, rect: null, err: false, pick: null };

  function setBy(by) {
    if (by === "person") root.dataset.todoBy = "person";
    else delete root.dataset.todoBy;
    document.querySelectorAll("[data-by]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.by === (by === "person" ? "person" : "team"))));
  }
  setBy(root.dataset.todoBy);

  // The D-day tag as the Worker draws it, for a due date changed here (KST).
  const dayNo = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
  function dueOf(ds) {
    if (!ds) return null;
    const n = dayNo(ds) - dayNo(new Date(Date.now() + 9 * 36e5).toISOString());
    return { tag: n < 0 ? `${-n}일 지남` : n === 0 ? "오늘" : `D-${n}`, cls: n < 0 ? "late" : n > 7 ? "far" : "", date: `${+ds.slice(5, 7)}/${+ds.slice(8, 10)}` };
  }
  const dueTag = (x) => (x.due ? `<span class="due ${x.due.cls}">${esc(x.due.tag)}</span>${x.ds && x.ds.length > 10 ? ` <span class="muted">${esc(x.ds.slice(11, 16))}</span>` : ""}` : "");

  // ---- Saving
  // Saves for one item go out one at a time, in order. The board is redrawn from the latest
  // answer once nothing is left to send, so an older answer never replaces a newer change.
  let inflight = 0;
  let latest = null;
  let lastFetch = Date.now();
  const queues = new Map();
  const flashKeys = new Set();

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
      if (res && res.ok && res.key && (path === "/todo/items" || path === "/todo/restore")) flashKeys.add(res.key);
      if (res && res.items) latest = res;
      if (!inflight && latest) {
        const l = latest;
        latest = null;
        try { apply(l); } catch (e) {}
      }
      return res;
    };
    const p = (queues.get(key) || Promise.resolve()).then(run);
    queues.set(key, p);
    return p;
  }

  // A change to the open item. On failure the item goes back and the window says so; a 409 on a
  // status means Notion had another one, and the window just shows it.
  async function save(key, path, body, revert) {
    const res = await send(path, body, key);
    const failed = !res || !res.items;
    if (failed) {
      const it = data.items[key];
      if (it && revert) revert(it);
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
    const entry = { key, field, from: w ? w.from : from, to };
    entry.timer = setTimeout(() => flush(id), delay);
    waiting.set(id, entry);
  }
  function flush(id) {
    const w = waiting.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    waiting.delete(id);
    const x = data.items[w.key];
    if (!x || same(w.from, w.to)) return;
    save(w.key, "/todo/edit", { page: x.page, field: FIELD[w.field], from: w.from, to: w.to }, (it) => {
      it[w.field] = w.from;
      if (w.field === "ds") it.due = dueOf(w.from);
      if (w.field === "t") setCardTitle(w.key, w.from);
    });
  }
  const flushAll = () => [...waiting.keys()].forEach(flush);

  const cardsOf = (key) => document.querySelectorAll(`[data-open="${CSS.escape(key)}"]`);
  const setCardTitle = (key, t) => cardsOf(key).forEach((el) => el.querySelectorAll(".tc-title, .mt").forEach((s) => (s.textContent = t)));

  // ---- Window
  function chips(field, x) {
    const on = x[field];
    if (state.pick === field) {
      const all = field === "who" ? data.pick.names : data.pick.teams;
      return `<div class="chips">${[...all, ...on.filter((v) => !all.includes(v))]
        .map((v) => `<button type="button" class="chip" data-toggle="${field}" data-v="${esc(v)}" aria-pressed="${on.includes(v)}">${esc(v)}</button>`)
        .join("")}</div>`;
    }
    return `<div class="chips">${on.map((v) => `<button type="button" class="chip on" data-pick="${field}" data-v="${esc(v)}">${esc(v)}</button>`).join("")}<button type="button" class="chip add" data-pick="${field}" aria-label="${LABEL[field]} 고르기">${ICON_PLUS}</button></div>`;
  }

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
    const x = state.sel && data.items[state.sel];
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

  // Slides the board sideways to a new card's column, so an add always shows where it went.
  function reveal(el) {
    const col = el && el.closest(".col");
    const board = col && col.parentElement;
    if (!board) return;
    const left = col.offsetLeft - board.offsetLeft;
    if (left < board.scrollLeft || left + col.offsetWidth > board.scrollLeft + board.clientWidth) board.scrollTo({ left: Math.max(0, left - 14), behavior: "smooth" });
  }

  const visibleCard = (key) => [...cardsOf(key)].find((el) => el.getClientRects().length) || null;

  function open(key, el) {
    if (!data.items[key]) return;
    state.sel = key;
    state.anchor = el;
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
    state.anchor = state.rect = null;
    state.pick = null;
    if (onTodo && location.hash) history.replaceState(null, "", location.pathname + location.search);
    render(false);
    if (back && back.isConnected) back.focus();
  }

  // New board from the server. Open folds stay open; the window stays where it is; changes not
  // sent yet stay on top of it.
  function apply(res) {
    const where = (b) => b.closest("[data-board]").dataset.board + "|" + b.closest("[data-col]").dataset.col;
    const openFolds = [...document.querySelectorAll("[data-fold][aria-expanded='true']")].map(where);
    data = { ...data, items: res.items, pick: res.pick || data.pick };
    for (const w of waiting.values()) {
      const it = data.items[w.key];
      if (!it) continue;
      it[w.field] = w.to;
      if (w.field === "ds") it.due = dueOf(w.to);
    }
    const rail = document.querySelector("[data-todo-rail]");
    if (rail) rail.innerHTML = res.rail;
    const boards = document.querySelector("[data-todo-boards]");
    if (boards) boards.innerHTML = res.boards;
    for (const b of document.querySelectorAll("[data-fold]")) if (openFolds.includes(where(b))) toggleFold(b, true);
    const late = document.querySelector("[data-late]");
    if (late) {
      late.textContent = res.late || "";
      late.hidden = !res.late;
    }
    const empty = document.querySelector("[data-todo-empty]");
    if (empty) empty.hidden = Object.keys(res.items).length > 0;
    for (const k of flashKeys) {
      cardsOf(k).forEach((el) => el.classList.add("new"));
      reveal(visibleCard(k));
    }
    flashKeys.clear();
    for (const k of hiding) cardsOf(k).forEach((el) => (el.hidden = true));

    if (!state.sel) return;
    if (!data.items[state.sel]) return close();
    if (!state.anchor || !state.anchor.isConnected) state.anchor = visibleCard(state.sel);
    if (state.anchor) state.rect = state.anchor.getBoundingClientRect();
    render(false);
  }

  function setStatus(to) {
    const key = state.sel;
    const x = data.items[key];
    if (!x || x.s === to) return;
    const from = x.s;
    x.s = to;
    state.err = false;
    render(false);
    save(key, "/todo/status", { page: x.page, from, to }, (it) => (it.s = from));
  }

  function toggle(field, v) {
    const key = state.sel;
    const x = data.items[key];
    if (!x) return;
    const before = x[field].slice();
    x[field] = before.includes(v) ? before.filter((n) => n !== v) : [...before, v];
    state.err = false;
    queueEdit(key, field, before, x[field].slice(), 700);
    render(false);
  }

  function commitTitle(el) {
    const key = el.closest(".win")?.dataset.key;
    const x = key && data.items[key];
    if (!x) return;
    const v = clean(el.value);
    if (!v || v === x.t) {
      el.value = x.t;
      fit(el.closest(".win"));
      return;
    }
    const before = x.t;
    x.t = v;
    el.value = v;
    setCardTitle(key, v);
    state.err = false;
    queueEdit(key, "t", before, v, 0);
  }

  function setDue(v, redraw) {
    const key = state.sel;
    const x = data.items[key];
    if (!x || (x.ds ? x.ds.slice(0, 10) : null) === v) return;
    const before = x.ds;
    x.ds = v;
    x.due = dueOf(v);
    state.err = false;
    queueEdit(key, "ds", before, v, 800);
    const tag = overlay.querySelector("[data-due-tag]");
    if (tag) tag.innerHTML = dueTag(x);
    if (redraw) render(false);
  }

  // ---- Delete, with a few seconds to take it back
  const hiding = new Set();
  function hide(key, on) {
    if (on) hiding.add(key);
    else hiding.delete(key);
    cardsOf(key).forEach((el) => (el.hidden = on));
  }

  function remove() {
    const key = state.sel;
    const x = data.items[key];
    if (!x) return;
    flushAll();
    close();
    hide(key, true);
    const gone = send("/todo/delete", { page: x.page }, key).then((res) => {
      hiding.delete(key);
      if (!res || !res.ok) {
        hide(key, false);
        toast("삭제 실패");
      }
      return res;
    });
    toast("삭제됨", "되돌리기", () => {
      hide(key, false);
      gone.then((res) => {
        if (!res || !res.ok) return;
        send("/todo/restore", { page: x.page }, key).then((r) => {
          if (!r || !r.ok) toast("되돌리기 실패");
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

  // ---- Adding: type, tap people, Enter, and the row is ready for the next one.
  const NO_TEAM = "팀 없음";
  const NO_ONE = "담당자 없음";
  let tmpN = 0;

  // A faint card in the columns it will land in, until the board comes back with the real one.
  function pendingCards(tmp, b) {
    const card = (who) =>
      `<div class="tc pending" data-pending="${tmp}"><span class="tc-title">${esc(b.title)}</span>${who && b.assignees.length ? `<span class="tc-who">${esc(b.assignees.join(" · "))}</span>` : ""}</div>`;
    const put = (board, names, none, who) => {
      for (const n of names.length ? names : [none]) {
        const col = document.querySelector(`[data-board="${board}"] [data-col="${CSS.escape(n)}"]`);
        if (!col) continue;
        // Undated items sort after dated ones, so it goes at the end of the open cards.
        const fold = col.querySelector(":scope > .fold");
        if (b.due) col.querySelector(".col-h").insertAdjacentHTML("afterend", card(who));
        else if (fold) fold.insertAdjacentHTML("beforebegin", card(who));
        else col.insertAdjacentHTML("beforeend", card(who));
      }
    };
    put("team", b.teams, NO_TEAM, true);
    put("person", b.assignees, NO_ONE, false);
  }

  function add(body) {
    const tmp = "tmp" + ++tmpN;
    pendingCards(tmp, body);
    send("/todo/items", body, tmp).then((res) => {
      if (res && res.ok) return;
      document.querySelectorAll(`[data-pending="${tmp}"]`).forEach((el) => el.remove());
      toast("추가 실패", "다시", () => add(body));
    });
  }

  const qa = document.querySelector("[data-qa]");
  if (qa) {
    const input = qa.querySelector(".qa-in");
    const more = qa.querySelector(".qa-more");
    const fresh = () => ({
      who: data.pick.mine && data.pick.names.includes(data.pick.mine) ? [data.pick.mine] : [],
      teams: data.pick.myTeams.filter((t) => data.pick.teams.includes(t)),
      due: "",
    });
    let draft = fresh();
    const row = (label, field, all) =>
      `<div class="qa-row"><span class="qa-k">${label}</span><div class="chips">${all
        .map((v) => `<button type="button" class="chip" data-qa-toggle="${field}" data-v="${esc(v)}" aria-pressed="${draft[field].includes(v)}">${esc(v)}</button>`)
        .join("")}</div></div>`;
    const draw = () => {
      more.innerHTML =
        row("담당자", "who", data.pick.names) +
        row("작업 팀", "teams", data.pick.teams) +
        `<div class="qa-row"><span class="qa-k">마감</span><input type="date" class="qa-due" value="${esc(draft.due)}" aria-label="마감일"></div>`;
    };
    const show = () => {
      if (!more.hidden) return;
      draft = fresh();
      draw();
      more.hidden = false;
      qa.classList.add("on");
    };
    const fold = () => {
      more.hidden = true;
      qa.classList.remove("on");
    };
    const submit = () => {
      const title = clean(input.value);
      if (!title) return;
      add({ title, assignees: draft.who.slice(), teams: draft.teams.slice(), due: draft.due || null });
      input.value = "";
      draft = fresh();
      draw();
      input.focus();
    };
    input.addEventListener("focus", show);
    input.addEventListener("keydown", (e) => {
      // Enter that only finishes a Korean syllable doesn't save.
      if (e.isComposing || e.keyCode === 229) return;
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
    // Chips don't take focus, so the phone keyboard stays up and Enter still saves.
    for (const ev of ["pointerdown", "mousedown"]) {
      qa.addEventListener(ev, (e) => {
        if (e.target.closest("[data-qa-toggle], .qa-go")) e.preventDefault();
        else if (e.target.closest(".qa-line") && e.target !== input) {
          e.preventDefault();
          input.focus();
        }
      });
    }
    more.addEventListener("click", (e) => {
      const c = e.target.closest("[data-qa-toggle]");
      if (!c) return;
      const f = c.dataset.qaToggle;
      const v = c.dataset.v;
      draft[f] = draft[f].includes(v) ? draft[f].filter((n) => n !== v) : [...draft[f], v];
      c.setAttribute("aria-pressed", String(draft[f].includes(v)));
    });
    more.addEventListener("change", (e) => {
      if (e.target.matches(".qa-due")) draft.due = e.target.value;
    });
    qa.addEventListener("focusout", (e) => {
      if (!qa.contains(e.relatedTarget) && !clean(input.value)) fold();
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
      setDue(null, true);
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
    if (e.target.matches("[data-due]")) setDue(e.target.value || null, false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !state.sel) return;
    if (e.target.matches && e.target.matches(".d-title")) {
      // Back to the saved title, window stays open.
      e.target.value = data.items[state.sel]?.t ?? e.target.value;
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
        if (res && res.items && !inflight && !waiting.size && !typing(document.activeElement)) apply(res);
      })
      .catch(() => {});
  });

  // #<item> opens that item, unfolding its column if needed.
  const key = decodeURIComponent(location.hash.slice(1));
  if (onTodo && key && data.items[key]) document.fonts.ready.then(() => openFromHash(key));

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
