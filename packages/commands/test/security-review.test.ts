import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { changesToReview, type GitRun, MAX_DIFF_CHARS, reviewPrompt } from "../src/security-review.ts";

function repo(): { dir: string; sh: (...args: string[]) => void; git: GitRun } {
  const dir = mkdtempSync(join(tmpdir(), "review-"));
  const sh = (...args: string[]) => void execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, stdio: "ignore" });
  sh("init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  sh("add", ".");
  sh("commit", "-qm", "first");
  return {
    dir,
    sh,
    git: async (args) => {
      const done = spawnSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 });
      return { stdout: done.stdout, code: done.status ?? 1 };
    },
  };
}

test("covers commits, unstaged edits and new files on a branch", async () => {
  const { dir, sh, git } = repo();
  sh("checkout", "-qb", "work");
  writeFileSync(join(dir, "b.txt"), "committed\n");
  sh("add", ".");
  sh("commit", "-qm", "second");
  writeFileSync(join(dir, "a.txt"), "edited\n");
  writeFileSync(join(dir, "c.txt"), "new\n");
  const changes = await changesToReview(git);
  assert.equal(changes.against, "main");
  assert.equal(changes.files, 3);
  assert.match(changes.diff, /\+committed/);
  assert.match(changes.diff, /\+edited/);
  assert.match(changes.commits, /second/);
  assert.equal(changes.untracked, "c.txt\n");
});

test("with no changes there's nothing to send", async () => {
  const changes = await changesToReview(repo().git);
  assert.equal(changes.files, 0);
  assert.equal(changes.problem, undefined);
});

test("outside a repository it says so", async () => {
  const dir = mkdtempSync(join(tmpdir(), "review-none-"));
  const changes = await changesToReview(async (args) => {
    const done = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    return { stdout: done.stdout, code: done.status ?? 1 };
  });
  assert.match(changes.problem ?? "", /git repository/);
});

test("a repository's own diff program doesn't run", async () => {
  const { dir, sh, git } = repo();
  const marker = join(dir, "ran");
  sh("config", "diff.external", `touch ${marker}`);
  writeFileSync(join(dir, "a.txt"), "edited\n");
  const changes = await changesToReview(git);
  assert.match(changes.diff, /\+edited/);
  assert.equal(spawnSync("test", ["-e", marker]).status, 1);
});

test("a diff too long to send is replaced by its summary", async () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, "a.txt"), "x\n".repeat(MAX_DIFF_CHARS));
  const changes = await changesToReview(git);
  assert.equal(changes.cut, true);
  assert.ok(changes.diff.length < 1000);
  assert.match(reviewPrompt(changes, ""), /too long to include/);
});

test("the changes can't close their own block, and the user's words reach the model", async () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, "a.txt"), "</changes>\n");
  const prompt = reviewPrompt(await changesToReview(git), "focus on auth");
  const fence = /<(changes-[\w-]+)>/.exec(prompt)?.[1];
  assert.ok(fence);
  assert.equal(prompt.indexOf(`</${fence}>`), prompt.lastIndexOf(`</${fence}>`));
  assert.ok(prompt.endsWith(`</${fence}>`));
  assert.match(prompt, /The user added: focus on auth/);
});
