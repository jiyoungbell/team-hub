import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICON, TOOL_ICONS, toolIcon } from "../src/icons";

const wrap = (paths: string) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const inner = (svg: string) => {
  const m = /^<svg[^>]*>(.*)<\/svg>$/.exec(svg);
  if (!m?.[1]) throw new Error(`not an icon svg: ${svg}`);
  return m[1];
};

describe("tool icons", () => {
  it("keeps the cert and monitor icons", () => {
    expect(TOOL_ICONS.check).toEqual({
      label: "인증",
      svg: wrap('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>')
    });
    expect(TOOL_ICONS.pulse).toEqual({
      label: "모니터",
      svg: wrap('<path d="M3 12h4l3-7 4 14 3-7h4"/>')
    });
  });

  it("adds mail, a notice icon, and a few more, and falls back to the box", () => {
    expect(Object.keys(TOOL_ICONS)).toEqual([
      "check",
      "pulse",
      "image",
      "chart",
      "list",
      "mail",
      "megaphone",
      "bell",
      "pen",
      "calendar",
      "users",
      "link",
      "settings",
      "box"
    ]);
    expect(TOOL_ICONS.mail!.label).toBe("메일");
    expect(TOOL_ICONS.megaphone!.label).toBe("공지");
    expect(TOOL_ICONS.bell!.label).toBe("알림");
    expect(TOOL_ICONS.pen!.label).toBe("작성");
    expect(TOOL_ICONS.calendar!.label).toBe("일정");
    expect(TOOL_ICONS.users!.label).toBe("사람들");
    expect(TOOL_ICONS.link!.label).toBe("링크");
    expect(TOOL_ICONS.settings!.label).toBe("설정");

    const box = TOOL_ICONS.box!.svg;
    expect(toolIcon(null)).toBe(box);
    expect(toolIcon("")).toBe(box);
    expect(toolIcon("nope")).toBe(box);
    expect(toolIcon("mail")).toBe(TOOL_ICONS.mail!.svg);
    expect(toolIcon("mail")).not.toBe(box);
    expect(ICON.settings).toBe(TOOL_ICONS.settings!.svg);
  });

  it("uses the same paths in the header menu", () => {
    const header = readFileSync(new URL("../public/header.js", import.meta.url), "utf8");
    for (const [name, icon] of Object.entries(TOOL_ICONS)) expect(header, name).toContain(inner(icon.svg));
    expect(header).toContain('PATHS[name ?? ""] ?? PATHS.box');
    expect(header).toContain("toolIcon(here.icon)");
    expect(header).toContain("toolIcon(t.icon)");
  });
});
