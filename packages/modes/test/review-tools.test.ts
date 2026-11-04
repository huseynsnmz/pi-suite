import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { refuseBash } from "../src/review/apply.mjs";
import { describeChoices, registerReviewTools } from "../src/review/tools.ts";

type Tool = { name: string; execute: (id: string, params: unknown, signal: undefined, update: undefined, ctx: unknown) => Promise<{ content: { text: string }[] }> };

function setup(t: TestContext) {
  const agent = mkdtempSync(join(tmpdir(), "pm-review-"));
  t.after(() => rmSync(agent, { recursive: true, force: true }));
  const config = join(agent, "extensions/pi-permission-system/config.json");
  mkdirSync(join(config, ".."), { recursive: true });
  writeFileSync(config, JSON.stringify({ permission: { bash: { "*": "ask", "rm*": "deny" } } }));
  const tools = new Map<string, Tool>();
  registerReviewTools({ registerTool: (tool: Tool) => tools.set(tool.name, tool) } as never, () => agent);
  const apply = async (params: unknown, ctx: unknown) => (await tools.get("permissions_apply")!.execute("1", params, undefined, undefined, ctx)).content[0]!.text;
  const rules = () => Object.keys(JSON.parse(readFileSync(config, "utf8")).permission.bash);
  return { agent, tools, apply, rules };
}

const answering = (answer: boolean, asked: string[] = []) => ({
  hasUI: true,
  ui: { confirm: async (_title: string, body: string) => (asked.push(body), answer) },
});

test("a rule is only written once the person agrees, after seeing it", async (t) => {
  const { apply, rules } = setup(t);
  const asked: string[] = [];
  assert.match(await apply({ bash: ["npm test*"] }, answering(false, asked)), /declined/);
  assert.deepEqual(rules(), ["*", "rm*"]);
  assert.match(asked[0] ?? "", /Allow command: npm test\*/);
  await apply({ bash: ["npm test*"] }, answering(true));
  assert.deepEqual(rules(), ["*", "npm test*", "rm*"], "a deny after it keeps winning");
});

test("with nobody to ask, nothing is written", async (t) => {
  const { apply, rules } = setup(t);
  assert.match(await apply({ bash: ["npm test*"] }, { hasUI: false }), /Nobody/);
  assert.deepEqual(rules(), ["*", "rm*"]);
});

for (const [name, params] of [
  ["a rule that runs anything", { bash: ["bash *"] }],
  ["a program runner hidden in a reader", { bash: ["rg *"] }],
  ["a surface that needs doing by hand", { tools: ["bash"] }],
  ["a credentials folder", { read: ["~/.ssh"] }],
] as const) {
  test(`${name} is refused without asking`, async (t) => {
    const { apply, rules } = setup(t);
    const asked: string[] = [];
    assert.match(await apply(params, answering(true, asked)), /Nothing was changed/);
    assert.deepEqual(asked, []);
    assert.deepEqual(rules(), ["*", "rm*"]);
  });
}

test("a mix with one refusal adds nothing", async (t) => {
  const { apply, rules, agent } = setup(t);
  await apply({ bash: ["npm test*"], read: ["~/.ssh"] }, answering(true));
  assert.deepEqual(rules(), ["*", "rm*"]);
  assert.equal(existsSync(join(agent, "sandbox.json")), false);
});

test("what's shown can't hide or reorder characters", () => {
  assert.equal(describeChoices({ bash: ["ls‮ x"] }), "Allow command: ls\\u202e x");
});

test("readers that can run or write something need a narrower rule", () => {
  for (const pattern of ["rg*", "rg *", "file *", "date *"]) assert.ok(refuseBash(pattern), pattern);
  assert.equal(refuseBash("grep *"), undefined);
});

test("the review reads sessions from the board too, and a long list is cut", async (t) => {
  const { tools, agent } = setup(t);
  const dir = join(agent, "agent-board/sessions");
  mkdirSync(dir, { recursive: true });
  const toolCall = (i: number) =>
    [
      { role: "assistant", content: [{ type: "toolCall", id: `c${i}`, name: "bash", arguments: { command: `tool${i} x` } }] },
      { role: "toolResult", toolCallId: `c${i}`, content: [] },
    ].map((message) => `${JSON.stringify({ type: "message", message })}\n`).join("");
  writeFileSync(join(dir, "a.jsonl"), Array.from({ length: 70 }, (_, i) => toolCall(i)).join(""));
  const data = JSON.parse((await tools.get("permissions_review")!.execute("1", {}, undefined, undefined, {})).content[0]!.text);
  assert.equal(data.candidates.length, 60);
  assert.equal(data.more, 10);
});
