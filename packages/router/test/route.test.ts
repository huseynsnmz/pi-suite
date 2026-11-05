import assert from "node:assert/strict";
import { test } from "node:test";

import type { RouterConfig } from "../src/config.ts";
import { chooseModel, type RouteInput, type RouterState } from "../src/route.ts";

const config: RouterConfig = { plan: "a/strong", build: "a/cheap", fallback: "b/other", subagent: "a/sub" };
const wrote = { role: "toolResult", toolName: "write" };
const input = (over: Partial<RouteInput>): RouteInput => ({
  reason: "user",
  mode: "normal",
  subagent: false,
  state: undefined,
  previous: undefined,
  failed: undefined,
  messages: [{ role: "user" }],
  ...over,
});

const planning: RouterState = { phase: "plan" };
const building: RouterState = { phase: "build" };
const inPlanMode: RouterState = { phase: "plan", planned: true };

for (const [name, over, model, state] of [
  ["a new session starts on the plan model", {}, "a/strong", planning],
  ["reading stays on the plan model", { reason: "continuation", state: planning, messages: [{ role: "user" }, { role: "toolResult", toolName: "read" }] }, "a/strong", undefined],
  ["a failed edit doesn't start building", { reason: "continuation", state: planning, messages: [{ role: "user" }, { ...wrote, isError: true }] }, "a/strong", undefined],
  ["the first edit moves to the build model", { reason: "continuation", state: planning, messages: [{ role: "user" }, wrote] }, "a/cheap", building],
  ["pi-modes' yolo_write counts as an edit", { reason: "continuation", state: planning, messages: [{ role: "user" }, { role: "toolResult", toolName: "yolo_write" }] }, "a/cheap", building],
  ["a message sent right after an edit doesn't hide it", { state: planning, messages: [wrote, { role: "user" }] }, "a/cheap", building],
  ["building lasts for the session", { state: building }, "a/cheap", undefined],
  ["plan mode always uses the plan model", { mode: "plan", state: building }, "a/strong", inPlanMode],
  ["an edit in plan mode doesn't start building", { reason: "continuation", mode: "plan", state: inPlanMode, messages: [{ role: "user" }, wrote] }, "a/strong", undefined],
  ["an approved plan moves to the build model at once", { reason: "continuation", state: inPlanMode }, "a/cheap", building],
  ["without pi-modes, it goes by the first edit", { mode: undefined, reason: "continuation", state: planning, messages: [{ role: "user" }, wrote] }, "a/cheap", building],
  ["read-only isn't plan mode", { mode: "read-only", state: building }, "a/cheap", undefined],
  ["compaction uses the build model", { reason: "direct", state: planning }, "a/cheap", undefined],
  ["a subagent uses its own model, with no phases", { subagent: true }, "a/sub", undefined],
] as [string, Partial<RouteInput>, string, RouterState | undefined][]) {
  test(name, () => {
    const choice = chooseModel(config, input(over));
    assert.equal(choice.model, model);
    assert.deepEqual(choice.state, state);
  });
}

test("an edit made on the fallback still starts building", () => {
  const choice = chooseModel(config, input({ reason: "continuation", previous: "b/other", state: planning, messages: [{ role: "user" }, wrote] }));
  assert.equal(choice.model, "b/other");
  assert.deepEqual(choice.state, building);
});

test("a plan model that's also the fallback doesn't stay on forever", () => {
  const same = { ...config, fallback: "a/strong" };
  const edited = chooseModel(same, input({ reason: "continuation", previous: "a/strong", state: planning, messages: [{ role: "user" }, wrote] }));
  assert.deepEqual(edited.state, building);
  assert.equal(chooseModel(same, input({ state: building, previous: "a/strong" })).model, "a/cheap");
});

test("a subagent's compaction stays on its model", () => {
  assert.equal(chooseModel(config, input({ reason: "direct", subagent: true })).model, "a/sub");
});

test("a subagent falls back on the build model", () => {
  assert.equal(chooseModel({ plan: "a/strong", build: "a/cheap" }, input({ subagent: true })).model, "a/cheap");
});

test("unchanged state isn't returned, because Pi stores every new object", () => {
  assert.equal(chooseModel(config, input({ state: building })).state, undefined);
  assert.equal(chooseModel(config, input({ mode: "plan", state: inPlanMode })).state, undefined);
});

const failed = (errorMessage: string, model = "a/strong") => ({ reason: "retry" as const, state: planning, failed: { model, errorMessage } });

for (const message of ["529 overloaded_error", "Rate limit reached", "HTTP 429", "503 Service Unavailable", "at capacity"]) {
  test(`an overloaded provider moves to the fallback: ${message}`, () => {
    assert.equal(chooseModel(config, input(failed(message))).model, "b/other");
  });
}

test("other failures retry on the same model, to keep the cache", () => {
  assert.equal(chooseModel(config, input(failed("context overflow"))).model, "a/strong");
});

test("an overloaded fallback, or none set, stays where it is", () => {
  assert.equal(chooseModel(config, input(failed("overloaded", "b/other"))).model, "b/other");
  assert.equal(chooseModel({ plan: "a/strong", build: "a/cheap" }, input(failed("overloaded"))).model, "a/strong");
});

test("the fallback keeps the rest of the turn, and the next message tries the first choice again", () => {
  assert.equal(chooseModel(config, input({ reason: "continuation", previous: "b/other", state: planning })).model, "b/other");
  assert.equal(chooseModel(config, input({ reason: "user", previous: "b/other", state: planning })).model, "a/strong");
});

test("a role's own reasoning goes with its model", () => {
  const set: RouterConfig = { ...config, thinking: { plan: "high", build: "low", fallback: "medium", subagent: "off" } };
  assert.equal(chooseModel(set, input({})).thinking, "high");
  assert.equal(chooseModel(set, input({ state: building })).thinking, "low");
  assert.equal(chooseModel(set, input({ reason: "direct" })).thinking, "low");
  assert.equal(chooseModel(set, input({ subagent: true })).thinking, "off");
  assert.equal(chooseModel(set, input({ reason: "retry", state: building, failed: { model: "a/cheap", errorMessage: "503" } })).thinking, "medium");
  assert.equal(chooseModel(set, input({ reason: "continuation", state: building, previous: "b/other" })).thinking, "medium");
});

test("a role with no reasoning of its own leaves it to /effort, and a retry keeps what failed", () => {
  const set: RouterConfig = { plan: "a/strong", build: "a/cheap", thinking: { build: "low" } };
  assert.equal("thinking" in chooseModel(set, input({})), false);
  assert.equal(chooseModel(set, input({ subagent: true })).thinking, "low");
  assert.equal(chooseModel(set, input({ reason: "retry", state: building, failed: { model: "a/cheap", errorMessage: "bad", thinking: "max" } })).thinking, "max");
});
