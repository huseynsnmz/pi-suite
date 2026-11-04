import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withAliases, withoutAliases } from "../src/deny-off.ts";
import { fromExpectedPackage, scriptedChange, decideToolCall, displayCommand, loadsAfterPermissionSystem, type Mode, modePrompt, nextMode, resumedMode, startingMode, SUBMIT_PLAN_TOOL } from "../src/modes.ts";
import { borrowStatusReader, loadsFirst, sandboxInstalled, sandboxIsOn } from "../src/sandbox.ts";

const bash = (command: string) => ({ command });

const cases: Array<[string, Mode, string, unknown, string]> = [
  ["normal leaves write to the permission system", "normal", "write", {}, "allow"],
  ["auto leaves bash to the permission system", "auto", "bash", bash("rm x"), "allow"],
  ["yolo leaves bash to the permission system", "yolo", "bash", bash("rm x"), "allow"],
  ["plan allows reading", "plan", "read", {}, "allow"],
  ["plan allows pi-web fetch", "plan", "web_fetch", {}, "allow"],
  ["plan allows pi-frame todo", "plan", "todo", {}, "allow"],
  ["read-only allows pi-frame todo", "read-only", "todo", {}, "allow"],
  ["plan allows asking the user", "plan", "ask_questions", {}, "allow"],
  ["read-only allows asking the user", "read-only", "ask_questions", {}, "allow"],
  ["read-only allows pi-web search", "read-only", "web_search", {}, "allow"],
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
  ["plan runs codemode scripts", "plan", "codemode", {}, "allow"],
  ["read-only runs codemode scripts", "read-only", "codemode", {}, "allow"],
  ["read-only blocks unknown tools", "read-only", "some_new_tool", {}, "block"],
  ["malformed bash input is blocked", "plan", "bash", { command: 1 }, "block"],
  ["null bash input is blocked", "read-only", "bash", null, "block"],
];

for (const [name, mode, tool, input, action] of cases) {
  test(name, () => {
    assert.equal(decideToolCall(mode, tool, input).action, action);
  });
}

for (const [name, tool, input, blocked] of [
  ["edit", "edit", {}, true],
  ["write", "write", {}, true],
  ["yolo_write", "yolo_write", {}, true],
  ["powershell", "powershell", { command: "dir" }, true],
  ["bash that changes things", "bash", bash("npm test"), true],
  ["yolo_bash that changes things", "yolo_bash", bash("touch x"), true],
  ["malformed bash", "bash", { command: 1 }, true],
  ["read-only bash", "bash", bash("git status"), false],
  ["read", "read", {}, false],
  ["web_fetch", "web_fetch", {}, false],
  ["an MCP tool", "mcp__x__search", {}, false],
] as const) {
  test(`from a script: ${name} is ${blocked ? "blocked" : "allowed"}`, () => {
    assert.equal(scriptedChange(tool, input) !== undefined, blocked);
  });
}

test("codemode counts only as Pi's own, not another package's tool with the name", () => {
  assert.equal(fromExpectedPackage("codemode", "builtin:codemode"), true);
  assert.equal(fromExpectedPackage("codemode", "/somewhere/else/index.ts"), false);
  assert.equal(fromExpectedPackage("codemode", undefined), false);
});

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
  ["loaded after the gate", ["npm:@gotgenes/pi-permission-system@42.0.0", "git:github.com/huseynsnmz/pi-suite@v1"], true],
  ["loaded first", ["git:github.com/huseynsnmz/pi-suite@v1", "npm:@gotgenes/pi-permission-system@42.0.0"], false],
  ["object form", [{ source: "npm:pi-permission-system" }, { source: "pi-suite" }], true],
  ["no gate installed", ["pi-suite"], false],
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

test("the sandbox counts as on only while its status says so, and is off with no way to read it", () => {
  const reader = (text: string) => ({ getExtensionStatuses: () => new Map([["sandbox", text]]) });
  assert.equal(sandboxIsOn(reader("locked")), true);
  assert.equal(sandboxIsOn(reader("")), false);
  assert.equal(sandboxIsOn({ getExtensionStatuses: () => new Map() }), false);
  assert.equal(sandboxIsOn(undefined), false);
  assert.equal(sandboxInstalled([{ name: "sandbox-enable" }]), true);
  assert.equal(sandboxInstalled([{ name: "mode" }]), false);
});

test("reading the statuses leaves the footer as it found it, and needs to load first", () => {
  const calls: string[] = [];
  const data = { getExtensionStatuses: () => new Map() };
  const reader = borrowStatusReader({
    setFooter(factory) {
      calls.push(factory === undefined ? "restored" : "set");
      factory?.(undefined as never, undefined as never, data);
    },
  });
  assert.equal(reader, data);
  assert.deepEqual(calls, ["set", "restored"]);
  for (const first of ["npm:@huseynsnmz/pi-suite@0.2.2", "/work/pi-suite", { source: "npm:@huseynsnmz/pi-suite" }]) assert.equal(loadsFirst([first, "x"]), true);
  for (const packages of [["npm:pi-sandbox", "npm:@huseynsnmz/pi-suite"], [], undefined]) assert.equal(loadsFirst(packages), false);
});

test("a new session starts in the configured mode, but never in yolo", () => {
  assert.equal(startingMode("plan"), "plan");
  assert.equal(startingMode("yolo"), "normal");
  assert.equal(startingMode("nonsense"), "normal");
  assert.equal(startingMode(undefined), "normal");
});

test("these tools are only trusted from the suite's own entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "suite-"));
  const entry = join(dir, "entry.ts");
  const other = join(dir, "pi-suite-evil.ts");
  writeFileSync(entry, "");
  writeFileSync(other, "");
  for (const tool of ["todo", "ask_questions", "web_fetch", "web_search"]) {
    assert.equal(fromExpectedPackage(tool, entry, entry), true, tool);
    assert.equal(fromExpectedPackage(tool, other, entry), false, tool);
    assert.equal(fromExpectedPackage(tool, undefined, entry), false, tool);
  }
  const link = join(dir, "link.ts");
  symlinkSync(entry, link);
  assert.equal(fromExpectedPackage("todo", link, entry), true);
  assert.equal(fromExpectedPackage("read", undefined, entry), true);
});
