import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyBash } from "./bash.ts";

export const MODES = ["normal", "auto", "plan", "read-only", "yolo"] as const;
export type Mode = (typeof MODES)[number];

/** Shift+Tab never lands on yolo, because yolo has to be asked for. */
const CYCLE: readonly Mode[] = ["normal", "auto", "plan", "read-only"];

export const SUBMIT_PLAN_TOOL = "submit_plan";
export const ASK_TOOL = "ask_questions";
const CODEMODE_TOOL = "codemode";

// pi-web's tools only read, and a separate model reads the page for them.
// Each tool a codemode script calls comes through this check itself, so the script needs none of its own.
const READ_TOOLS = new Set(["read", "grep", "find", "ls", "web_fetch", "web_search", "todo", ASK_TOOL, CODEMODE_TOOL]);

/** Allowed for what pi-suite's own do. Another package's tool with the name could do anything. */
const SUITE_TOOLS: ReadonlySet<string> = new Set(["todo", "web_fetch", "web_search", ASK_TOOL]);
const SUITE_ENTRY = fileURLToPath(new URL("../../../src/index.ts", import.meta.url));

function realPath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/** The whole suite loads from one file, so that file is what these tools must come from. */
export function fromExpectedPackage(toolName: string, path: string | undefined, entry = SUITE_ENTRY): boolean {
  if (toolName === CODEMODE_TOOL) return path === "builtin:codemode";
  if (!SUITE_TOOLS.has(toolName)) return true;
  const expected = realPath(entry);
  return path !== undefined && expected !== undefined && realPath(path) === expected;
}

export function isMode(value: unknown): value is Mode {
  return (MODES as readonly unknown[]).includes(value);
}

export function nextMode(mode: Mode): Mode {
  return CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length] as Mode;
}

/** What a resumed session starts in. Yolo is never restored, because it was only agreed to once. */
export function resumedMode(saved: Mode): Mode {
  return saved === "yolo" ? "normal" : saved;
}

/** What a new session starts in. Yolo can't be one, because it has to be asked for each time. */
export function startingMode(configured: unknown): Mode {
  return isMode(configured) && configured !== "yolo" ? configured : "normal";
}

export type ToolDecision =
  | { action: "allow" }
  | { action: "ask"; reason: string }
  | { action: "block"; reason: string };

const ALLOW: ToolDecision = { action: "allow" };

/**
 * What a mode does to one tool call, before the permission system's own rules.
 * Unknown tools are blocked in restricted modes, because an MCP tool or a
 * subagent could write without this extension seeing how.
 */
export function notReadOnly(mode: Mode, reason: string): ToolDecision {
  if (mode === "plan") return { action: "ask", reason };
  return { action: "block", reason: `read-only mode blocked this command: ${reason}. Press Shift+Tab to change mode.` };
}

export function decideToolCall(mode: Mode, toolName: string, input: unknown): ToolDecision {
  if (mode === "normal" || mode === "auto" || mode === "yolo") return ALLOW;
  const leave = "Press Shift+Tab to change mode.";
  if (READ_TOOLS.has(toolName)) return ALLOW;
  if (toolName === SUBMIT_PLAN_TOOL && mode === "plan") return ALLOW;

  if (toolName === "bash") {
    const command = (input as { command?: unknown } | null)?.command;
    if (typeof command !== "string") return { action: "block", reason: `${mode} mode: bash needs a command.` };
    const verdict = classifyBash(command);
    return verdict.readOnly ? ALLOW : notReadOnly(mode, verdict.reason);
  }

  return { action: "block", reason: `${mode} mode blocks ${toolName}. ${leave}` };
}

/**
 * Why a tool can't make this call from inside a script, if it can't. The transcript only shows the script,
 * so a change must be its own step: you can see it, and the router can see that editing has started.
 */
export function scriptedChange(toolName: string, input: unknown): string | undefined {
  const asOwnStep = "Call it directly, not from a script.";
  if (/(^|_)(edit|write)$/.test(toolName) || toolName === "powershell") return `${toolName} changes files. ${asOwnStep}`;
  if (!/(^|_)bash$/.test(toolName)) return undefined;
  const command = (input as { command?: unknown } | null)?.command;
  if (typeof command !== "string") return `${toolName} needs a command. ${asOwnStep}`;
  const verdict = classifyBash(command);
  return verdict.readOnly ? undefined : `${verdict.reason}. ${asOwnStep}`;
}

/**
 * Makes a command safe to show in a dialog. Control and bidirectional characters
 * become visible escapes, so a command can't hide or reorder what the user sees.
 */
export function displayCommand(command: string): string {
  return command.replace(
    /[\x00-\x08\x0b-\x1f\x7f-\x9f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\u3164\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu,
    (ch) => `\\u${(ch.codePointAt(0) as number).toString(16).padStart(4, "0")}`,
  );
}

/** True when Pi will run the permission system's dialog before this extension's check. */
export function loadsAfterPermissionSystem(packages: unknown): boolean {
  if (!Array.isArray(packages)) return false;
  const names = packages.map((entry) => String((entry as { source?: unknown } | null)?.source ?? entry));
  const self = names.findIndex((name) => name.includes("pi-suite"));
  const gate = names.findIndex((name) => name.includes("pi-permission-system"));
  return self !== -1 && gate !== -1 && self > gate;
}

const PLAN_PROMPT = `Plan mode is on. Research and propose, but do not implement.
- Do not edit files or change any state. write, edit, subagents and MCP tools are blocked.
- Read-only shell commands run freely. Any other command asks the user first, so run one only if the plan depends on its result.
- If a decision is the user's to make, call ${ASK_TOOL} instead of guessing.
- When the plan is ready, call ${SUBMIT_PLAN_TOOL} with the full plan. Do not start implementing until it is approved.`;

const READ_ONLY_PROMPT = `Read-only mode is on. Answer from what you can read.
- Do not edit files or change any state. write, edit, subagents and MCP tools are blocked.
- Only read-only shell commands run. Do not try to work around a blocked command.`;

export function modePrompt(mode: Mode): string | undefined {
  if (mode === "plan") return PLAN_PROMPT;
  if (mode === "read-only") return READ_ONLY_PROMPT;
  return undefined;
}
