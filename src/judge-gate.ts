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

import type { Mode } from "./modes.ts";

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
    return register(name, async (details, query, log) =>
      stateFor(store, sessionId).mode === "auto" ? authorize(details, query, log) : { kind: "defer" },
    );
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
  return service.registerAuthorizer(YOLO_LINK, async () =>
    stateFor(store, sessionId).mode === "yolo" ? { kind: "allow" } : { kind: "defer" },
  );
}

export function hasPermissionSystem(sessionId: string, store: Store = globalThis as unknown as Store): boolean {
  return (store[SERVICES_KEY] as ServiceMap | undefined)?.has(sessionId) === true;
}

export function setGateMode(sessionId: string, mode: Mode, store: Store = globalThis as unknown as Store): void {
  stateFor(store, sessionId).mode = mode;
}

export function judgeGated(sessionId: string, store: Store = globalThis as unknown as Store): boolean {
  return stateFor(store, sessionId).judgeGated;
}

export function clearGate(sessionId: string, store: Store = globalThis as unknown as Store): void {
  sessionStates(store).delete(sessionId);
}
