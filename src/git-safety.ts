/**
 * Git runs what a repository's own config and hooks tell it to, even for `git status`. A plain clone
 * can bring that along, as a bare repository committed in a subfolder, so read-only git commands are
 * only read-only where nothing like that is set. This allowlist fails closed: an unknown key costs a
 * prompt, never a command run.
 */
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const HARMLESS = new RegExp(
  "^(?:" +
    [
      // hooksPath is fine in itself, as husky sets it. What's in that folder gets checked below.
      "core\\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|sharedrepository|autocrlf|eol|safecrlf|abbrev|quotepath|hookspath)",
      "remote\\..+\\.(?:url|pushurl|fetch|tagopt|prune)",
      "branch\\..+\\.(?:remote|merge|rebase|pushremote|description)",
      "submodule\\..+\\.(?:url|active)",
      "user\\.(?:name|email|signingkey)",
      "(?:pull|push|fetch|init|color|gpg|commit|tag|rebase|merge|gc|advice|lfs)\\.[^.]+",
    ].join("|") +
    ")$",
  "is",
);

/** These only fire on what changes history, which the read-only check refuses anyway, so husky and pre-commit stay usable. */
const WRITE_ONLY_HOOKS = new Set([
  "applypatch-msg", "commit-msg", "post-applypatch", "post-checkout", "post-commit", "post-merge", "post-receive", "post-rewrite", "post-update",
  "pre-applypatch", "pre-auto-gc", "pre-commit", "pre-merge-commit", "pre-push", "pre-rebase", "pre-receive", "prepare-commit-msg", "update",
]);

const TIMEOUT_MS = 2000;

function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" } },
      (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
    );
  });
}

/** The first setting from this repository that isn't known to be harmless. Takes `--show-scope --name-only --list -z` output. */
export function riskyRepoKey(config: string): string | undefined {
  const fields = config.split("\0");
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const scope = fields[at];
    const key = fields[at + 1] as string;
    if ((scope === "local" || scope === "worktree") && !HARMLESS.test(key)) return key;
  }
  return undefined;
}

/** Why git commands aren't read-only in this folder, or undefined when they are. */
export async function gitRisk(cwd: string): Promise<string | undefined> {
  try {
    // `git config --list` and `rev-parse` read the config without acting on it.
    const key = riskyRepoKey(await git(cwd, ["config", "--show-scope", "--name-only", "--list", "-z"]));
    if (key !== undefined) return `this repository sets ${key}, which git may act on`;
    // Follows core.hooksPath. It fails outside a repository, where there's nothing of its to run.
    const path = await git(cwd, ["rev-parse", "--git-path", "hooks"]).catch(() => undefined);
    if (path === undefined) return undefined;
    const dir = path.trim();
    const hooks = await readdir(isAbsolute(dir) ? dir : join(cwd, dir)).catch(() => [] as string[]);
    const hook = hooks.find((name) => !name.endsWith(".sample") && !name.startsWith(".") && !WRITE_ONLY_HOOKS.has(name));
    return hook === undefined ? undefined : `this repository has a ${hook} hook, which git may run`;
  } catch {
    return "couldn't check this repository's git config";
  }
}
