// Stroke icons, 24px grid. Tool icons are picked by name in the admin page.
// public/header.js copies these paths; test/icons.test.ts keeps the two in step.
const svg = (paths: string) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const gear =
  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>';

export const TOOL_ICONS: Record<string, { label: string; svg: string }> = {
  check: { label: "인증", svg: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>') },
  pulse: { label: "모니터", svg: svg('<path d="M3 12h4l3-7 4 14 3-7h4"/>') },
  image: { label: "사진", svg: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>') },
  chart: { label: "차트", svg: svg('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>') },
  list: { label: "목록", svg: svg('<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>') },
  mail: { label: "메일", svg: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>') },
  megaphone: { label: "공지", svg: svg('<path d="M5 10h2l8-4v12l-8-4H5z"/><path d="M18 9.2a4 4 0 0 1 0 5.6"/>') },
  bell: { label: "알림", svg: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5"/><path d="M4 16h16"/><path d="M9.5 16.2a2.5 2.5 0 0 0 5 0"/>') },
  pen: { label: "작성", svg: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>') },
  calendar: { label: "일정", svg: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>') },
  users: { label: "사람들", svg: svg('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.3"/><path d="M15.5 18.5a3.6 3.6 0 0 1 6 0"/>') },
  link: { label: "링크", svg: svg('<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><path d="M8 12h8"/>') },
  settings: { label: "설정", svg: svg(gear) },
  box: { label: "기본", svg: svg('<rect x="4" y="4" width="16" height="16" rx="3"/>') }
};

export const toolIcon = (name: string | null) => (TOOL_ICONS[name ?? ""] ?? TOOL_ICONS.box!).svg;

export const ICON = {
  home: svg('<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>'),
  todo: svg('<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>'),
  settings: svg(gear),
  admin: svg('<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  sming: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>')
};
