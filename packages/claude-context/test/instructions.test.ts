import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { claudeInstructions, importsIn, isClaude, notLoaded } from "../src/instructions.ts";

function home(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "claude-context-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const names = (dir: string) => claudeInstructions(dir).map((file) => file.path.slice(dir.length + 1));

test("finds Claude however it's served, and nothing else", () => {
  const cases: [string, string, boolean][] = [
    ["anthropic", "claude-opus-5-5", true],
    ["claude-sdk", "claude-sonnet-5-5", true],
    ["amazon-bedrock", "us.anthropic.claude-haiku-5-5", true],
    ["openai", "gpt-5.6-luna", false],
    ["router", "auto", false],
  ];
  for (const [provider, id, want] of cases) assert.equal(isClaude({ provider, id }), want, `${provider}/${id}`);
  assert.equal(isClaude(undefined), false);
});

test("reads imports from prose only, without trailing punctuation", () => {
  const text = "Follow @rules and @rules/go.md.\n`@types/node` is code\n```\n@inside/fence.md\n```\nmail me@host.com\n@~/x.md";
  assert.deepEqual(importsIn(text), ["rules", "rules/go.md", "~/x.md"]);
});

test("loads CLAUDE.md, then its imports in order, then rules, each once", () => {
  const dir = home({
    ".claude/CLAUDE.md": "See @rules and @rules/b.md. Also @notes.md and @missing.md",
    ".claude/notes.md": "Back to @CLAUDE.md",
    ".claude/rules/b.md": "b",
    ".claude/rules/a.md": "a",
    ".claude/rules/sub/c.md": "c",
    ".claude/rules/skip.txt": "not markdown",
  });
  assert.deepEqual(names(dir), [".claude/CLAUDE.md", ".claude/rules/a.md", ".claude/rules/b.md", ".claude/rules/sub/c.md", ".claude/notes.md"]);
});

test("leaves out rules that apply only to some paths", () => {
  const dir = home({ ".claude/rules/always.md": "x", ".claude/rules/ts.md": "---\npaths:\n  - \"**/*.ts\"\n---\nts only" });
  assert.deepEqual(names(dir), [".claude/rules/always.md"]);
});

test("adds nothing without a ~/.claude", () => {
  assert.deepEqual(claudeInstructions(home({})), []);
});

test("skips files Pi already loads through a link", () => {
  const dir = home({ ".claude/CLAUDE.md": "mine" });
  mkdirSync(join(dir, ".pi/agent"), { recursive: true });
  symlinkSync(join(dir, ".claude/CLAUDE.md"), join(dir, ".pi/agent/CLAUDE.md"));
  const extra = claudeInstructions(dir);
  assert.deepEqual(notLoaded([{ path: join(dir, ".pi/agent/CLAUDE.md"), content: "mine" }], extra), []);
  assert.equal(notLoaded([], extra).length, 1);
});
