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

const CREDENTIALS = /(?:^|\/)(?:\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.netrc|\.npmrc|\.pgpass|\.git-credentials|\.pi|\.claude|\.codex|\.elfie|\.config\/gh|\.config\/gcloud|auth\.json|credentials(?:\.\w+)?|\.env(?:\.[^/]*)?)(?:\/|$)|\.(?:pem|key|p12|pfx)$|(?:^|\/)id_[a-z0-9]+$/i;
const RUNS_LATER = /(?:^|\/)(?:\.git\/hooks|\.git\/config|\.zshrc|\.zshenv|\.zprofile|\.bashrc|\.bash_profile|\.profile|\.gitconfig|Library\/LaunchAgents|\.config\/autostart)(?:\/|$)/;

/** Why a sandbox path must not be allowed, or undefined when it may be. */
export function refuseSandboxPath(kind, path, home = homedir()) {
  const text = path.trim().replace(/(.)\/+$/, "$1");
  if (text === "" || text === "/" || text === "~" || text === home || text === "/Users" || text === "/home" || /[*?[]/.test(text) || text.split("/").includes("..")) return "it covers far more than one folder, so name the folder";
  if (CREDENTIALS.test(text)) return "this holds credentials";
  if (kind === "write" && RUNS_LATER.test(text)) return "whatever is written here runs later, outside the sandbox";
  return undefined;
}

export function refuseDomain(domain) {
  const text = domain.trim().replace(/^\*\./, "");
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(text)) return "it isn't a single domain";
  return undefined;
}

/** pi-sandbox 0.7.3's defaults. They stop applying once a list is set, so a new list starts from them. */
const SANDBOX_DEFAULTS = {
  read: [".", "~/.config", "~/.local", "Library"],
  write: [".", "/tmp"],
  domain: ["npmjs.org", "*.npmjs.org", "registry.npmjs.org", "registry.yarnpkg.com", "pypi.org", "*.pypi.org", "github.com", "*.github.com", "api.github.com", "raw.githubusercontent.com"],
};

export function applySandbox(config, { read = [], write = [], domains = [] }) {
  const refusals = [
    ...read.flatMap((path) => [refuseSandboxPath("read", path)].filter(Boolean).map((why) => `${path}: ${why}`)),
    ...write.flatMap((path) => [refuseSandboxPath("write", path)].filter(Boolean).map((why) => `${path}: ${why}`)),
    ...domains.flatMap((domain) => [refuseDomain(domain)].filter(Boolean).map((why) => `${domain}: ${why}`)),
  ];
  if (refusals.length > 0) return { refusals };
  const add = (existing, kind, fresh) => (fresh.length === 0 ? existing : [...new Set([...(existing ?? SANDBOX_DEFAULTS[kind]), ...fresh])]);
  const filesystem = { ...config.filesystem };
  const network = { ...config.network };
  const allowRead = add(filesystem.allowRead, "read", read);
  const allowWrite = add(filesystem.allowWrite, "write", write);
  const allowedDomains = add(network.allowedDomains, "domain", domains);
  if (allowRead !== undefined) filesystem.allowRead = allowRead;
  if (allowWrite !== undefined) filesystem.allowWrite = allowWrite;
  if (allowedDomains !== undefined) network.allowedDomains = allowedDomains;
  return { config: { ...config, filesystem, network }, refusals: [] };
}

function writeWithBackup(path, config) {
  let backup;
  if (existsSync(path)) {
    backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(path, backup);
  }
  writeFileSync(`${path}.tmp`, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  return backup;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const bash = [];
  const tools = [];
  const read = [];
  const write = [];
  const domains = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === "--bash" && args[i + 1] !== undefined) bash.push(args[i + 1]);
    else if (args[i] === "--tool" && args[i + 1] !== undefined) tools.push(args[i + 1]);
    else if (args[i] === "--sandbox-read" && args[i + 1] !== undefined) read.push(args[i + 1]);
    else if (args[i] === "--sandbox-write" && args[i + 1] !== undefined) write.push(args[i + 1]);
    else if (args[i] === "--sandbox-domain" && args[i + 1] !== undefined) domains.push(args[i + 1]);
    else {
      console.error("usage: apply.mjs [--bash PATTERN]... [--tool NAME]... [--sandbox-read PATH]... [--sandbox-write PATH]... [--sandbox-domain DOMAIN]...");
      process.exit(2);
    }
  }
  const agent = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const fail = (message) => {
    console.error(`Nothing was changed.\n${message}`);
    process.exit(1);
  };
  const path = join(agent, "extensions", "pi-permission-system", "config.json");
  const sandboxPath = join(agent, "sandbox.json");
  const wantsRules = bash.length > 0 || tools.length > 0;
  const wantsSandbox = read.length > 0 || write.length > 0 || domains.length > 0;
  if (wantsRules && !existsSync(path)) fail(`No config at ${path}.`);
  const rules = wantsRules ? applyRules(JSON.parse(readFileSync(path, "utf8")), { bash, tools }) : { refusals: [] };
  let sandboxConfig = {};
  if (wantsSandbox && existsSync(sandboxPath)) {
    try {
      sandboxConfig = JSON.parse(readFileSync(sandboxPath, "utf8"));
    } catch {
      fail(`${sandboxPath} isn't plain JSON, perhaps because of comments, and writing it back would lose them. Add these by hand.`);
    }
  }
  const sandbox = wantsSandbox ? applySandbox(sandboxConfig, { read, write, domains }) : { refusals: [] };
  const refusals = [...rules.refusals, ...sandbox.refusals];
  if (refusals.length > 0) fail(refusals.join("\n"));
  const backups = [];
  if (wantsRules) backups.push(writeWithBackup(path, rules.config));
  if (wantsSandbox) backups.push(writeWithBackup(sandboxPath, sandbox.config));
  console.log(JSON.stringify({ added: { bash, tools, read, write, domains }, backups: backups.filter(Boolean) }, null, 2));
}
