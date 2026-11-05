// ~/.pi/agent/suite.json: which parts are off, and each part's settings under its own name.
// Global only: a repository must not choose where your code or searches go, or which program runs.
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
  subagent: "The agent tool: hand a task to a fresh agent, and get its answer back",
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
  const turnedOn = OFF_BY_DEFAULT.filter((name) => !off.has(name));
  const { on: _on, ...raw } = readAll(agentDir);
  writeAll(agentDir, { ...raw, off: PART_NAMES.filter((name) => off.has(name) && !OFF_BY_DEFAULT.includes(name)), ...(turnedOn.length > 0 ? { on: turnedOn } : {}) });
}

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => value !== null && typeof value === "object" && !Array.isArray(value);

/** Throws on a file it can't understand, so a broken one can't quietly mean "no allow list". */
function readAll(agentDir: string): Raw {
  let text: string;
  try {
    text = readFileSync(settingsPath(agentDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("suite.json isn't valid JSON");
  }
  if (!isObject(raw)) throw new Error("suite.json must hold a JSON object");
  return raw;
}

/** Only you can read it, as it can hold private words. A linked file, as in a dotfiles setup, stays linked. */
function writeAll(agentDir: string, raw: Raw): void {
  const named = settingsPath(agentDir);
  const path = existsSync(named) ? realpathSync(named) : named;
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

/** Where each part kept its settings before they moved here. */
const OLD_FILES: Readonly<Record<string, string>> = {
  router: "router.json",
  web: "web.json",
  subscription: "claude-sdk.json",
  modes: join("extensions", "pi-modes", "config.json"),
  frame: join("extensions", "pi-harness", "settings.json"),
};

/** Moves one old file in, keeping it as .bak. What's already here wins. A broken file stays put and throws. */
function moveOldFile(agentDir: string, section: string): void {
  const name = OLD_FILES[section];
  if (name === undefined) return;
  const path = join(agentDir, name);
  if (!existsSync(path)) return;
  let old: unknown;
  try {
    old = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} can't be read, so it wasn't moved to suite.json. Fix or delete it: ${(error as Error).message}`);
  }
  if (!isObject(old)) throw new Error(`${path} must hold a JSON object, so it wasn't moved to suite.json. Fix or delete it`);
  const raw = readAll(agentDir);
  // The frame's file already has its settings under their own names.
  const moved = section === "frame" ? old : { [section]: old };
  writeAll(agentDir, { ...moved, ...raw });
  renameSync(path, `${path}.bak`);
}

/** Before any part loads. A file that can't move is reported here and refused again by its part. */
export function moveOldSettings(agentDir: string): string[] {
  const problems: string[] = [];
  for (const section of Object.keys(OLD_FILES)) {
    try {
      moveOldFile(agentDir, section);
    } catch (error) {
      problems.push(`pi-suite: ${(error as Error).message}`);
    }
  }
  return problems;
}

/** One part's settings. Throws if they can't be understood, for the part to refuse or report. */
export function readSection(agentDir: string, section: string): Raw {
  moveOldFile(agentDir, section);
  const value = readAll(agentDir)[section];
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`${section} in suite.json must be an object`);
  return value;
}

/** Reads the file again first, as another session may have changed another part. */
export function writeSection(agentDir: string, section: string, value: Raw): void {
  const raw = readAll(agentDir);
  if (Object.keys(value).length === 0) delete raw[section];
  else raw[section] = value;
  writeAll(agentDir, raw);
}

/** Separate installs of what's now in here would register everything twice. */
export function separateInstalls(packages: unknown): string[] {
  if (!Array.isArray(packages)) return [];
  const pattern = new RegExp(`@huseynsnmz/pi-(?:${PART_NAMES.join("|")})\\b`);
  return packages
    .map((entry) => String((entry as { source?: unknown } | null)?.source ?? entry))
    .filter((source) => pattern.test(source));
}
