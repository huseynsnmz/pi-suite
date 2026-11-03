import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRules, refuseBash, refuseTool, withBashAllows } from "../skills/review-permissions/scripts/apply.mjs";
import { collect, ruleFor, suggestPattern } from "../skills/review-permissions/scripts/collect.mjs";

const approved = (command, extra = {}) => ({ event: "permission_request.approved", resolution: "approved", decidedBy: { kind: "user", via: "dialog" }, surface: "bash", command, timestamp: "2026-11-03T10:00:00Z", ...extra });

test("approvals group by a suggested pattern", () => {
  const { candidates } = collect([approved("npm test"), approved("npm test -- x", { timestamp: "2026-11-04T10:00:00Z" }), approved("make")]);
  assert.deepEqual(candidates.map((c) => [c.pattern, c.approvals, c.days]), [["npm test*", 2, 2], ["make*", 1, 1]]);
});

const ignored = [
  ["denials", approved("ls", { resolution: "denied" })],
  ["what is still waiting", approved("ls", { resolution: null })],
  ["rule allows", approved("ls", { decidedBy: { kind: "rule" } })],
  ["yolo's own approvals", approved("rm x", { decidedBy: { kind: "authorizer", name: "pi-modes", verdict: "allow" } })],
  ["already allowed", approved("git status --short")],
];
for (const [name, entry] of ignored) {
  test(`leaves out ${name}`, () => {
    const { candidates } = collect([entry], { bash: { "*": "ask", "git status*": "allow" } });
    assert.equal(candidates.length, 0);
  });
}

const skippedCases = [
  ["a token in the command", approved("curl -H 'Authorization: x' a")],
  ["a long opaque value", approved(`deploy ${"a".repeat(40)}`)],
  ["a hidden command", approved("bash -c x", { matchedPattern: "<opaque-bash-wrapper>" })],
  ["access outside the project", approved(undefined, { surface: "external_directory", path: "/etc" })],
];
for (const [name, entry] of skippedCases) {
  test(`counts but won't suggest ${name}`, () => {
    const { candidates, skipped } = collect([entry]);
    assert.deepEqual([candidates.length, skipped], [0, 1]);
  });
}

test("a judge's approvals and session grants count", () => {
  const { candidates } = collect([
    approved("npm test", { decidedBy: { kind: "authorizer", name: "permission-judge" } }),
    approved("npm test", { resolution: "session_approved", decidedBy: { kind: "session_approval" } }),
  ]);
  assert.equal(candidates[0].approvals, 2);
});

test("a pattern stops at the subcommand", () => {
  assert.equal(suggestPattern("git diff --stat"), "git diff*");
  assert.equal(suggestPattern("make"), "make*");
  assert.equal(suggestPattern("ls -la"), "ls*");
});

const refused = ["make*", "*", "npm *", "git*", "bash foo*", "python3 x.py*", "npx tsc*", "sudo ls*", "rm x*", "git push*", "gh pr merge*", "npm publish*", "curl a*", "npm test && rm*", "echo $(x)*"];
for (const pattern of refused) {
  test(`refuses ${pattern}`, () => assert.ok(refuseBash(pattern)));
}

for (const pattern of ["ls*", "ls *", "npm test*", "git diff*", "make build*", "go test ./..."]) {
  test(`accepts ${pattern}`, () => assert.equal(refuseBash(pattern), undefined));
}

test("tools: only readers, and never a whole surface", () => {
  assert.equal(refuseTool("grep"), undefined);
  for (const tool of ["bash", "external_directory", "*", "write", "edit", "subagent"]) assert.ok(refuseTool(tool));
});

test("a new allow can't override an existing deny or ask", () => {
  const rules = withBashAllows({ "*": "ask", "git push --force*": "deny", "git commit --amend*": "ask" }, ["git commit*"]);
  assert.deepEqual(Object.keys(rules), ["*", "git commit*", "git push --force*", "git commit --amend*"]);
  assert.equal(ruleFor(rules, "git commit --amend"), "ask");
  assert.equal(ruleFor(rules, "git commit -m x"), "allow");
});

test("existing rules keep their state", () => {
  assert.equal(withBashAllows({ "*": "ask", "npm test*": "deny" }, ["npm test*"])["npm test*"], "deny");
});

test("one bad rule changes nothing", () => {
  const result = applyRules({ permission: {} }, { bash: ["npm test*", "rm x*"] });
  assert.equal(result.config, undefined);
  assert.equal(result.refusals.length, 1);
});

test("a deny on a tool stays", () => {
  const { config } = applyRules({ permission: { grep: "deny", other: 1 }, authorizerChain: ["x"] }, { tools: ["grep", "find"] });
  assert.deepEqual(config, { permission: { grep: "deny", find: "allow", other: 1 }, authorizerChain: ["x"] });
});
