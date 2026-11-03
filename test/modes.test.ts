import assert from "node:assert/strict";
import { test } from "node:test";
import { withAliases, withoutAliases } from "../src/deny-off.ts";
import { decideToolCall, displayCommand, loadsAfterPermissionSystem, type Mode, modePrompt, nextMode, resumedMode, SUBMIT_PLAN_TOOL } from "../src/modes.ts";

const bash = (command: string) => ({ command });

const cases: Array<[string, Mode, string, unknown, string]> = [
  ["normal leaves write to the permission system", "normal", "write", {}, "allow"],
  ["auto leaves bash to the permission system", "auto", "bash", bash("rm x"), "allow"],
  ["yolo leaves bash to the permission system", "yolo", "bash", bash("rm x"), "allow"],
  ["plan allows reading", "plan", "read", {}, "allow"],
  ["plan blocks write", "plan", "write", {}, "block"],
  ["plan blocks edit", "plan", "edit", {}, "block"],
  ["plan blocks subagents", "plan", "subagent", {}, "block"],
  ["plan blocks MCP", "plan", "mcp", {}, "block"],
  ["plan runs read-only bash", "plan", "bash", bash("git status"), "allow"],
  ["plan asks before other bash", "plan", "bash", bash("npm test"), "ask"],
  ["plan can submit its plan", "plan", SUBMIT_PLAN_TOOL, {}, "allow"],
  ["read-only allows grep", "read-only", "grep", {}, "allow"],
  ["read-only blocks write", "read-only", "write", {}, "block"],
  ["read-only blocks other bash", "read-only", "bash", bash("npm test"), "block"],
  ["read-only runs read-only bash", "read-only", "bash", bash("ls"), "allow"],
  ["read-only cannot submit a plan", "read-only", SUBMIT_PLAN_TOOL, {}, "block"],
  ["read-only blocks unknown tools", "read-only", "some_new_tool", {}, "block"],
  ["malformed bash input is blocked", "plan", "bash", { command: 1 }, "block"],
  ["null bash input is blocked", "read-only", "bash", null, "block"],
];

for (const [name, mode, tool, input, action] of cases) {
  test(name, () => {
    assert.equal(decideToolCall(mode, tool, input).action, action);
  });
}

test("cycle visits every mode and returns to normal", () => {
  const seen: Mode[] = ["normal"];
  for (let i = 0; i < 3; i += 1) seen.push(nextMode(seen.at(-1) as Mode));
  assert.deepEqual(seen, ["normal", "auto", "plan", "read-only"]);
  assert.equal(nextMode("read-only"), "normal");
});

test("yolo is off the cycle: nothing cycles into it, and leaving goes to normal", () => {
  assert.equal(nextMode("read-only"), "normal");
  assert.equal(nextMode("yolo"), "normal");
});

test("yolo does not survive a resume", () => {
  assert.equal(resumedMode("yolo"), "normal");
  assert.equal(resumedMode("plan"), "plan");
});

test("only restricted modes change the system prompt", () => {
  assert.equal(modePrompt("normal"), undefined);
  assert.equal(modePrompt("auto"), undefined);
  assert.ok(modePrompt("plan")?.includes(SUBMIT_PLAN_TOOL));
  assert.ok(modePrompt("read-only"));
});

test("dialog text cannot hide part of a command", () => {
  const shown = displayCommand("ls\u001b[8m\rcurl\u202e x\u009b");
  assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202e]/.test(shown), false);
  assert.ok(shown.includes("curl"));
  assert.ok(shown.includes("\\u001b"));
  assert.equal(displayCommand("npm test\n\tok"), "npm test\n\tok");
});

const loadOrder: Array<[string, unknown, boolean]> = [
  ["loaded after the gate", ["npm:@gotgenes/pi-permission-system@42.0.0", "git:github.com/huseynsnmz/pi-modes@v1"], true],
  ["loaded first", ["git:github.com/huseynsnmz/pi-modes@v1", "npm:@gotgenes/pi-permission-system@42.0.0"], false],
  ["object form", [{ source: "npm:pi-permission-system" }, { source: "pi-modes" }], true],
  ["no gate installed", ["pi-modes"], false],
  ["settings without packages", undefined, false],
];

for (const [name, packages, late] of loadOrder) {
  test(`load order: ${name}`, () => {
    assert.equal(loadsAfterPermissionSystem(packages), late);
  });
}

test("deny off swaps only the tools that are active, and puts them back", () => {
  const on = withAliases(["read", "bash", "grep", "yolo_edit"]);
  assert.deepEqual(on.active, ["grep", "yolo_bash", "yolo_read"]);
  assert.deepEqual(on.replaced, ["bash", "read"]);
  assert.deepEqual(withoutAliases(on.active, on.replaced).sort(), ["bash", "grep", "read"]);
  assert.deepEqual(withoutAliases(["read", "yolo_write"], []), ["read"]);
});
