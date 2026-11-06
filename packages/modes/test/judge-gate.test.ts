import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { clearGate, hasPermissionSystem, installJudgeGate, isProjectEdit, judgeGated, noteEditPaths, registerYoloLink, setGateCwd, setGateMode, setGateNotify, setGateSuiteTools, YOLO_LINK } from "../src/judge-gate.ts";

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

test("the yolo link allows only in yolo, per session, and stops when disposed", async () => {
  const { store, service } = setup();
  const dispose = registerYoloLink("s1", store);
  const link = service.links.get(YOLO_LINK) as Link;
  assert.deepEqual(await link(), { kind: "defer" });
  for (const mode of ["auto", "plan", "read-only"] as const) {
    setGateMode("s1", mode, store);
    assert.deepEqual(await link(), { kind: "defer" });
  }
  setGateMode("s2", "yolo", store);
  assert.deepEqual(await link(), { kind: "defer" });
  setGateMode("s1", "yolo", store);
  assert.deepEqual(await link(), { kind: "allow" });
  dispose?.();
  assert.equal(service.links.has(YOLO_LINK), false);
});

test("the judge does not approve in yolo, so yolo stays on one link", async () => {
  const { store, service, judge, judged } = setup();
  service.registerAuthorizer("permission-judge", judge);
  setGateMode("s1", "yolo", store);
  assert.deepEqual(await (service.links.get("permission-judge") as Link)(), { kind: "defer" });
  assert.equal(judged(), 0);
});

test("no permission system, no link", () => {
  const store: Record<symbol, unknown> = {};
  installJudgeGate(store);
  assert.equal(registerYoloLink("s1", store), undefined);
  assert.equal(hasPermissionSystem("s1", store), false);
});

test("auto spares the judge only for ordinary files in the project", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gate-")));
  const project = join(root, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  symlinkSync(root, join(project, "out"));
  symlinkSync(join(root, "nowhere"), join(project, "dangling"));
  const cases: [string, unknown, boolean][] = [
    ["an existing folder", { toolName: "edit", path: "src/a.go" }, true],
    ["a new folder", { toolName: "write", path: join(project, "new/deep/a.go") }, true],
    ["a tool that isn't an edit", { toolName: "bash", path: "src/a.go" }, false],
    ["no path", { toolName: "edit" }, false],
    ["outside the project", { toolName: "edit", path: "../a.go" }, false],
    ["a sibling folder with the same start", { toolName: "edit", path: "../project2/a.go" }, false],
    ["through a symlink out", { toolName: "write", path: "out/a.go" }, false],
    ["a link that leads nowhere", { toolName: "write", path: "dangling" }, false],
    ["git's hooks", { toolName: "write", path: ".git/hooks/pre-commit" }, false],
    ["a nested guarded folder", { toolName: "edit", path: "src/.github/workflows/x.yml" }, false],
    ["direnv", { toolName: "write", path: ".envrc" }, false],
    ["the project itself", { toolName: "write", path: "." }, false],
    ["Pi drops a leading @, so this is git's hooks", { toolName: "write", path: "@.git/hooks/pre-commit" }, false],
    ["Pi drops a leading @, so this is outside", { toolName: "write", path: "@/etc/x" }, false],
    ["Pi reads a file URL", { toolName: "write", path: "file:///etc/x" }, false],
    ["Pi rewrites odd spaces", { toolName: "write", path: "a\u00A0b.go" }, false],
    ["an @ further along is just a name", { toolName: "write", path: "src/@types/a.ts" }, true],
    ["another case of git's hooks", { toolName: "write", path: ".GIT/hooks/pre-commit" }, false],
    ["another case of a guarded folder", { toolName: "edit", path: "src/.Github/workflows/x.yml" }, false],
  ];
  for (const [name, details, want] of cases) assert.equal(isProjectEdit(details, project), want, name);
  assert.equal(isProjectEdit({ toolName: "edit", path: "src/a.go" }, undefined), false, "no folder known");
});

test("project edits are allowed in auto alone, with or without the judge in the chain", async () => {
  const { store, service, judge, judged } = setup();
  service.registerAuthorizer("permission-judge", judge);
  registerYoloLink("s1", store);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-")));
  setGateCwd("s1", dir, store);
  noteEditPaths("s1", { role: "assistant", content: [
    { type: "text", text: "x" },
    { type: "toolCall", id: "here", name: "edit", arguments: { path: "a.go" } },
    { type: "toolCall", id: "away", name: "edit", arguments: { path: "/elsewhere/a.go" } },
  ] }, store);
  const edit = { toolName: "edit", toolCallId: "here" };
  const reviews: string[] = [];
  const log = { review: (event: string) => reviews.push(event) };
  for (const name of ["permission-judge", YOLO_LINK]) {
    setGateMode("s1", "auto", store);
    assert.deepEqual(await service.links.get(name)?.(edit, null, log), { kind: "allow" }, name);
    setGateMode("s1", "normal", store);
    assert.deepEqual(await service.links.get(name)?.(edit, null, log), { kind: "defer" }, name);
  }
  assert.equal(judged(), 0);
  assert.equal(reviews.length, 2);
  setGateMode("s1", "auto", store);
  await service.links.get("permission-judge")?.({ toolName: "edit", toolCallId: "away" }, null, log);
  assert.equal(judged(), 1, "outside the project");
  await service.links.get("permission-judge")?.({ toolName: "edit", toolCallId: "unknown" }, null, log);
  assert.equal(judged(), 2, "a call it didn't see");
  noteEditPaths("s1", { role: "assistant", content: [] }, store);
  await service.links.get("permission-judge")?.(edit, null, log);
  assert.equal(judged(), 3, "an older message's call");
});

