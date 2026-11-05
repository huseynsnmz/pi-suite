// Which real model answers a request. Pure, so every rule can be tested without Pi.
import type { Role, RouterConfig, ThinkingLevel } from "./config.ts";

export interface RouterState {
  phase: "plan" | "build";
  /** Plan mode was on. Leaving it, by approving a plan or changing mode, starts building. */
  planned?: true;
}

export interface RouteInput {
  reason: "user" | "continuation" | "retry" | "direct";
  /** From pi-modes, when it is installed. */
  mode: string | undefined;
  /** This Pi was started by pi-subagents. */
  subagent: boolean;
  state: RouterState | undefined;
  previous: string | undefined;
  failed: { model: string; errorMessage: string | undefined; thinking?: ThinkingLevel } | undefined;
  messages: readonly { role: string; toolName?: string; isError?: boolean }[];
}

export interface RouteChoice {
  model: string;
  /** Only when the role has its own. Otherwise the level selected with /effort applies. */
  thinking?: ThinkingLevel;
  /** Only when it changed, because Pi stores every new object it gets. */
  state?: RouterState;
}

const OVERLOADED = /overload|rate.?limit|too many requests|capacity|\b(429|503|529)\b/i;
/** Includes pi-modes' yolo_edit and yolo_write. */
const CHANGES_FILES = /(^|_)(edit|write)$/;

/** Anywhere in the conversation, so a message sent right after an edit can't hide it. */
export function hasEdited(messages: RouteInput["messages"]): boolean {
  return messages.some((message) => message.role === "toolResult" && !message.isError && CHANGES_FILES.test(message.toolName ?? ""));
}

function nextState(input: RouteInput): RouterState {
  const state = input.state ?? { phase: "plan" };
  if (input.mode === "plan") return state.phase === "plan" && state.planned ? state : { phase: "plan", planned: true };
  if (state.phase === "plan" && (state.planned || hasEdited(input.messages))) return { phase: "build" };
  return state;
}

export function chooseModel(config: RouterConfig, input: RouteInput): RouteChoice {
  const forRole = (role: Role, model: string): Pick<RouteChoice, "model" | "thinking"> => {
    const thinking = config.thinking?.[role];
    return thinking === undefined ? { model } : { model, thinking };
  };
  const home = input.subagent && config.subagent !== undefined ? forRole("subagent", config.subagent) : forRole("build", config.build);
  // Compaction summaries, and any other extension's call that names the virtual model.
  if (input.reason === "direct") return home;

  // Worked out first, so an edit made on the fallback or during a retry still counts.
  const state = input.subagent ? input.state : nextState(input);
  const changed = state === input.state ? {} : { state };

  if (input.reason === "retry" && input.failed) {
    const overloaded = OVERLOADED.test(input.failed.errorMessage ?? "");
    if (overloaded && config.fallback !== undefined && config.fallback !== input.failed.model) return { ...forRole("fallback", config.fallback), ...changed };
    return { model: input.failed.model, ...(input.failed.thinking === undefined ? {} : { thinking: input.failed.thinking }), ...changed };
  }

  // Back on the first choice at the next message, not on every tool call in between.
  if (input.reason === "continuation" && input.previous !== undefined && input.previous === config.fallback) {
    return { ...forRole("fallback", input.previous), ...changed };
  }

  if (input.subagent) return home;
  const choice = input.mode === "plan" || state?.phase === "plan" ? forRole("plan", config.plan) : forRole("build", config.build);
  return { ...choice, ...changed };
}
