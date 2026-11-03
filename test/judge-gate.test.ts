import assert from "node:assert/strict";
import { test } from "node:test";
import { clearGate, installJudgeGate, judgeGated, setGateMode } from "../src/judge-gate.ts";

const SERVICES = Symbol.for("@gotgenes/pi-permission-system:session-services");
type Link = (...args: unknown[]) => Promise<unknown>;

function fakeService() {
  const links = new Map<string, Link>();
  return {
    links,
    registerAuthorizer(name: string, link: Link) {
      links.set(name, link);
      return () => links.delete(name);
    },
  };
}

function setup(sessionId = "s1") {
  const store: Record<symbol, unknown> = {};
  installJudgeGate(store);
  const service = fakeService();
  (store[SERVICES] as Map<string, unknown>).set(sessionId, service);
  let judged = 0;
  const judge: Link = async () => {
    judged += 1;
    return { kind: "allow" };
  };
  return { store, service, judge, judged: () => judged };
}

test("judge defers outside auto without being called", async () => {
  const { store, service, judge, judged } = setup();
  service.registerAuthorizer("permission-judge", judge);
  for (const mode of ["normal", "plan", "read-only"] as const) {
    setGateMode("s1", mode, store);
    assert.deepEqual(await service.links.get("permission-judge")?.(), { kind: "defer" });
  }
  assert.equal(judged(), 0);
});

test("judge decides in auto and stops when auto ends", async () => {
  const { store, service, judge } = setup();
  service.registerAuthorizer("permission-judge", judge);
  setGateMode("s1", "auto", store);
  assert.deepEqual(await service.links.get("permission-judge")?.(), { kind: "allow" });
  setGateMode("s1", "normal", store);
  assert.deepEqual(await service.links.get("permission-judge")?.(), { kind: "defer" });
});

test("a session with no recorded mode never auto-approves", async () => {
  const { store, service, judge } = setup();
  service.registerAuthorizer("permission-judge", judge);
  clearGate("s1", store);
  assert.deepEqual(await service.links.get("permission-judge")?.(), { kind: "defer" });
});

test("auto in one session does not open another", async () => {
  const { store, service, judge } = setup("s1");
  const other = fakeService();
  (store[SERVICES] as Map<string, unknown>).set("s2", other);
  service.registerAuthorizer("permission-judge", judge);
  other.registerAuthorizer("permission-judge", judge);
  setGateMode("s1", "auto", store);
  assert.deepEqual(await service.links.get("permission-judge")?.(), { kind: "allow" });
  assert.deepEqual(await other.links.get("permission-judge")?.(), { kind: "defer" });
});

test("a service published before install is still gated", async () => {
  const store: Record<symbol, unknown> = {};
  const service = fakeService();
  store[SERVICES] = new Map([["s1", service]]);
  installJudgeGate(store);
  service.registerAuthorizer("classifier", async () => ({ kind: "allow" }));
  assert.equal(judgeGated("s1", store), true);
  assert.deepEqual(await service.links.get("classifier")?.(), { kind: "defer" });
});

test("other links pass through untouched and install is idempotent", async () => {
  const { store, service } = setup();
  installJudgeGate(store);
  const link: Link = async () => ({ kind: "deny" });
  service.registerAuthorizer("someone-else", link);
  assert.equal(service.links.get("someone-else"), link);
  assert.equal(judgeGated("s1", store), false);
});