test("another package's agent tool is asked about like anything else", async () => {
  const { store, service, judge, judged } = setup();
  service.registerAuthorizer("permission-judge", judge);
  registerYoloLink("s1", store);
  setGateMode("s1", "normal", store);
  assert.deepEqual(await service.links.get("permission-judge")?.({ toolName: "agent" }), { kind: "defer" }, "nothing known yet");
  setGateSuiteTools("s1", [], store);
  assert.deepEqual(await service.links.get("permission-judge")?.({ toolName: "agent" }), { kind: "defer" });
  assert.deepEqual(await service.links.get(YOLO_LINK)?.({ toolName: "agent" }), { kind: "defer" });
  setGateMode("s1", "auto", store);
  await service.links.get("permission-judge")?.({ toolName: "agent" });
  assert.equal(judged(), 1);
});

test("our agent needs no ask in any mode, as what it does is still checked", async () => {
  const { store, service, judge, judged } = setup();
  service.registerAuthorizer("permission-judge", judge);
  setGateSuiteTools("s1", ["agent"], store);
  for (const mode of ["normal", "auto"] as const) {
    setGateMode("s1", mode, store);
    assert.deepEqual(await service.links.get("permission-judge")?.({ toolName: "agent" }), { kind: "allow" });
  }
  assert.equal(judged(), 0);
});

test("in auto, pi-suite's own tools for memory, todos, questions and the web skip the judge", async () => {
  const { store, service, judge, judged } = setup();
  service.registerAuthorizer("permission-judge", judge);
  registerYoloLink("s1", store);
  setGateSuiteTools("s1", ["memory_update", "todo"], store);
  const reviews: string[] = [];
  const log = { review: (event: string) => reviews.push(event) };
  setGateMode("s1", "auto", store);
  for (const name of ["permission-judge", YOLO_LINK]) {
    assert.deepEqual(await service.links.get(name)?.({ toolName: "memory_update" }, null, log), { kind: "allow" }, name);
    assert.deepEqual(await service.links.get(name)?.({ toolName: "todo" }, null, log), { kind: "allow" }, name);
  }
  assert.equal(judged(), 0);
  assert.deepEqual(new Set(reviews), new Set(["pi-modes.suite_tool"]));
  await service.links.get("permission-judge")?.({ toolName: "memory_add" }, null, log);
  assert.equal(judged(), 1, "a name that isn't pi-suite's own here");
  await service.links.get("permission-judge")?.({ toolName: "bash" }, null, log);
  assert.equal(judged(), 2, "anything else");
  setGateMode("s1", "normal", store);
  assert.deepEqual(await service.links.get("permission-judge")?.({ toolName: "memory_update" }, null, log), { kind: "defer" }, "normal asks you");
});

test("when the judge keeps failing to judge, you're told once why", async () => {
  const store: Record<symbol, unknown> = {};
  installJudgeGate(store);
  const service = fakeService();
  (store[SERVICES] as Map<string, unknown>).set("s1", service);
  let reason: string | undefined = "timeout";
  service.registerAuthorizer("permission-judge", async (_details: unknown, _query: unknown, log: unknown) => {
    (log as { review: (event: string, fields: unknown) => void }).review("classifier.decision", { verdict: reason === undefined ? "allow" : "defer", deferReason: reason });
    return { kind: reason === undefined ? "allow" : "defer" };
  });
  const told: string[] = [];
  const logged: string[] = [];
  setGateNotify("s1", (text) => told.push(text), store);
  setGateMode("s1", "auto", store);
  const ask = () => service.links.get("permission-judge")?.({ toolName: "bash" }, null, { review: (event: string) => logged.push(event) });
  await ask();
  await ask();
  reason = undefined;
  await ask();
  reason = "timeout";
  await ask();
  await ask();
  assert.deepEqual(told, [], "a success in between starts the count again");
  await ask();
  assert.equal(told.length, 1);
  assert.match(told[0] ?? "", /last 3 asks.*didn't answer in time.*\/router/);
  await ask();
  assert.equal(told.length, 1, "once a session");
  assert.equal(logged.length, 7, "the judge's own log still gets everything");
});

test("a judgment the judge made itself isn't trouble", async () => {
  const store: Record<symbol, unknown> = {};
  installJudgeGate(store);
  const service = fakeService();
  (store[SERVICES] as Map<string, unknown>).set("s1", service);
  service.registerAuthorizer("permission-judge", async (_details: unknown, _query: unknown, log: unknown) => {
    (log as { review: (event: string, fields: unknown) => void }).review("classifier.decision", { verdict: "defer", deferReason: "model-verdict" });
    return { kind: "defer" };
  });
  const told: string[] = [];
  setGateNotify("s1", (text) => told.push(text), store);
  setGateMode("s1", "auto", store);
  for (let i = 0; i < 5; i++) await service.links.get("permission-judge")?.({ toolName: "bash" }, null, { review: () => {} });
  assert.deepEqual(told, []);
});
