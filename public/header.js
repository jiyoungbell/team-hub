// <team-header></team-header> + <script src="https://team.rescene-remine.com/header.js" defer></script>
// Reads the signed-in user from the tool's own /_auth/me (team-gate); nothing is shared across sites.
(() => {
  const HUB = document.currentScript ? new URL(document.currentScript.src).origin : "https://team.rescene-remine.com";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const chevron = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

  // Same stroke paths as TOOL_ICONS in src/icons.ts. An unknown name draws the box.
  const svg = (paths) =>
    `<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const PATHS = {
    check: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    list: '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    megaphone: '<path d="M5 10h2l8-4v12l-8-4H5z"/><path d="M18 9.2a4 4 0 0 1 0 5.6"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5"/><path d="M4 16h16"/><path d="M9.5 16.2a2.5 2.5 0 0 0 5 0"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.3"/><path d="M15.5 18.5a3.6 3.6 0 0 1 6 0"/>',
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><path d="M8 12h8"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    box: '<rect x="4" y="4" width="16" height="16" rx="3"/>'
  };
  const toolIcon = (name) => svg(PATHS[name ?? ""] ?? PATHS.box);

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
        ? `<details><summary>${here ? toolIcon(here.icon) : ""}<span class="here">${esc(here?.name ?? "도구")}</span>${chevron}</summary>
<div class="menu left"><a href="${HUB}/">홈</a><a href="${HUB}/todo">할 일</a><a href="${HUB}/sming-list">슴리 계산기</a><hr>${tools
            .map((t) => `<a href="https://${esc(t.host)}/"${t === here ? ' class="on" aria-current="page"' : ""}>${toolIcon(t.icon)}<span>${esc(t.name)}</span></a>`)
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
