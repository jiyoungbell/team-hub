// What the Worker and the page's script both use: the board is drawn by the same code in both.
import type { Options, TodoItem } from "./notion";

export const DONE = "완료";
export const HELD = "보류";
export const TEAM_ORDER = ["SNS", "총대", "디자인", "개발", "분석", "총무", "기타"];

export type Field = "status" | "create" | "title" | "assignees" | "teams" | "due" | "delete" | "restore";

export interface Change {
  page_id: string;
  user_name: string;
  field: Field;
  from_value: string | null;
  to_value: string | null;
  at: number;
}

export interface TodoData {
  items: TodoItem[];
  options: Options;
  me: string[]; // my Notion names
  myTeams: string[];
  changes: Map<string, Change[]>;
  today: string; // KST YYYY-MM-DD
  names: string[]; // assignees to pick from, mine first
  mine: string; // my name among them, on by default when adding
  teams: string[]; // Notion's team options in board order
}

export const kstDay = (now: number) => new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);

const stamp = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

// "10/20 14:03"
export function kstStamp(ms: number): string {
  const p = Object.fromEntries(stamp.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

// "10/25"
export const monthDay = (ymd: string) => `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}`;
