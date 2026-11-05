import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addCdRules, cdRules, isInside, planCommand } from "../src/workdir.ts";

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
  assert.deepEqual(Object.entries(asking.read()), [["*", "ask"], ["cd /work/app", "allow"], ["cd /work/app/*", "allow"], ["rm *", "deny"]]);
  assert.deepEqual(cdRules("/work/app"), ["cd /work/app", "cd /work/app/*"]);

  for (const choice of [{ "*": "ask", "cd *": "deny" }, { "*": "allow" }, { "*": "ask", "cd *": "allow" }, "allow"]) {
    const own = write(choice);
    const result = addCdRules(own.agent, "/work/app");
    assert.equal(result.notice, undefined);
    assert.equal(result.handled, true);
    assert.deepEqual(own.read(), choice);
  }
  const unusual = write({ "*": "ask" });
  assert.deepEqual(addCdRules(unusual.agent, "/work/a;b"), { handled: true });
  assert.deepEqual(unusual.read(), { "*": "ask" });
  assert.equal(addCdRules(asking.agent, "/").handled, false, "the whole disk isn't a project");
  const none = mkdtempSync(join(tmpdir(), "agent-"));
  assert.deepEqual(addCdRules(none, "/work/app"), { handled: false });
  assert.equal(existsSync(join(none, "extensions")), false);
});
