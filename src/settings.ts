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
  subscription: "Claude models on your Claude login, asking before anything is billed as extra usage",
} as const;

export type Part = keyof typeof PARTS;
/** The order they load in. Modes goes first so its checks run before anything else sees a tool call. */
export const PART_NAMES = Object.keys(PARTS) as Part[];

export function settingsPath(agentDir: string): string {
  return join(agentDir, "suite.json");
}

/** Off until asked for: it adds models that count as logged in, and its README says what using them risks. */
const OFF_BY_DEFAULT: readonly Part[] = ["subscription"];

export function isPart(name: string): name is Part {
  return (PART_NAMES as string[]).includes(name);
}

export interface Loaded {
  off: ReadonlySet<Part>;
  /** Every part keeps its default when the file can't be understood, so a typo can't turn off plan mode. */
  problem?: string;
}

function defaults(problem?: string): Loaded {
  return { off: new Set(OFF_BY_DEFAULT), ...(problem === undefined ? {} : { problem }) };
}

export function parseSettings(text: string): Loaded {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return defaults("suite.json isn't valid JSON, so every part is at its default");
  }
  const { off, on } = (raw ?? {}) as { off?: unknown; on?: unknown };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || (off !== undefined && !Array.isArray(off)) || (on !== undefined && !Array.isArray(on))) {
    return defaults('suite.json should look like { "off": ["board"], "on": ["subscription"] }, so every part is at its default');
  }
  const offNames = (off ?? []) as unknown[];
  const onNames = (on ?? []) as unknown[];
  const unknown = [...offNames, ...onNames].filter((name) => typeof name !== "string" || !isPart(name));
  if (unknown.length > 0) {
    return defaults(`suite.json names ${unknown.join(", ")}, which isn't one of ${PART_NAMES.join(", ")}, so every part is at its default`);
  }
  // Saying off wins, in case a part is in both.
  const result = new Set<Part>(OFF_BY_DEFAULT.filter((name) => !onNames.includes(name)));
  for (const name of offNames as Part[]) result.add(name);
  return { off: result };
}

export function loadSettings(agentDir: string): Loaded {
  let text: string;
  try {
    text = readFileSync(settingsPath(agentDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaults();
    return defaults(`suite.json can't be read, so every part is at its default: ${(error as Error).message}`);
  }
  return parseSettings(text);
}

export function saveSettings(agentDir: string, off: ReadonlySet<Part>): void {
  // A linked file, as in a dotfiles setup, stays linked.
  const named = settingsPath(agentDir);
  const path = existsSync(named) ? realpathSync(named) : named;
  const temp = `${path}.${process.pid}.tmp`;
  const turnedOn = OFF_BY_DEFAULT.filter((name) => !off.has(name));
  const saved = { off: PART_NAMES.filter((name) => off.has(name) && !OFF_BY_DEFAULT.includes(name)), ...(turnedOn.length > 0 ? { on: turnedOn } : {}) };
  writeFileSync(temp, `${JSON.stringify(saved, null, 2)}\n`);
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
