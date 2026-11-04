// ~/.pi/agent/suite.json: which parts are off. Everything is on unless it's listed.
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PARTS = {
  modes: "Modes and permissions: plan, auto, read-only, yolo, submit_plan, ask_questions",
  router: "router/auto: one model to plan, another to build, and one each for the reader, judge and subagents",
  web: "web_fetch and web_search, read by a separate model with no tools",
  memory: "Memory the agent keeps between sessions",
  frame: "The start card, framed editor, tool boxes, footer and todo list",
  board: "The board of agent sessions",
  commands: "/clear and /security-review",
} as const;

export type Part = keyof typeof PARTS;
/** The order they load in. Modes goes first so its checks run before anything else sees a tool call. */
export const PART_NAMES = Object.keys(PARTS) as Part[];

export function settingsPath(agentDir: string): string {
  return join(agentDir, "suite.json");
}

export function isPart(name: string): name is Part {
  return (PART_NAMES as string[]).includes(name);
}

export interface Loaded {
  off: ReadonlySet<Part>;
  /** Everything stays on when the file can't be understood, so a typo can't turn off plan mode. */
  problem?: string;
}

export function parseSettings(text: string): Loaded {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { off: new Set(), problem: "suite.json isn't valid JSON, so everything is on" };
  }
  const off = (raw as { off?: unknown } | null)?.off;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || (off !== undefined && !Array.isArray(off))) {
    return { off: new Set(), problem: 'suite.json should look like { "off": ["board"] }, so everything is on' };
  }
  const names = (off ?? []) as unknown[];
  const unknown = names.filter((name) => typeof name !== "string" || !isPart(name));
  if (unknown.length > 0) {
    return { off: new Set(), problem: `suite.json names ${unknown.join(", ")}, which isn't one of ${PART_NAMES.join(", ")}, so everything is on` };
  }
  return { off: new Set(names as Part[]) };
}

export function loadSettings(agentDir: string): Loaded {
  let text: string;
  try {
    text = readFileSync(settingsPath(agentDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { off: new Set() };
    return { off: new Set(), problem: `suite.json can't be read, so everything is on: ${(error as Error).message}` };
  }
  return parseSettings(text);
}

export function saveSettings(agentDir: string, off: ReadonlySet<Part>): void {
  // A linked file, as in a dotfiles setup, stays linked.
  const named = settingsPath(agentDir);
  const path = existsSync(named) ? realpathSync(named) : named;
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ off: PART_NAMES.filter((name) => off.has(name)) }, null, 2)}\n`);
  renameSync(temp, path);
}

/** Separate installs of what's now in here would register everything twice. */
export function separateInstalls(packages: unknown): string[] {
  if (!Array.isArray(packages)) return [];
  const pattern = new RegExp(`@huseynsnmz/pi-(?:${PART_NAMES.join("|")})\\b`);
  return packages
    .map((entry) => String((entry as { source?: unknown } | null)?.source ?? entry))
    .filter((source) => pattern.test(source));
}
