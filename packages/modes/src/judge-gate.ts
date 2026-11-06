/**
 * Lets the permission judge run only in auto mode, per session.
 *
 * pi-permission-system reads `authorizerChain` from a config file shared by
 * every Pi process, so editing it would flip auto for all open sessions. It
 * also has no API to read or disable a registered link. Instead this wraps the
 * judge at registration: outside auto the wrapper defers, which sends the ask
 * on to the normal prompt.
 *
 * Package load order must not matter, so the wrap is installed where each
 * session's service is published, which happens before any extension can
 * register on it. This depends on the service map's documented global key. If
 * that changes, `judgeGated` stays false and the extension warns.
 */

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AGENT_TOOL, type Mode } from "./modes.ts";

export const JUDGE_NAMES: ReadonlySet<string> = new Set(["permission-judge", "classifier"]);

export const YOLO_LINK = "pi-modes";

const SERVICES_KEY = Symbol.for("@gotgenes/pi-permission-system:session-services");
const STATE_KEY = Symbol.for("pi-modes:session-state");
const PATCHED = Symbol.for("pi-modes:patched");

type Authorize = (details: unknown, query: unknown, log: unknown) => Promise<unknown>;

interface ServiceLike {
  registerAuthorizer?: (name: string, authorize: Authorize) => () => void;
  [PATCHED]?: true;
}

type ServiceMap = Map<string, ServiceLike> & { [PATCHED]?: true };

interface SessionState {
  mode: Mode;
  judgeGated: boolean;
  cwd?: string;
  /** Which of SUITE_TOOLS come from pi-suite itself. Another package's tool with the name could do anything. */
  suiteTools?: ReadonlySet<string>;
  /** Tells the user, once a session, when the judge keeps passing asks on because it can't judge. */
  notify?: (text: string) => void;
  failures?: number;
  told?: boolean;
  /** Where the model's latest edits and writes go, by call id, as an ask doesn't say. */
  editPaths?: Map<string, string>;
}

/** Inside a project, but they run code or change what Pi does, so the judge still looks. */
const GUARDED = new Set([".git", ".pi", ".claude", ".husky", ".github", ".vscode", ".envrc"]);

/**
 * Pi's edit and write tools rewrite these before opening the file, so the path as written isn't the one written to.
 * The judge sees them rather than this copying Pi's rules, which could drift.
 */
const REWRITTEN_BY_PI = /^@|^file:|[\u00A0\u2000-\u200A\u202F\u205F\u3000]/;

/** The path with symlinks followed, as far as it exists. Undefined for a link that leads nowhere. */
function realTarget(path: string): string | undefined {
  if (existsSync(path)) return realpathSync(path);
  try {
    lstatSync(path);
    return undefined; // It's there, and can't be followed.
  } catch {
    const parent = dirname(path);
    if (parent === path) return undefined;
    const real = realTarget(parent);
    return real === undefined ? undefined : join(real, basename(path));
  }
}

/** An edit or write to an ordinary file in the project: what `auto` lets through without asking anyone. */
export function isProjectEdit(details: unknown, cwd: string | undefined): boolean {
  const { toolName, path } = (details ?? {}) as { toolName?: unknown; path?: unknown };
  if ((toolName !== "edit" && toolName !== "write") || typeof path !== "string" || cwd === undefined || REWRITTEN_BY_PI.test(path)) return false;
  const expanded = path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
  const target = realTarget(resolve(cwd, expanded));
  const root = realTarget(cwd);
  if (target === undefined || root === undefined) return false;
  const inside = relative(root, target);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return false;
  // Lowercase, as macOS finds `.GIT` at `.git` by default.
  return !inside.split(sep).some((part) => GUARDED.has(part.toLowerCase()));
}

/**
 * pi-suite's tools that only change what pi-suite keeps, such as memories and the todo list, or that have checks of
 * their own, as the web tools do. The judge defers what it doesn't know, so in auto it would send every one to you.
 */
const AUTO_TOOLS: ReadonlySet<string> = new Set(["todo", "ask_questions", "web_fetch", "web_search", "playbook", "memory_add", "memory_search", "memory_update", "memory_delete", "memory_review", "memory_review_done"]);

