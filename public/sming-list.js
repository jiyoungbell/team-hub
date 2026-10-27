// 슴리 계산기: the list lives in the page and is saved after each change. A save only applies over
// the version this page last saw; otherwise the page takes the newer list.
(() => {
  const dataEl = document.getElementById("sl-data");
  if (!dataEl) return;
  const st = JSON.parse(dataEl.textContent);
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const two = (n) => String(n).padStart(2, "0");
  const clock = (sec) => {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
  };
  const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    dup: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>'),
    del: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>'
  };

  const rowsEl = $("[data-rows]");
  const nameEl = $("[data-name]");
  const q = $("#sl-q");
  const res = $("#sl-res");
  const toastEl = $("#sl-toast");
  let linking = null; // key of a typed-in song being matched to its Melon release

  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2400);
  }

  // ---- drawing

  function render() {
    let cum = 0;
    const tally = new Map();
    rowsEl.innerHTML = st.items
      .map((key, i) => {
        const s = st.songs[key];
        cum += s.sec;
        tally.set(key, (tally.get(key) ?? 0) + 1);
        const cover = s.melon
          ? s.cover ? `<img class="sl-cover" src="${esc(s.cover)}" alt="" loading="lazy">` : `<span class="sl-cover"></span>`
          : `<span class="sl-cover manual"></span>`;
        const link = s.melon ? "" : `<button type="button" class="sl-link" data-link="${esc(key)}" aria-pressed="${linking === key}">연결</button>`;
        return `<div class="sl-row" role="row" data-i="${i}">
<span class="sl-no" role="cell">${two(i + 1)}</span>
<span class="sl-cv" role="cell">${cover}</span>
<span class="sl-title" role="cell"><b title="${esc(s.artist ? `${s.title} · ${s.artist}` : s.title)}">${esc(s.title)}</b>${link}</span>
<span class="sl-num sl-dur-c" role="cell">${clock(s.sec)}</span>
<span class="sl-num sl-strong" role="cell">${clock(cum)}</span>
<span class="sl-act" role="cell"><button type="button" class="sl-dup" data-dup aria-label="복제">${ICON.dup}</button><button type="button" data-del aria-label="삭제">${ICON.del}</button><button type="button" class="sl-grip" data-grip aria-label="순서 바꾸기 (위아래 화살표)">${ICON.grip}</button></span>
</div>`;
      })
      .join("");
    $("[data-total]").textContent = clock(cum);
    $("[data-count]").textContent = `${st.items.length}곡`;
    $("[data-counts]").innerHTML = [...tally].map(([k, n]) => `<span>${esc(st.songs[k].title)}<b>${n}</b></span>`).join("");
  }

  // ---- saving

  let saving = false;
  let dirty = false;
  let timer;
  const body = () => JSON.stringify({ version: st.version, name: st.name, songs: st.songs, items: st.items });

  function changed() {
    render();
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  }

  async function save() {
    if (saving || !dirty) return;
    saving = true;
    dirty = false;
    let failed = false;
    try {
      const r = await fetch(`/sming-list/${st.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: body() });
      const out = await r.json().catch(() => null);
      if (r.status === 409 && out?.list) {
        Object.assign(st, out.list);
        dirty = false;
        nameEl.value = st.name;
        render();
        toast("다른 사람이 먼저 고친 내용으로 바뀜");
      } else if (r.ok && out?.list) {
        st.version = out.list.version;
      } else {
        dirty = failed = true;
        toast("저장 실패");
      }
    } catch {
      dirty = failed = true;
      toast("저장 실패");
    }
    saving = false;
    if (dirty) timer = setTimeout(save, failed ? 3000 : 500);
  }

  // Leaving with a change not sent yet: send it anyway.
  addEventListener("pagehide", () => {
    if (!dirty || saving) return;
    fetch(`/sming-list/${st.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: body(), keepalive: true });
  });

  // ---- editing

  const songOf = (r) => ({ title: r.title, sec: r.sec, melon: r.melon, ...(r.artist ? { artist: r.artist } : {}), ...(r.cover ? { cover: r.cover } : {}) });

  function add(r) {
    const key = `m${r.melon}`;
    st.songs[key] ??= songOf(r);
    st.items.push(key);
    changed();
  }

  // Every row of the typed-in song now points at the Melon one.
  function link(key, r) {
    const to = `m${r.melon}`;
    st.songs[to] ??= songOf(r);
    st.items = st.items.map((k) => (k === key ? to : k));
    delete st.songs[key];
    stopLinking();
    changed();
  }

  function stopLinking() {
    linking = null;
    q.placeholder = "멜론에서 곡 검색";
  }

  nameEl.addEventListener("input", () => {
    st.name = nameEl.value.trim() || "새 슴리";
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(save, 800);
  });

  rowsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const i = Number(b.closest(".sl-row").dataset.i);
    if (b.hasAttribute("data-dup")) {
      st.items.splice(i + 1, 0, st.items[i]);
      changed();
    } else if (b.hasAttribute("data-del")) {
      st.items.splice(i, 1);
      changed();
    } else if (b.dataset.link) {
      if (linking === b.dataset.link) {
        stopLinking();
        closeResults();
        render();
        return;
      }
      linking = b.dataset.link;
      q.placeholder = "연결할 곡 검색";
      q.value = st.songs[linking].title;
      render();
      q.focus();
      runSearch();
    }
  });

  const move = (from, to) => {
    const [k] = st.items.splice(from, 1);
    st.items.splice(to, 0, k);
  };

  rowsEl.addEventListener("keydown", (e) => {
    const g = e.target.closest("[data-grip]");
    if (!g || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const i = Number(g.closest(".sl-row").dataset.i);
    const to = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (to < 0 || to >= st.items.length) return;
    move(i, to);
    changed();
    rowsEl.children[to].querySelector("[data-grip]").focus();
  });

  // Dragging by the grip moves the row among the others as it passes them (mouse and touch).
  rowsEl.addEventListener("pointerdown", (e) => {
    const g = e.target.closest("[data-grip]");
    if (!g || e.button > 0) return;
    e.preventDefault();
    const row = g.closest(".sl-row");
    const from = Number(row.dataset.i);
    row.classList.add("lift");
    g.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const rows = [...rowsEl.children];
      const at = rows.indexOf(row);
      const prev = rows[at - 1];
      const next = rows[at + 1];
      if (prev && ev.clientY < prev.getBoundingClientRect().top + prev.offsetHeight / 2) rowsEl.insertBefore(row, prev);
      else if (next && ev.clientY > next.getBoundingClientRect().top + next.offsetHeight / 2) rowsEl.insertBefore(next, row);
    };
    const onUp = () => {
      g.removeEventListener("pointermove", onMove);
      g.removeEventListener("pointerup", onUp);
      g.removeEventListener("pointercancel", onUp);
      row.classList.remove("lift");
      const to = [...rowsEl.children].indexOf(row);
      if (to === from) return;
      move(from, to);
      changed();
    };
    g.addEventListener("pointermove", onMove);
    g.addEventListener("pointerup", onUp);
    g.addEventListener("pointercancel", onUp);
  });

  // ---- search

  let found = [];
  let pick = -1;
  let searchTimer;
  let ctl;

  function closeResults() {
    res.hidden = true;
    q.setAttribute("aria-expanded", "false");
    pick = -1;
  }

  function showResults(html) {
    res.innerHTML = html;
    res.hidden = false;
    q.setAttribute("aria-expanded", "true");
  }

  async function runSearch() {
    const term = q.value.trim();
    ctl?.abort();
    if (!term) return closeResults();
    ctl = new AbortController();
    try {
      const r = await fetch(`/sming-list/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
      const out = await r.json();
      if (!r.ok || !out.ok) return showResults("<p>멜론 응답 없음</p>");
      found = out.songs;
      pick = -1;
      if (!found.length) return showResults("<p>결과 없음</p>");
      showResults(
        found
          .map(
            (s, i) => `<button type="button" role="option" data-r="${i}" aria-selected="false"${s.sec ? "" : " disabled"}>
${s.cover ? `<img class="sl-cover" src="${esc(s.cover)}" alt="" loading="lazy">` : `<span class="sl-cover"></span>`}
<span><b>${esc(s.title)}</b><small>${esc(s.artist)}${s.album ? ` · ${esc(s.album)}` : ""}</small></span>
<span class="sl-num sl-dur-c">${s.sec ? clock(s.sec) : "—"}</span></button>`
          )
          .join("")
      );
    } catch (err) {
      if (err.name !== "AbortError") showResults("<p>멜론 응답 없음</p>");
    }
  }

  function choose(i) {
    const s = found[i];
    if (!s?.sec) return;
    if (linking) {
      link(linking, s);
      q.value = "";
      closeResults();
    } else add(s);
  }

  q.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
  });
  q.addEventListener("focus", () => q.value.trim() && res.innerHTML && showResults(res.innerHTML));
  q.addEventListener("keydown", (e) => {
    const opts = [...res.querySelectorAll("button:not(:disabled)")];
    if (e.key === "Escape") {
      if (linking) {
        stopLinking();
        render();
      }
      q.value = "";
      closeResults();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !res.hidden && opts.length) {
      e.preventDefault();
      pick = (pick + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === pick)));
      opts[pick].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      const o = opts[pick >= 0 ? pick : 0];
      if (o && !res.hidden) choose(Number(o.dataset.r));
    }
  });
  res.addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]");
    if (b) choose(Number(b.dataset.r));
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".sl-q") && !e.target.closest("[data-link]")) closeResults();
  });

  // ---- typed in (not released yet)

  const manualBtn = $("[data-manual]");
  const form = $("[data-manual-form]");
  const fTitle = form.elements.namedItem("song");
  const fDur = form.elements.namedItem("dur");
  manualBtn.addEventListener("click", () => {
    form.hidden = !form.hidden;
    manualBtn.setAttribute("aria-expanded", String(!form.hidden));
    if (!form.hidden) fTitle.focus();
  });
  fDur.addEventListener("input", () => fDur.removeAttribute("aria-invalid"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(fDur.value);
    const sec = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
    const title = fTitle.value.trim();
    if (!sec) return fDur.setAttribute("aria-invalid", "true");
    if (!title) return;
    const key = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    st.songs[key] = { title, sec };
    st.items.push(key);
    form.reset();
    form.hidden = true;
    manualBtn.setAttribute("aria-expanded", "false");
    changed();
  });

  // ---- the rest

  $("[data-copy]").addEventListener("click", async () => {
    let cum = 0;
    const lines = st.items.map((k, i) => {
      const s = st.songs[k];
      cum += s.sec;
      return `${two(i + 1)} ${s.title} ${clock(s.sec)}`;
    });
    lines.push(`Total ${clock(cum)}`);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast("복사됨");
    } catch {
      toast("복사 실패");
    }
  });

  $("[data-delete]")?.addEventListener("submit", (e) => {
    if (!confirm(`'${st.name}' 삭제`)) e.preventDefault();
  });

  render();
})();
