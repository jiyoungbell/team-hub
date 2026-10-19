// <team-header></team-header> + <script src="https://team.rescene-remine.com/header.js" defer></script>
// Reads the signed-in user from the tool's own /_auth/me (team-gate); nothing is shared across sites.
(() => {
  const HUB = document.currentScript ? new URL(document.currentScript.src).origin : "https://team.rescene-remine.com";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const chevron = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

  // Skip the font when the tool already has Pretendard (or its CSP would block the CDN anyway).
  const hasPretendard = [...document.fonts].some((f) => f.family.replace(/["']/g, "") === "Pretendard");
  if (!hasPretendard && !document.querySelector('link[href*="pretendard"]')) {
    const font = document.createElement("link");
    font.rel = "stylesheet";
    font.href = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";
    document.head.append(font);
  }


  class TeamHeader extends HTMLElement {
    async connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: "open" });
      let me = null;
      try {
        const res = await fetch("/_auth/me", { credentials: "same-origin", headers: { accept: "application/json" } });
        if (res.ok) me = await res.json();
      } catch {}

      // The tool page follows the hub theme: <html data-theme>, kept under "team-theme" so the tool can set it before first paint.
      if (me) {
        const theme = me.theme === "light" ? "light" : "dark";
        document.documentElement.dataset.theme = theme;
        try {
          localStorage.setItem("team-theme", theme);
        } catch {}
      }

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

      root.innerHTML = `<link rel="stylesheet" href="${HUB}/header.css">
<div class="bar${me?.theme === "light" ? " light" : ""}" hidden>
<a class="logo" href="${HUB}/"><img class="w" src="${HUB}/logo-white.png" alt="리센느 음원총공팀"><img class="d" src="${HUB}/logo-dark.png" alt="리센느 음원총공팀"></a>
${toolMenu}<span class="spacer"></span>${userMenu}
</div>`;

      // Stay hidden until the styles arrive, so the bar never flashes unstyled.
      const bar = root.querySelector(".bar");
      const show = () => (bar.hidden = false);
      root.querySelector("link").addEventListener("load", show);
      root.querySelector("link").addEventListener("error", show);

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