/** The tools the gate needs to know are pi-suite's own. */
export const SUITE_TOOLS: readonly string[] = [...AUTO_TOOLS, AGENT_TOOL];

/** Why the judge passed an ask on without judging it, and what to do about it. A judgment it made itself isn't here. */
const JUDGE_TROUBLE: Readonly<Record<string, string>> = {
  timeout: "its model didn't answer in time. Choose a faster judge in /router, or raise timeoutMs in the judge's config",
  "call-failed": "the call to its model failed. With router/auto selected, the judge needs a model of its own: set judge in /router",
  "model-unresolved": "it can't find its model. Set judge in /router",
  "auth-failed": "there's no login for its model. Run /login, or choose another judge in /router",
  "breaker-open": "its model failed several times in a row, so it's resting for a minute",
  "no-tool-call": "its model doesn't answer in the form the judge needs. Choose another judge in /router",
  "unrecognized-verdict": "its model doesn't answer in the form the judge needs. Choose another judge in /router",
  "guidance-load-failed": "it can't read its guidance files",
  "no-config": "it has no config",
};
const TROUBLE_STREAK = 3;

/** It does nothing by itself: what the agent then does is still checked. */
function needsNoAsk(state: SessionState, details: unknown): boolean {
  return state.suiteTools?.has(AGENT_TOOL) === true && (details as { toolName?: unknown } | undefined)?.toolName === AGENT_TOOL;
}

function review(log: unknown, event: string, fields: unknown): void {
  (log as { review?: (event: string, fields: unknown) => void } | undefined)?.review?.(event, fields);
}

function autoAllows(state: SessionState, details: unknown, log: unknown): boolean {
  if (state.mode !== "auto") return false;
  const { toolName, toolCallId } = (details ?? {}) as { toolName?: unknown; toolCallId?: unknown };
  if (typeof toolName === "string" && AUTO_TOOLS.has(toolName) && state.suiteTools?.has(toolName) === true) {
    review(log, "pi-modes.suite_tool", { tool: toolName });
    return true;
  }
  const path = typeof toolCallId === "string" ? state.editPaths?.get(toolCallId) : undefined;
  if (!isProjectEdit({ toolName, path }, state.cwd)) return false;
  review(log, "pi-modes.project_edit", { path });
  return true;
}

/** The judge's log, passing everything through, with its decisions also shown to `seen`. */
function watching(log: unknown, seen: (fields: { deferReason?: unknown }) => void): unknown {
  if (typeof log !== "object" || log === null || typeof (log as { review?: unknown }).review !== "function") return log;
  return new Proxy(log, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (key !== "review") return value.bind(target);
      return (event: unknown, fields: unknown) => {
        if (event === "classifier.decision" && typeof fields === "object" && fields !== null) seen(fields);
        return value.call(target, event, fields);
      };
    },
  });
}

/** Counts asks in a row the judge couldn't judge, and says why once they look like more than a blip. */
function noteJudged(state: SessionState, verdict: unknown, reason: unknown): void {
  const trouble = (verdict as { kind?: unknown } | undefined)?.kind === "defer" && typeof reason === "string" ? JUDGE_TROUBLE[reason] : undefined;
  state.failures = trouble === undefined ? 0 : (state.failures ?? 0) + 1;
  if (trouble === undefined || state.failures < TROUBLE_STREAK || state.told) return;
  state.told = true;
  state.notify?.(`The permission judge passed the last ${state.failures} asks to you without judging them: ${trouble}. /skill:review-permissions shows more.`);
}

type Store = Record<symbol, unknown>;

function sessionStates(store: Store): Map<string, SessionState> {
  store[STATE_KEY] ??= new Map<string, SessionState>();
  return store[STATE_KEY] as Map<string, SessionState>;
}

function stateFor(store: Store, sessionId: string): SessionState {
  const states = sessionStates(store);
  let state = states.get(sessionId);
  if (!state) {
    state = { mode: "normal", judgeGated: false };
    states.set(sessionId, state);
  }
  return state;
}

