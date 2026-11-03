import { classifyBash } from "./bash.ts";

export const MODES = ["normal", "auto", "plan", "read-only", "yolo"] as const;
export type Mode = (typeof MODES)[number];

/** Shift+Tab never lands on yolo, because yolo has to be asked for. */
const CYCLE: readonly Mode[] = ["normal", "auto", "plan", "read-only"];

export const SUBMIT_PLAN_TOOL = "submit_plan";

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

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
export function decideToolCall(mode: Mode, toolName: string, input: unknown): ToolDecision {
  if (mode === "normal" || mode === "auto" || mode === "yolo") return ALLOW;
  const leave = "Press Shift+Tab to change mode.";
  if (READ_TOOLS.has(toolName)) return ALLOW;
  if (toolName === SUBMIT_PLAN_TOOL && mode === "plan") return ALLOW;

  if (toolName === "bash") {
    const command = (input as { command?: unknown } | null)?.command;
    if (typeof command !== "string") return { action: "block", reason: `${mode} mode: bash needs a command.` };
    const verdict = classifyBash(command);
    if (verdict.readOnly) return ALLOW;
    if (mode === "plan") return { action: "ask", reason: verdict.reason };
    return { action: "block", reason: `read-only mode blocked this command: ${verdict.reason}. ${leave}` };
  }

  return { action: "block", reason: `${mode} mode blocks ${toolName}. ${leave}` };
}

/**
 * Makes a command safe to show in a dialog. Control and bidirectional characters
 * become visible escapes, so a command can't hide or reorder what the user sees.
 */
export function displayCommand(command: string): string {
  return command.replace(
    /[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g,
    (ch) => `\\u${(ch.codePointAt(0) as number).toString(16).padStart(4, "0")}`,
  );
}

/** True when Pi will run the permission system's dialog before this extension's check. */
export function loadsAfterPermissionSystem(packages: unknown): boolean {
  if (!Array.isArray(packages)) return false;
  const names = packages.map((entry) => String((entry as { source?: unknown } | null)?.source ?? entry));
  const self = names.findIndex((name) => name.includes("pi-modes"));
  const gate = names.findIndex((name) => name.includes("pi-permission-system"));
  return self !== -1 && gate !== -1 && self > gate;
}

const PLAN_PROMPT = `Plan mode is on. Research and propose, but do not implement.
- Do not edit files or change any state. write, edit, subagents and MCP tools are blocked.
- Read-only shell commands run freely. Any other command asks the user first, so run one only if the plan depends on its result.
- When the plan is ready, call ${SUBMIT_PLAN_TOOL} with the full plan. Do not start implementing until it is approved.`;

const READ_ONLY_PROMPT = `Read-only mode is on. Answer from what you can read.
- Do not edit files or change any state. write, edit, subagents and MCP tools are blocked.
- Only read-only shell commands run. Do not try to work around a blocked command.`;

export function modePrompt(mode: Mode): string | undefined {
  if (mode === "plan") return PLAN_PROMPT;
  if (mode === "read-only") return READ_ONLY_PROMPT;
  return undefined;
}
