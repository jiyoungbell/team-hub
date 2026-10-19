// <team-header></team-header> + <script src="https://team.rescene-remine.com/header.js" defer></script>
// Reads the signed-in user from the tool's own /_auth/me (team-gate); nothing is shared across sites.
(() => {
  const HUB = document.currentScript ? new URL(document.currentScript.src).origin : "https://team.rescene-remine.com";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const chevron = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

  if (!document.querySelector('link[href*="pretendard"]')) {
    const font = document.createElement("link");
    font.rel = "stylesheet";
    font.href = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";
    document.head.append(font);
  }

  const css = `
:host { all: initial; display: block; position: relative; z-index: 1000; }
.bar {
  --bg: #1a1b1e; --line: #2e3034; --text: #f2f2f2; --muted: #a9adb2; --hover: #2a2c30; --menu: #232528;
  display: flex; align-items: center; gap: 8px; height: 52px; padding: 0 16px; box-sizing: border-box;
  background: var(--bg); color: var(--text); border-bottom: 1px solid var(--line);
  font: 15px/1.4 "Pretendard Variable", Pretendard, system-ui, sans-serif;
}
.bar.light { --bg: #e9e9e6; --line: #d6d6d2; --text: #1e2024; --muted: #55595e; --hover: #dcdcd8; --menu: #ffffff; }
a { color: inherit; text-decoration: none; }
.logo { display: flex; padding-right: 8px; margin-right: 4px; border-right: 1px solid var(--line); }
.logo img { height: 34px; width: auto; }
.light .logo .w, .bar:not(.light) .logo .d { display: none; }
details { position: relative; }
summary {
  display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 10px; border-radius: 8px;
  cursor: pointer; list-style: none; white-space: nowrap;
}
summary::-webkit-details-marker { display: none; }
summary:hover, details[open] summary { background: var(--hover); }
.here { font-weight: 600; }
.spacer { flex: 1; }
.avatar { width: 28px; height: 28px; border-radius: 50%; }
.name { max-width: 14em; overflow: hidden; text-overflow: ellipsis; }
.menu {
  position: absolute; top: 46px; min-width: 200px; padding: 6px; box-sizing: border-box;
  display: flex; flex-direction: column; background: var(--menu); border: 1px solid var(--line);
  border-radius: 12px; box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
}
.left { left: 0; }
.right { right: 0; }
.menu a, .menu button {
  display: flex; align-items: center; min-height: 40px; padding: 0 12px; border-radius: 8px;
  border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; width: 100%;
}
.menu a:hover, .menu button:hover { background: var(--hover); }
.menu .on { font-weight: 600; }
.menu hr { border: 0; border-top: 1px solid var(--line); margin: 6px 0; }
form { margin: 0; }
@media (max-width: 560px) { .name { display: none; } .logo img { height: 28px; } }
`;

  class TeamHeader extends HTMLElement {
    async connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: "open" });
      let me = null;
      try {
        const res = await fetch("/_auth/me", { credentials: "same-origin", headers: { accept: "application/json" } });
        if (res.ok) me = await res.json();
      } catch {}

      const tools = Array.isArray(me?.tools) ? me.tools : [];
      const here = tools.find((t) => t.host === location.host);
      const toolMenu = tools.length
        ? `<details><summary><span class="here">${esc(here?.name ?? "도구")}</span>${chevron}</summary>
<div class="menu left"><a href="${HUB}/">홈</a><hr>${tools
            .map((t) => `<a href="https://${esc(t.host)}/"${t === here ? ' class="on" aria-current="page"' : ""}>${esc(t.name)}</a>`)
            .join("")}</div></details>`
        : "";
      const userMenu = me
        ? `<details><summary>${me.avatar ? `<img class="avatar" src="${esc(me.avatar)}" alt="">` : ""}<span class="name">${esc(me.name)}</span>${chevron}</summary>
<div class="menu right"><a href="${HUB}/settings">설정</a><form method="post" action="/_auth/logout"><button>로그아웃</button></form></div></details>`
        : "";

      root.innerHTML = `<style>${css}</style>
<div class="bar${me?.theme === "light" ? " light" : ""}">
<a class="logo" href="${HUB}/"><img class="w" src="${HUB}/logo-white.png" alt="리센느 음원총공팀"><img class="d" src="${HUB}/logo-dark.png" alt="리센느 음원총공팀"></a>
${toolMenu}<span class="spacer"></span>${userMenu}
</div>`;

      const menus = [...root.querySelectorAll("details")];
      for (const d of menus) d.addEventListener("toggle", () => d.open && menus.forEach((o) => o !== d && (o.open = false)));
      document.addEventListener("click", (e) => {
        if (!e.composedPath().includes(this)) menus.forEach((d) => (d.open = false));
      });
      root.addEventListener("keydown", (e) => {
        if (e.key === "Escape") menus.forEach((d) => (d.open = false));
      });
    }
  }

  if (!customElements.get("team-header")) customElements.define("team-header", TeamHeader);
})();
