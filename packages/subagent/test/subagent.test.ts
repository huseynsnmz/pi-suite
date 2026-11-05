import assert from "node:assert/strict";
import test from "node:test";
import { childArgs, childEnv, trimAnswer } from "../src/index.ts";

test("explore is limited to reading, and general keeps every tool", () => {
  assert.deepEqual(childArgs({ type: "explore", model: "a/b", thinking: "high" }), ["-p", "--no-session", "--model", "a/b", "--thinking", "high", "--tools", "read,grep,find,ls"]);
  assert.deepEqual(childArgs({ type: "general" }), ["-p", "--no-session"]);
});

test("a child knows its parent, and only auto carries over", () => {
  const env = childEnv({ HOME: "/h" }, "parent-1", "auto");
  assert.deepEqual(env, { HOME: "/h", PI_SUBAGENT_CHILD: "1", PI_SUBAGENT_PARENT_SESSION: "parent-1", PI_MODES_START: "auto" });
  for (const mode of ["normal", "plan", "yolo", undefined]) assert.equal(childEnv({}, "p", mode).PI_MODES_START, undefined);
});

test("a long answer is cut, and says so", () => {
  assert.equal(trimAnswer(" ok \n"), "ok");
  assert.match(trimAnswer("x".repeat(40_000)), /x\n\[The answer was cut at 30000 characters\.\]$/);
});
