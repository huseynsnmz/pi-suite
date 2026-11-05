import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ruleFor } from "../src/review/collect.mjs";
import { addCdGuards, addCdRules, cdGuards, cdRules, isInside, planCommand, realCds, savedFolder } from "../src/workdir.ts";

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cd-")));
  mkdirSync(join(root, "sub/deep"), { recursive: true });
  return root;
}

test("a leading cd becomes absolute and is a move, and everything else stays where bash is", () => {
  const root = project();
  const sub = join(root, "sub");
  const deep = join(sub, "deep");
  const cases: [string, string | undefined, string, string, string | undefined][] = [
    ["no move yet", undefined, "go test", "go test", undefined],
    ["a command after a move", sub, "go test", `cd ${sub} && go test`, undefined],
    ["cd with a command", undefined, "cd sub && go test", `cd ${sub} && go test`, sub],
    ["cd alone", undefined, "cd sub", `cd ${sub}`, sub],
    ["a semicolon", undefined, "cd sub; ls", `cd ${sub}; ls`, sub],
    ["quotes", undefined, `cd "sub" && ls`, `cd ${sub} && ls`, sub],
    ["relative from here", sub, "cd deep && ls", `cd ${deep} && ls`, deep],
    ["up from here", deep, "cd .. && ls", `cd ${sub} && ls`, sub],
    ["the same move repeated from the top", sub, "cd sub && ls", `cd ${sub} && ls`, sub],
    ["the same move repeated from one up", deep, "cd deep && ls", `cd ${deep} && ls`, deep],
    ["an absolute path", deep, `cd ${root} && ls`, `cd ${root} && ls`, root],
    ["a folder that isn't there fails in the shell", sub, "cd nope && ls", `cd ${sub} && cd nope && ls`, undefined],
    ["cd - can't be followed", sub, "cd - && ls", `cd ${sub} && cd - && ls`, undefined],
    ["a variable can't be followed", undefined, 'cd "$DIR" && ls', 'cd "$DIR" && ls', undefined],
    ["|| doesn't always move", undefined, "cd sub || ls", "cd sub || ls", undefined],
    ["a name that starts with cd", undefined, "cdk deploy", "cdk deploy", undefined],
  ];
  for (const [name, here, command, want, move] of cases) {
    const plan = planCommand(root, here, command);
    assert.equal(plan.command, want, name);
    assert.equal(plan.move, move, name);
  }
});

test("a cd that would fail stays a failure, rather than going somewhere else", () => {
  const root = project();
  const sub = join(root, "sub");
  mkdirSync(join(root, "build"));
  const parent = join(root, "..", `sibling-${root.split("/").pop()}`);
  mkdirSync(parent);
  const name = parent.split("/").pop();
  assert.deepEqual(planCommand(root, sub, "cd build && rm -rf *"), { command: `cd ${sub} && cd build && rm -rf *` });
  assert.deepEqual(planCommand(root, undefined, `cd ${name} && rm -rf *`), { command: `cd ${name} && rm -rf *` });
  assert.deepEqual(planCommand(root, sub, `cd ${name} && rm -rf *`), { command: `cd ${sub} && cd ${name} && rm -rf *` });
  assert.equal(execFileSync("/bin/bash", ["-c", `${planCommand(root, sub, "cd build && echo ran").command} || echo stopped`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), "stopped");
});

test("a cd later in a chain is written as where it really goes, so the project's rule can't vouch for a way out", () => {
  const root = project();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "out-")));
  symlinkSync(outside, join(root, "out"));
  const cases: [string, string, string][] = [
    ["a link out", `ls && cd ${root}/out && touch new`, `ls && cd ${outside} && touch new`],
    ["a link out, in a subshell", `(cd ${root}/out; touch new)`, `(cd ${outside}; touch new)`],
    ["a link out, in a branch", `if true; then cd ${root}/out; fi`, `if true; then cd ${outside}; fi`],
    ["up and out", `ls; cd ${root}/../x && touch new`, `ls; cd ${join(root, "../x")} && touch new`],
    ["quoted", `ls && cd "${root}/out" && touch new`, `ls && cd ${outside} && touch new`],
    ["a real folder stays as written", `ls && cd ${root}/sub && touch new`, `ls && cd ${root}/sub && touch new`],
    ["not the project's", `ls && cd /tmp/../etc && ls`, `ls && cd /tmp/../etc && ls`],
    ["text that isn't a cd", `echo cd ${root}/out`, `echo cd ${root}/out`],
  ];
  for (const [name, command, want] of cases) assert.equal(realCds(root, command), want, name);
  assert.equal(planCommand(root, undefined, `cd sub && cd ${root}/out && touch new`).command, `cd ${root}/sub && cd ${outside} && touch new`);
  const rules = Object.fromEntries([["*", "ask"], ...cdRules(root).map((rule) => [rule, "allow"]), ...cdGuards(root).map((rule) => [rule, "ask"])]);
  assert.equal(ruleFor(rules, realCds(root, `cd ${root}/out`)), "ask");
});

test("the folder comes back with the session, while it's still true", () => {
  const root = project();
  const sub = join(root, "sub");
  const saved = (folder: unknown) => ({ type: "custom", customType: "pi-modes-workdir", data: { folder } });
  const other = { type: "custom", customType: "other", data: { folder: "/x" } };
  assert.equal(savedFolder(root, []), undefined);
  assert.equal(savedFolder(root, [saved(sub), other]), sub);
  assert.equal(savedFolder(root, [saved(sub), saved(null)]), undefined, "it moved back");
  assert.equal(savedFolder(root, [saved(join(root, "gone"))]), undefined);
  assert.equal(savedFolder(root, [saved(tmpdir())]), undefined, "another project");
});

