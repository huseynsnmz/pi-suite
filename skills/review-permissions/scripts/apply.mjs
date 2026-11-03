#!/usr/bin/env node
// Adds allow rules to the permission system's config, after a backup.
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RUNS_ANYTHING = /^(?:bash|sh|zsh|dash|ksh|fish|eval|exec|source|sudo|su|doas|env|xargs|python\d*|node|bun|deno|ruby|perl|php|npx|bunx|pnpx|curl|wget|ssh|scp|rsync|rm|mv|dd|chmod|chown|find|awk|sed)\b/;
const OUTWARD = /^(?:git\s+(?:push|reset|clean|rebase|filter-branch)|gh\s+(?:pr\s+merge|release|repo|api|auth|secret)|glab\s+(?:mr\s+merge|release|repo|api|auth)|(?:npm|pnpm|yarn|bun)\s+publish|docker\s+(?:push|run|exec)|kubectl|terraform|wrangler)\b/;
/** Commands with no subcommands that only read, so a trailing `*` adds just their options. */
const READERS = new Set(["ls", "pwd", "wc", "head", "tail", "which", "file", "grep", "rg", "tree", "du", "df", "stat", "date", "diff"]);
const BUILT_IN_TOOLS = new Set(["read", "grep", "find", "ls", "submit_plan"]);
const REFUSED_SURFACES = new Set(["bash", "path", "external_directory", "mcp", "skill", "*"]);

/** Why a rule must not be added, or undefined when it may be. */
export function refuseBash(pattern) {
  const text = pattern.trim();
  if (text === "" || text.startsWith("*") || text.startsWith("?")) return "it matches any command";
  if (/[\n;&|`$<>()]/.test(text)) return "it holds shell syntax, and a rule matches one command";
  const words = text.split(/\s+/);
  const bare = words.length === 1 && text.endsWith("*") ? text.slice(0, -1) : words.length === 2 && words[1] === "*" ? words[0] : undefined;
  if (bare !== undefined && !READERS.has(bare)) return "it covers every subcommand, so name one";
  if (RUNS_ANYTHING.test(text)) return "this command can run code, delete or reach out, whatever its arguments";
  if (OUTWARD.test(text)) return "this changes what others see, or can't be undone";
  return undefined;
}

export function refuseTool(tool) {
  if (REFUSED_SURFACES.has(tool)) return "this surface needs a rule by hand";
  if (!BUILT_IN_TOOLS.has(tool)) return "only tools that just read can be allowed here. Add a rule for this one by hand if you are sure";
  return undefined;
}

/**
 * Rules are order-dependent and the last match wins, so new allows go straight after the
 * catch-all. Every existing `deny` or `ask` comes later and keeps overriding them.
 */
export function withBashAllows(rules, patterns) {
  const entries = Object.entries(rules ?? { "*": "ask" });
  const fresh = patterns.filter((pattern) => !entries.some(([existing]) => existing === pattern));
  const at = entries[0]?.[0] === "*" ? 1 : 0;
  const next = [...entries.slice(0, at), ...fresh.map((pattern) => [pattern, "allow"]), ...entries.slice(at)];
  return Object.fromEntries(next);
}

export function applyRules(config, { bash = [], tools = [] }) {
  const refusals = [
    ...bash.flatMap((pattern) => {
      const why = refuseBash(pattern);
      return why === undefined ? [] : [`${pattern}: ${why}`];
    }),
    ...tools.flatMap((tool) => {
      const why = refuseTool(tool);
      return why === undefined ? [] : [`${tool}: ${why}`];
    }),
  ];
  if (refusals.length > 0) return { refusals };
  const permission = { ...config.permission };
  if (bash.length > 0) {
    if (permission.bash !== undefined && (typeof permission.bash !== "object" || permission.bash === null))
      return { refusals: [`bash: its rule is the single word "${permission.bash}", so convert it to a map by hand`] };
    permission.bash = withBashAllows(permission.bash, bash);
  }
  for (const tool of tools) if (permission[tool] !== "deny") permission[tool] = "allow";
  return { config: { ...config, permission }, refusals: [] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const bash = [];
  const tools = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === "--bash" && args[i + 1] !== undefined) bash.push(args[i + 1]);
    else if (args[i] === "--tool" && args[i + 1] !== undefined) tools.push(args[i + 1]);
    else {
      console.error("usage: apply.mjs [--bash PATTERN]... [--tool NAME]...");
      process.exit(2);
    }
  }
  const agent = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const path = join(agent, "extensions", "pi-permission-system", "config.json");
  if (!existsSync(path)) {
    console.error(`No config at ${path}.`);
    process.exit(1);
  }
  const result = applyRules(JSON.parse(readFileSync(path, "utf8")), { bash, tools });
  if (result.refusals.length > 0) {
    console.error(`Nothing was changed.\n${result.refusals.join("\n")}`);
    process.exit(1);
  }
  const backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(path, backup);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(result.config, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  console.log(JSON.stringify({ added: { bash, tools }, backup }, null, 2));
}
