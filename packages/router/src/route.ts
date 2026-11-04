// Which real model answers a request. Pure, so every rule can be tested without Pi.
import type { RouterConfig } from "./config.ts";

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
  failed: { model: string; errorMessage: string | undefined } | undefined;
  messages: readonly { role: string; toolName?: string; isError?: boolean }[];
}

export interface RouteChoice {
  model: string;
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
  const home = input.subagent ? (config.subagent ?? config.build) : config.build;
  // Compaction summaries, and any other extension's call that names the virtual model.
  if (input.reason === "direct") return { model: home };

  // Worked out first, so an edit made on the fallback or during a retry still counts.
  const state = input.subagent ? input.state : nextState(input);
  const changed = state === input.state ? {} : { state };

  if (input.reason === "retry" && input.failed) {
    const overloaded = OVERLOADED.test(input.failed.errorMessage ?? "");
    const moves = overloaded && config.fallback !== undefined && config.fallback !== input.failed.model;
    return { model: moves ? (config.fallback as string) : input.failed.model, ...changed };
  }

  // Back on the first choice at the next message, not on every tool call in between.
  if (input.reason === "continuation" && input.previous !== undefined && input.previous === config.fallback) {
    return { model: input.previous, ...changed };
  }

  if (input.subagent) return { model: home };
  const model = input.mode === "plan" || state?.phase === "plan" ? config.plan : config.build;
  return { model, ...changed };
}
