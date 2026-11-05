import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRules, applySandbox, refuseBash, refuseDomain, refuseSandboxPath, refuseTool, withBashAllows } from "../src/review/apply.mjs";
import { collect, collectJudge, collectSandbox, ranCommands, ruleFor, sandboxBlocks, suggestPattern } from "../src/review/collect.mjs";

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

const done = (id, isError = false) => ({ type: "message", message: { role: "toolResult", toolCallId: id, isError } });
const call = (id, command) => ({ type: "message", timestamp: "2026-11-03T10:00:00Z", message: { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command } }] } });

test("history: commands that ran, without blocked calls or anything from yolo", () => {
  const ran = ranCommands([
    call("a", "npm test"),
    done("a"),
    call("b", "rm x"),
    done("b", true),
    { type: "custom", customType: "pi-modes", data: { mode: "yolo" } },
    call("c", "touch yolo"),
    done("c"),
    { type: "custom", customType: "pi-modes", data: { mode: "normal" } },
    call("a", "make"),
    done("a"),
    call("e", "never finished"),
  ]);
  assert.deepEqual(ran.map((r) => r.command), ["npm test", "make"]);
});

test("history counts apart from approvals, and rules and secrets still filter it", () => {
  const history = [{ command: "npm test", timestamp: "t" }, { command: "git diff", timestamp: "t" }, { command: "x --token=y", timestamp: "t" }];
  const { candidates } = collect([approved("npm test")], { bash: { "git diff*": "allow" } }, history);
  assert.deepEqual(candidates.map((c) => [c.pattern, c.approvals, c.ran]), [["npm test*", 1, 1]]);
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

const blocked = (text, timestamp = "2026-11-03T10:00:00Z") => ({ type: "message", timestamp, message: { role: "toolResult", content: [{ type: "text", text }] } });

test("sandbox blocks group by what would be allowed, without what someone denied or allows now", () => {
  const blocks = sandboxBlocks([
    blocked('Sandbox: read access denied for "/work/other"'),
    blocked('Sandbox: read access denied for "/work/other"', "2026-11-04T10:00:00Z"),
    blocked('Sandbox: write access denied for "/out" (not in allowWrite)'),
    blocked('Sandbox: write access denied for ".env" (in denyWrite). To change this, edit denyWrite in:\n  x'),
    blocked('Network access to "pkg.example.com" is blocked (not in allowedDomains).'),
    blocked('Network access to "old.example.com" is blocked (not in allowedDomains).'),
    blocked('Sandbox: read access denied for "/home/me/token"'),
    { type: "message", message: { role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: "touch: /out/x: Operation not permitted\n\nCommand exited with code 1" }] } },
    blocked("this file mentions Operation not permitted"),
    blocked('some file said Sandbox: read access denied for "/x"'),
  ]);
  const { candidates, osBlocks, osExamples, skipped } = collectSandbox(blocks, { network: { allowedDomains: ["old.example.com"] } });
  assert.deepEqual(candidates.map((c) => [c.kind, c.value, c.blocks, c.days]), [["read", "/work/other", 2, 2], ["write", "/out", 1, 1], ["domain", "pkg.example.com", 1, 1]]);
  assert.deepEqual([osBlocks, osExamples, skipped], [1, ["touch: /out/x: Operation not permitted"], 1]);
});

const refusedPaths = [["read", "/"], ["read", "~"], ["read", "/Users"], ["read", "/h/me", "/h/me"], ["read", "/h/*"], ["read", "../up"], ["read", "~/.ssh"], ["read", "~/.ssh/id_rsa"], ["read", "~/.aws/credentials"], ["read", "~/.pi/agent"], ["read", "/p/.env.local"], ["read", "/p/server.pem"], ["write", "/p/.git/hooks"], ["write", "~/.zshrc"], ["write", "~/Library/LaunchAgents"]];
for (const [kind, path, home] of refusedPaths) test(`refuses ${kind} on ${path}`, () => assert.ok(refuseSandboxPath(kind, path, home)));

test("allows an ordinary folder, and a hook folder only for reading", () => {
  assert.equal(refuseSandboxPath("read", "~/work/other"), undefined);
  assert.equal(refuseSandboxPath("write", "/tmp/build"), undefined);
  assert.equal(refuseSandboxPath("read", "/p/.git/hooks"), undefined);
});

test("domains must be single domains", () => {
  for (const bad of ["*", "*.com", "com", "a b.com", "https://x.com"]) assert.ok(refuseDomain(bad), bad);
  for (const good of ["pkg.example.com", "*.example.com"]) assert.equal(refuseDomain(good), undefined);
});

test("a new sandbox list keeps the defaults, and only what was chosen changes", () => {
  const { config } = applySandbox({ filesystem: { denyWrite: [".env"], allowWrite: ["."] } }, { read: ["~/work"], domains: ["pkg.example.com"] });
  assert.ok(config.filesystem.allowRead.includes(".") && config.filesystem.allowRead.includes("~/work"));
  assert.deepEqual(config.filesystem.allowWrite, ["."]);
  assert.deepEqual(config.filesystem.denyWrite, [".env"]);
  assert.ok(config.network.allowedDomains.includes("github.com") && config.network.allowedDomains.includes("pkg.example.com"));
});

test("one refused sandbox choice stops all of them", () => {
  const { config, refusals } = applySandbox({}, { read: ["~/work", "~/.ssh"] });
  assert.equal(config, undefined);
  assert.equal(refusals.length, 1);
});

test("the judge's decisions say why it deferred, and what a person then approved", () => {
  const decision = (requestId, verdict, deferReason, surface = "bash", value = "npm test -- x") =>
    ({ event: "classifier.decision", timestamp: "2026-11-04T10:00:00Z", requestId, verdict, deferReason, surface, value });
  const judge = collectJudge([
    decision("a", "allow"),
    decision("b", "defer", "timeout"),
    decision("c", "defer", "timeout", "edit", "src/a.go"),
    decision("d", "defer", "deny-capped", "bash", "curl -H token=abc"),
    { requestId: "b", resolution: "approved", decidedBy: { kind: "user" } },
    { requestId: "c", resolution: "denied", decidedBy: { kind: "user" } },
    { requestId: "d", resolution: "approved", decidedBy: { kind: "user" } },
    { requestId: "a", resolution: "approved", decidedBy: { kind: "authorizer", name: "permission-judge" } },
  ]);
  assert.equal(judge.decisions, 4);
  assert.deepEqual([judge.allow, judge.deny, judge.defer], [1, 0, 3]);
  assert.deepEqual(judge.deferReasons[0], { reason: "timeout", count: 2, surfaces: ["bash", "edit"], last: "2026-11-04T10:00:00Z" });
  assert.deepEqual(judge.deferredThenApproved.map((group) => [group.surface, group.pattern, group.reason]), [["bash", "npm test*", "timeout"], ["bash", undefined, "deny-capped"]]);
});

test("the judge's project edits aren't approvals worth a rule", () => {
  const { candidates } = collect([{ resolution: "approved", surface: "edit", decidedBy: { kind: "authorizer", name: "permission-judge" } }]);
  assert.deepEqual(candidates, []);
});

test("cd gets a rule that can't match cdk, and it's allowed", () => {
  assert.equal(suggestPattern("cd /some/where"), "cd *");
  assert.equal(suggestPattern("cdk deploy"), "cdk deploy*");
  assert.equal(refuseBash("cd *"), undefined);
});
