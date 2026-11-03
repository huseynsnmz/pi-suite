import { classifyBash } from "./bash.ts";

export const MODES = ["normal", "auto", "plan", "read-only"] as const;
export type Mode = (typeof MODES)[number];

export const SUBMIT_PLAN_TOOL = "submit_plan";

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

export function isMode(value: unknown): value is Mode {
  return (MODES as readonly unknown[]).includes(value);
}

export function nextMode(mode: Mode): Mode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length] as Mode;
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
  if (mode === "normal" || mode === "auto") return ALLOW;
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
