// Reads your Claude Code instructions the way Claude Code does: ~/.claude/CLAUDE.md, the files it
// imports with @path, and ~/.claude/rules. Nothing here is per project, so a repository can't add to it.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ContextFile {
  path: string;
  content: string;
}

/** As deep as Claude Code follows imports. */
const MAX_DEPTH = 5;

/** Claude however it's reached: Anthropic, the Claude login, or a gateway or cloud that names the model claude. */
export function isClaude(model: { provider: string; id: string } | undefined): boolean {
  if (model === undefined) return false;
  return model.provider === "anthropic" || model.provider === "claude-sdk" || /claude/i.test(model.id);
}

/** The `@path` references in prose. Code blocks and code spans are skipped, as in Claude Code. */
export function importsIn(text: string): string[] {
  const found: string[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const prose = line.replace(/`[^`]*`/g, "");
    for (const match of prose.matchAll(/(?:^|\s)@([\w.~/-]+)/g)) {
      const ref = (match[1] as string).replace(/[.,;:!?]+$/, "");
      if (ref !== "") found.push(ref);
    }
  }
  return found;
}

/** A rule with `paths:` applies only to matching files, which isn't known before a turn, so it's left out. */
function isConditional(content: string): boolean {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return front !== null && /^paths\s*:/m.test(front[1] as string);
}

/** False for a link that leads nowhere, rather than throwing on every message. */
function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Every file to add, in reading order, each once. */
export function claudeInstructions(home: string): ContextFile[] {
  const files: ContextFile[] = [];
  const seen = new Set<string>();

  const visit = (path: string, depth: number, fromRules: boolean): void => {
    let real: string;
    try {
      real = realpathSync(path);
    } catch {
      return; // Missing, like a mention that only looks like an import.
    }
    if (seen.has(real)) return;
    seen.add(real);
    const stat = statSync(real);
    if (stat.isDirectory()) {
      for (const name of readdirSync(real).sort()) {
        const child = join(path, name);
        if (name.endsWith(".md") || isFolder(child)) visit(child, depth, fromRules);
      }
      return;
    }
    if (!stat.isFile()) return;
    let content: string;
    try {
      content = readFileSync(real, "utf8");
    } catch {
      return; // Unreadable. A message to Claude is worth more than one file.
    }
    if (fromRules && isConditional(content)) return;
    files.push({ path, content });
    if (depth >= MAX_DEPTH) return;
    for (const ref of importsIn(content)) {
      visit(ref.startsWith("~/") ? join(home, ref.slice(2)) : resolve(dirname(path), ref), depth + 1, false);
    }
  };

  visit(join(home, ".claude", "CLAUDE.md"), 0, false);
  visit(join(home, ".claude", "rules"), 0, true);
  return files;
}

/** The files Pi isn't already giving the model, such as a ~/.pi/agent/CLAUDE.md that links to the same file. */
export function notLoaded(existing: readonly ContextFile[], extra: readonly ContextFile[]): ContextFile[] {
  const real = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const have = new Set(existing.map((file) => real(file.path)));
  return extra.filter((file) => !have.has(real(file.path)));
}