test("a folder with a quote still works in real bash", () => {
  const root = project();
  const dir = join(root, "it's here");
  mkdirSync(dir);
  assert.equal(execFileSync("/bin/bash", ["-c", planCommand(root, dir, "pwd").command], { encoding: "utf8" }).trim(), dir);
});

test("inside means the project or below", () => {
  assert.equal(isInside("/a/b", "/a/b"), true);
  assert.equal(isInside("/a/b", "/a/b/c"), true);
  assert.equal(isInside("/a/b", "/a/bc"), false);
  assert.equal(isInside("/a/b", "/a"), false);
});

/** A cd as planCommand writes a folder that needs quotes. */
const planCommandText = (folder: string) => `cd '${folder}'`;

test("with no bash rules, bash follows the catch-all, and that's kept", () => {
  const write = (permission: unknown) => {
    const agent = mkdtempSync(join(tmpdir(), "agent-"));
    const dir = join(agent, "extensions/pi-permission-system");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ authorizerChain: [], ...(permission === undefined ? {} : { permission }) }));
    return { agent, read: () => JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).permission };
  };
  for (const catchAll of ["allow", "deny"]) {
    const own = write({ "*": catchAll });
    assert.deepEqual(addCdRules(own.agent, "/work/app"), { handled: true }, catchAll);
    assert.deepEqual(own.read(), { "*": catchAll }, catchAll);
  }
  for (const permission of [{ "*": "ask" }, {}, undefined]) {
    const own = write(permission);
    assert.match(addCdRules(own.agent, "/work/app").notice ?? "", /a cd anywhere else/);
    assert.equal(ruleFor(own.read().bash, "git push"), "ask");
    assert.equal(ruleFor(own.read().bash, "cd /work/app/x"), "allow");
  }
});

test("rules from before the guards get them, and removed rules stay removed", () => {
  const write = (bash: unknown) => {
    const agent = mkdtempSync(join(tmpdir(), "agent-"));
    const dir = join(agent, "extensions/pi-permission-system");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ permission: { bash } }));
    return { agent, read: () => JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).permission.bash };
  };
  const old = write({ "*": "ask", "cd /work/app": "allow", "cd /work/app/*": "allow", "rm *": "deny" });
  addCdGuards(old.agent, "/work/app");
  assert.equal(ruleFor(old.read(), "cd /work/app/../x"), "ask");
  assert.equal(ruleFor(old.read(), "cd /work/app/x"), "allow");
  assert.equal(Object.keys(old.read()).at(-1), "rm *");
  const removed = write({ "*": "ask" });
  addCdGuards(removed.agent, "/work/app");
  assert.deepEqual(removed.read(), { "*": "ask" });
  const fresh = write({ "*": "ask" });
  addCdRules(fresh.agent, "/work/app");
  const before = fresh.read();
  addCdGuards(fresh.agent, "/work/app");
  assert.deepEqual(fresh.read(), before);
});

test("cd is allowed for this project only, with a backup, and never over a choice you made", () => {
  const write = (bash: unknown) => {
    const agent = mkdtempSync(join(tmpdir(), "agent-"));
    const dir = join(agent, "extensions/pi-permission-system");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ permission: { bash } }));
    return { agent, read: () => JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).permission.bash };
  };
  const asking = write({ "*": "ask", "rm *": "deny" });
  const added = addCdRules(asking.agent, "/work/app");
  assert.equal(added.handled, true);
  assert.match(added.notice ?? "", /a cd anywhere else/);
  assert.deepEqual(Object.entries(asking.read()), [["*", "ask"], ["cd /work/app", "allow"], ["cd /work/app/*", "allow"], ["cd /work/app/*..*", "ask"], ["cd /work/app/*$*", "ask"], ["cd /work/app/*`*", "ask"], ["cd /work/app/*\\*", "ask"], ["rm *", "deny"]]);
  assert.deepEqual(cdRules("/work/app"), ["cd /work/app", "cd /work/app/*"]);
  const rules = asking.read();
  for (const way of ["/work/app/../../etc", "/work/app/$(echo ../..)", "/work/app/$X", "/work/app/`x`", "/work/app/\\.\\./x"]) assert.equal(ruleFor(rules, `cd ${way}`), "ask", way);
  assert.equal(ruleFor(rules, "cd /work/app/sub"), "allow");

  for (const choice of [{ "*": "ask", "cd *": "deny" }, { "*": "allow" }, { "*": "ask", "cd *": "allow" }, "allow"]) {
    const own = write(choice);
    const result = addCdRules(own.agent, "/work/app");
    assert.equal(result.notice, undefined);
    assert.equal(result.handled, true);
    assert.deepEqual(own.read(), choice);
  }
  const spaced = write({ "*": "ask" });
  addCdRules(spaced.agent, "/work/my app");
  assert.equal(ruleFor(spaced.read(), planCommandText("/work/my app/sub")), "allow", "a folder with a space, as it's sent");
  assert.equal(ruleFor(spaced.read(), planCommandText("/work/my app")), "allow");
  assert.equal(ruleFor(spaced.read(), planCommandText("/work/my app/../x")), "ask");
  const unusual = write({ "*": "ask" });
  assert.deepEqual(addCdRules(unusual.agent, "/work/a;b"), { handled: true });
  assert.deepEqual(unusual.read(), { "*": "ask" });
  assert.equal(addCdRules(asking.agent, "/").handled, false, "the whole disk isn't a project");
  const none = mkdtempSync(join(tmpdir(), "agent-"));
  assert.deepEqual(addCdRules(none, "/work/app"), { handled: false });
  assert.equal(existsSync(join(none, "extensions")), false);
});
