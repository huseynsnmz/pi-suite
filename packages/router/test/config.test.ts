import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { isComplete, loadConfig, parseConfig, parseRef, saveConfig } from "../src/config.ts";
import { judgeModel, setJudgeModel } from "../src/judge.ts";

const dir = () => mkdtempSync(join(tmpdir(), "router-"));

for (const [name, raw, message] of [
  ["not an object", [], /must be an object/],
  ["an unknown role", { planner: "a/b" }, /unknown role "planner"/],
  ["a model without a provider", { plan: "opus" }, /provider\/model/],
  ["a value that isn't text", { plan: 3 }, /provider\/model/],
  ["routing to itself", { plan: "router/auto" }, /can't be a virtual model/],
] as [string, unknown, RegExp][]) {
  test(`refuses ${name}`, () => assert.throws(() => parseConfig(raw), message));
}

test("a model id can hold slashes and colons", () => {
  assert.deepEqual(parseRef("cf/workers-ai/@cf/kimi:free"), { provider: "cf", id: "workers-ai/@cf/kimi:free" });
  assert.doesNotThrow(() => parseConfig({ plan: "cf/workers-ai/@cf/kimi:free" }));
});

test("it needs both plan and build", () => {
  assert.equal(isComplete({ plan: "a/b" }), false);
  assert.equal(isComplete({ plan: "a/b", build: "a/c" }), true);
});

test("saved settings load again, a missing file is empty, and a broken one throws", () => {
  const agent = dir();
  assert.deepEqual(loadConfig(agent), {});
  saveConfig(agent, { plan: "a/b" });
  assert.deepEqual(loadConfig(agent), { plan: "a/b" });
  writeFileSync(join(agent, "suite.json"), "{oops");
  assert.throws(() => loadConfig(agent));
});

function judgeHome(content: string): { agent: string; file: string } {
  const agent = dir();
  const folder = join(agent, "extensions", "pi-permission-classifier");
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "config.json");
  writeFileSync(file, content);
  return { agent, file };
}

test("the judge's model is written into its own settings, and nothing else changes", () => {
  const { agent, file } = judgeHome(JSON.stringify({ verdicts: ["allow"], onError: "defer" }));
  assert.equal(judgeModel(agent), null);
  setJudgeModel(agent, "cf/workers-ai/@cf/kimi");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { verdicts: ["allow"], onError: "defer", provider: "cf", model: "workers-ai/@cf/kimi" });
  assert.equal(judgeModel(agent), "cf/workers-ai/@cf/kimi");
  setJudgeModel(agent, undefined);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { verdicts: ["allow"], onError: "defer" });
});

test("a judge that isn't set up, or has broken settings, is left alone", () => {
  assert.equal(judgeModel(dir()), undefined);
  assert.throws(() => setJudgeModel(dir(), "a/b"));
  const { agent, file } = judgeHome("{oops");
  assert.throws(() => setJudgeModel(agent, "a/b"));
  assert.equal(readFileSync(file, "utf8"), "{oops");
});

test("reasoning per role must name a role and a level", () => {
  assert.deepEqual(parseConfig({ plan: "a/b", thinking: { plan: "high" } }).thinking, { plan: "high" });
  assert.throws(() => parseConfig({ thinking: { judge: "high" } }), /unknown role/);
  assert.throws(() => parseConfig({ thinking: { plan: "huge" } }), /must be one of/);
  assert.throws(() => parseConfig({ thinking: "high" }), /must be an object/);
});
