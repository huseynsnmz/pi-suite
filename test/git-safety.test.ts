import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { classifyBash } from "../src/bash.ts";
import { gitRisk, riskyRepoKey } from "../src/git-safety.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

function repo(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "pm-git-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", "git@github.com:a/b.git");
  git(dir, "config", "user.name", "a");
  return dir;
}

test("an ordinary repository is safe, as is a folder that isn't one", async (t) => {
  assert.equal(await gitRisk(repo(t)), undefined);
  const plain = mkdtempSync(join(tmpdir(), "pm-git-"));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  assert.equal(await gitRisk(plain), undefined);
});

for (const [key, value] of [
  ["core.fsmonitor", "touch x"],
  ["diff.external", "touch x"],
  ["diff.x.textconv", "touch x"],
  ["diff.x.command", "touch x"],
  ["filter.y.clean", "touch x"],
  ["core.pager", "touch x"],
  ["core.sshCommand", "touch x"],
  ["remote.origin.promisor", "true"],
  ["extensions.partialClone", "origin"],
  ["include.path", "/x"],
  ["alias.st", "!touch x"],
  ["merge.x.driver", "touch x"],
] as const) {
  test(`refuses a repository that sets ${key}`, async (t) => {
    const dir = repo(t);
    git(dir, "config", key, value);
    assert.match((await gitRisk(dir)) ?? "", /sets /);
  });
}

test("a setting pulled in through include is seen by its own name", async (t) => {
  const dir = repo(t);
  writeFileSync(join(dir, "inc"), '[core]\n\tfsmonitor = "touch x"\n');
  git(dir, "config", "include.path", join(dir, "inc"));
  const scoped = git(dir, "config", "--show-scope", "--name-only", "--list", "-z");
  assert.ok(scoped.includes("core.fsmonitor"));
});

test("a hook that reads can fire is refused, in hooksPath too, and husky's kind aren't", async (t) => {
  const husky = repo(t);
  mkdirSync(join(husky, ".husky"));
  writeFileSync(join(husky, ".husky/pre-commit"), "#!/bin/sh\n");
  git(husky, "config", "core.hooksPath", ".husky");
  assert.equal(await gitRisk(husky), undefined);
  writeFileSync(join(husky, ".husky/post-index-change"), "#!/bin/sh\n");
  assert.match((await gitRisk(husky)) ?? "", /post-index-change/);

  const dir = repo(t);
  writeFileSync(join(dir, ".git/hooks/commit-msg.sample"), "");
  writeFileSync(join(dir, ".git/hooks/pre-commit"), "#!/bin/sh\n");
  assert.equal(await gitRisk(dir), undefined);
  writeFileSync(join(dir, ".git/hooks/post-index-change"), "#!/bin/sh\n");
  chmodSync(join(dir, ".git/hooks/post-index-change"), 0o755);
  assert.match((await gitRisk(dir)) ?? "", /post-index-change/);
});

test("a bare repository committed in a clone is seen from inside it", async (t) => {
  const outer = repo(t);
  const inner = join(outer, "vendor/x");
  mkdirSync(join(inner, "objects"), { recursive: true });
  mkdirSync(join(inner, "refs/heads"), { recursive: true });
  writeFileSync(join(inner, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(inner, "config"), '[core]\n\trepositoryformatversion = 0\n\tfsmonitor = "touch x"\n\tbare = false\n\tworktree = .\n');
  assert.match((await gitRisk(inner)) ?? "", /sets core\.(?:fsmonitor|worktree)/);
  assert.equal(await gitRisk(outer), undefined);
});

test("only this repository's settings count, not the user's own", () => {
  assert.equal(riskyRepoKey("global\0core.fsmonitor\0system\0diff.external\0unknown\0credential.helper\0"), undefined);
  assert.equal(riskyRepoKey("local\0core.bare\0local\0remote.origin.url\0worktree\0core.fsmonitor\0"), "core.fsmonitor");
});

test("git after cd isn't read-only, since that folder can't be checked", () => {
  assert.equal(classifyBash("cd vendor/x && git status").readOnly, false);
  assert.equal(classifyBash("cd src && ls").readOnly, true);
});
