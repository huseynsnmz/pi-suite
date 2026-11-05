import assert from "node:assert/strict";
import test from "node:test";
import { childArgs, childEnv, runChild, trimAnswer } from "../src/index.ts";

test("explore is limited to reading, and general keeps every tool", () => {
  assert.deepEqual(childArgs({ type: "explore", model: "a/b", thinking: "high" }), ["-p", "--no-session", "--model", "a/b", "--thinking", "high", "--tools", "read,grep,find,ls"]);
  assert.deepEqual(childArgs({ type: "general" }), ["-p", "--no-session"]);
});

test("a child knows its parent, and always gets its mode from it", () => {
  const env = childEnv({ HOME: "/h" }, "parent-1", "auto");
  assert.deepEqual(env, { HOME: "/h", PI_SUBAGENT_CHILD: "1", PI_SUBAGENT_PARENT_SESSION: "parent-1", PI_MODES_START: "auto" });
  const cases: [string | undefined, string | undefined][] = [["normal", "normal"], ["auto", "auto"], ["read-only", "read-only"], ["plan", "read-only"], ["yolo", "normal"], [undefined, undefined]];
  for (const [mode, want] of cases) assert.equal(childEnv({}, "p", mode).PI_MODES_START, want, String(mode));
});

test("a character split across two chunks stays whole", async () => {
  const bytes = [...Buffer.from("é")];
  const script = `process.stdout.write(Buffer.from([${bytes[0]}]), () => setTimeout(() => process.stdout.write(Buffer.from([${bytes[1]}])), 50));`;
  assert.equal(await runChild(process.cwd(), ["-e", script], process.env, "", undefined), "é");
});

test("a long answer is cut, and says so", () => {
  assert.equal(trimAnswer(" ok \n"), "ok");
  assert.match(trimAnswer("x".repeat(40_000)), /x\n\[The answer was cut at 30000 characters\.\]$/);
});