function gateService(store: Store, sessionId: string, service: ServiceLike): void {
  if (service[PATCHED] || typeof service.registerAuthorizer !== "function") return;
  service[PATCHED] = true;
  const register = service.registerAuthorizer.bind(service);
  service.registerAuthorizer = (name, authorize) => {
    if (!JUDGE_NAMES.has(name)) return register(name, authorize);
    stateFor(store, sessionId).judgeGated = true;
    return register(name, async (details, query, log) => {
      const state = stateFor(store, sessionId);
      if (needsNoAsk(state, details)) return { kind: "allow" };
      if (state.mode !== "auto") return { kind: "defer" };
      if (autoAllows(state, details, log)) return { kind: "allow" };
      let reason: unknown;
      const verdict = await authorize(details, query, watching(log, (fields) => (reason = fields.deferReason)));
      noteJudged(state, verdict, reason);
      return verdict;
    });
  };
}

/** Safe to call from every extension instance: the map is patched once per process. */
export function installJudgeGate(store: Store = globalThis as unknown as Store): void {
  store[SERVICES_KEY] ??= new Map<string, ServiceLike>();
  const services = store[SERVICES_KEY] as ServiceMap;
  if (services[PATCHED]) return;
  services[PATCHED] = true;

  for (const [sessionId, service] of services) gateService(store, sessionId, service);
  const set = services.set.bind(services);
  services.set = (sessionId, service) => {
    gateService(store, sessionId, service);
    return set(sessionId, service);
  };
}

/**
 * Registers the link that makes yolo work: it allows every ask in yolo and defers otherwise.
 * It decides nothing until the user names it in `authorizerChain`, and because it only runs on
 * an ask, `deny` rules still block. The review log names it, so yolo's approvals stay visible.
 * Returns a disposer, or undefined when this session has no permission system.
 */
export function registerYoloLink(sessionId: string, store: Store = globalThis as unknown as Store): (() => void) | undefined {
  const service = (store[SERVICES_KEY] as ServiceMap | undefined)?.get(sessionId);
  if (typeof service?.registerAuthorizer !== "function") return undefined;
  return service.registerAuthorizer(YOLO_LINK, async (details, _query, log) => {
    const state = stateFor(store, sessionId);
    return needsNoAsk(state, details) || state.mode === "yolo" || autoAllows(state, details, log) ? { kind: "allow" } : { kind: "defer" };
  });
}

export function hasPermissionSystem(sessionId: string, store: Store = globalThis as unknown as Store): boolean {
  return (store[SERVICES_KEY] as ServiceMap | undefined)?.has(sessionId) === true;
}

export function setGateMode(sessionId: string, mode: Mode, store: Store = globalThis as unknown as Store): void {
  stateFor(store, sessionId).mode = mode;
}

/** Called with each message the model finishes, which comes before any of its tools are asked about. */
export function noteEditPaths(sessionId: string, message: unknown, store: Store = globalThis as unknown as Store): void {
  const { role, content } = (message ?? {}) as { role?: unknown; content?: unknown };
  if (role !== "assistant" || !Array.isArray(content)) return;
  const paths = new Map<string, string>();
  for (const block of content as { type?: unknown; id?: unknown; name?: unknown; arguments?: { path?: unknown } }[]) {
    if (block?.type === "toolCall" && (block.name === "edit" || block.name === "write") && typeof block.id === "string" && typeof block.arguments?.path === "string") {
      paths.set(block.id, block.arguments.path);
    }
  }
  stateFor(store, sessionId).editPaths = paths;
}

export function setGateCwd(sessionId: string, cwd: string, store: Store = globalThis as unknown as Store): void {
  stateFor(store, sessionId).cwd = cwd;
}

/** Which of SUITE_TOOLS are pi-suite's own in this session. */
export function setGateSuiteTools(sessionId: string, names: readonly string[], store: Store = globalThis as unknown as Store): void {
  stateFor(store, sessionId).suiteTools = new Set(names);
}

export function setGateNotify(sessionId: string, notify: (text: string) => void, store: Store = globalThis as unknown as Store): void {
  stateFor(store, sessionId).notify = notify;
}

export function judgeGated(sessionId: string, store: Store = globalThis as unknown as Store): boolean {
  return stateFor(store, sessionId).judgeGated;
}

export function clearGate(sessionId: string, store: Store = globalThis as unknown as Store): void {
  sessionStates(store).delete(sessionId);
}
