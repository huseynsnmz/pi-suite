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
  /** Whether the `agent` tool is pi-suite's own. Another package's could do anything. */
  agentIsOurs?: boolean;
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

/** It does nothing by itself: what the agent then does is still checked. */
function needsNoAsk(state: SessionState, details: unknown): boolean {
  return state.agentIsOurs === true && (details as { toolName?: unknown } | undefined)?.toolName === AGENT_TOOL;
}

function autoAllows(state: SessionState, details: unknown, log: unknown): boolean {
  if (state.mode !== "auto") return false;
  const { toolName, toolCallId } = (details ?? {}) as { toolName?: unknown; toolCallId?: unknown };
  const path = typeof toolCallId === "string" ? state.editPaths?.get(toolCallId) : undefined;
  if (!isProjectEdit({ toolName, path }, state.cwd)) return false;
  (log as { review?: (event: string, fields: unknown) => void } | undefined)?.review?.("pi-modes.project_edit", { path });
  return true;
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
      return autoAllows(state, details, log) ? { kind: "allow" } : authorize(details, query, log);
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

export function setGateAgentOurs(sessionId: string, ours: boolean, store: Store = globalThis as unknown as Store): void {
  stateFor(store, sessionId).agentIsOurs = ours;
}

export function judgeGated(sessionId: string, store: Store = globalThis as unknown as Store): boolean {
  return stateFor(store, sessionId).judgeGated;
}

export function clearGate(sessionId: string, store: Store = globalThis as unknown as Store): void {
  sessionStates(store).delete(sessionId);
}
