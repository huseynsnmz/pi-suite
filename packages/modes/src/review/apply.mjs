// Adds allow rules to the permission system's config, after a backup.
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RUNS_ANYTHING = /^(?:bash|sh|zsh|dash|ksh|fish|eval|exec|source|sudo|su|doas|env|xargs|python\d*|node|bun|deno|ruby|perl|php|npx|bunx|pnpx|curl|wget|ssh|scp|rsync|rm|mv|dd|chmod|chown|find|awk|sed)\b/;
const OUTWARD = /^(?:git\s+(?:push|reset|clean|rebase|filter-branch)|gh\s+(?:pr\s+merge|release|repo|api|auth|secret)|glab\s+(?:mr\s+merge|release|repo|api|auth)|(?:npm|pnpm|yarn|bun)\s+publish|docker\s+(?:push|run|exec)|kubectl|terraform|wrangler)\b/;
/**
 * Commands with no subcommands that only read, so a trailing `*` adds just their options. Not `rg`,
 * whose --pre runs a program, `file`, whose -C writes, or `date`, whose -s sets the clock.
 */
const READERS = new Set(["cd", "ls", "pwd", "wc", "head", "tail", "which", "grep", "tree", "du", "df", "stat", "diff"]);
const BUILT_IN_TOOLS = new Set(["read", "grep", "find", "ls", "submit_plan"]);
const REFUSED_SURFACES = new Set(["bash", "path", "external_directory", "mcp", "skill", "*"]);

/** Why a rule must not be added, or undefined when it may be. */
export function refuseBash(pattern) {
  const text = pattern.trim();
  if (text === "" || text.startsWith("*") || text.startsWith("?")) return "it matches any command";
  if (text === "cd*") return "it also matches cdk and other commands, so write `cd *`";
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
export function withBashAllows(rules, patterns, guards = []) {
  const entries = Object.entries(rules ?? { "*": "ask" });
  const fresh = patterns.filter((pattern) => !entries.some(([existing]) => existing === pattern));
  const at = entries[0]?.[0] === "*" ? 1 : 0;
  const next = [...entries.slice(0, at), ...fresh.map((pattern) => [pattern, "allow"]), ...entries.slice(at)];
  // Guards ask about part of what those allows match, so they go after them, wherever they are.
  const last = Math.max(...patterns.map((pattern) => next.findIndex(([existing]) => existing === pattern)));
  next.splice(last + 1, 0, ...guards.filter((pattern) => !entries.some(([existing]) => existing === pattern)).map((pattern) => [pattern, "ask"]));
  return Object.fromEntries(next);
}

export function applyRules(config, { bash = [], tools = [], guards = [] }) {
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
    // With no bash rules, bash follows the catch-all, so a new map has to start from it.
    permission.bash = withBashAllows(permission.bash ?? { "*": permission["*"] ?? "ask" }, bash, guards);
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

/**
 * The judge reads the same global context file the agent does, the first of these in Pi's folder, so notes for it
 * go there, in a section of their own. The agent reads them too.
 */
const CONTEXT_NAMES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
const NOTES_START = "<!-- pi-modes: notes for the permission judge, kept by /skill:review-permissions -->";
const NOTES_END = "<!-- /pi-modes -->";
const NOTES_HEADING = "## Routine here, for the permission judge";
const NOTE_CHARS = 200;
const NOTES_CHARS = 2000;
const SECRET = /(?:token|secret|password|passwd|api[_-]?key|authorization|credential)|\b[A-Za-z0-9_-]{32,}\b/i;
const TOO_BROAD = /\b(?:always allow|allow (?:everything|anything|all)|any command|anything goes|don't ask|never ask)\b/i;

export function guidancePath(agent) {
  return CONTEXT_NAMES.map((name) => join(agent, name)).find((path) => existsSync(path)) ?? join(agent, "AGENTS.md");
}

/** The notes in the section, one per line, without their bullets. */
export function readNotes(text) {
  const start = text.indexOf(NOTES_START);
  const end = text.indexOf(NOTES_END, start);
  if (start === -1 || end === -1) return [];
  return text.slice(start + NOTES_START.length, end).split("\n").flatMap((line) => (line.startsWith("- ") ? [line.slice(2).trim()] : []));
}

/** The file with these notes added to the section, which is made at the end if it isn't there. Nothing else changes. */
export function withNotes(text, notes) {
  const all = [...new Set([...readNotes(text), ...notes.map((note) => note.trim())])];
  const section = `${NOTES_START}\n${NOTES_HEADING}\n\n${all.map((note) => `- ${note}`).join("\n")}\n${NOTES_END}`;
  const start = text.indexOf(NOTES_START);
  const end = text.indexOf(NOTES_END, start);
  if (start !== -1 && end !== -1) return `${text.slice(0, start)}${section}${text.slice(end + NOTES_END.length)}`;
  return `${text.trimEnd()}${text.trim() === "" ? "" : "\n\n"}${section}\n`;
}

/** Why a note for the judge must not be added, or undefined when it may be. */
export function refuseNote(note) {
  const text = note.trim();
  if (text === "") return "it's empty";
  if (text.length > NOTE_CHARS) return `it's over ${NOTE_CHARS} characters, so make it one routine action`;
  if (/[\n\r]|<!--|-->|```/.test(text)) return "it holds markup or more than one line";
  if (SECRET.test(text)) return "it looks like it holds a secret";
  if (TOO_BROAD.test(text)) return "it would let the judge allow too much, so describe one routine action";
  return undefined;
}

function writeWithBackup(path, config) {
  let backup;
  if (existsSync(path)) {
    backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(path, backup);
  }
  writeFileSync(`${path}.tmp`, typeof config === "string" ? config : `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  return backup;
}

function planChoices(agent, { bash = [], tools = [], guards = [], read = [], write = [], domains = [], guidance = [] }) {
  const path = join(agent, "extensions", "pi-permission-system", "config.json");
  const sandboxPath = join(agent, "sandbox.json");
  const wantsRules = bash.length > 0 || tools.length > 0;
  const wantsSandbox = read.length > 0 || write.length > 0 || domains.length > 0;
  if (wantsRules && !existsSync(path)) return { refusals: [`No config at ${path}.`] };
  const rules = wantsRules ? applyRules(JSON.parse(readFileSync(path, "utf8")), { bash, tools, guards }) : { refusals: [] };
  let sandboxConfig = {};
  if (wantsSandbox && existsSync(sandboxPath)) {
    try {
      sandboxConfig = JSON.parse(readFileSync(sandboxPath, "utf8"));
    } catch {
      return { refusals: [`${sandboxPath} isn't plain JSON, perhaps because of comments, and writing it back would lose them. Add these by hand.`] };
    }
  }
  const sandbox = wantsSandbox ? applySandbox(sandboxConfig, { read, write, domains }) : { refusals: [] };
  const notesPath = guidancePath(agent);
  const notesRefused = guidance.flatMap((note) => [refuseNote(note)].filter(Boolean).map((why) => `${note}: ${why}`));
  const notes = guidance.length > 0 && notesRefused.length === 0 ? withNotes(existsSync(notesPath) ? readFileSync(notesPath, "utf8") : "", guidance) : undefined;
  if (notes !== undefined && readNotes(notes).join("\n").length > NOTES_CHARS) notesRefused.push(`The notes for the judge would pass ${NOTES_CHARS} characters. Remove some from ${notesPath} first.`);
  const refusals = [...rules.refusals, ...sandbox.refusals, ...notesRefused];
  if (refusals.length > 0) return { refusals };
  return { refusals: [], writes: [...(wantsRules ? [[path, rules.config]] : []), ...(wantsSandbox ? [[sandboxPath, sandbox.config]] : []), ...(notes === undefined ? [] : [[notesPath, notes]])] };
}

/** Why these can't be added, without changing anything. Empty when they can. */
export function checkChoices(agent, choices) {
  return planChoices(agent, choices).refusals;
}

/** Writes the choices, after a backup. Asking the user first is the caller's job. */
export function applyChoices(agent, choices) {
  const { refusals, writes } = planChoices(agent, choices);
  if (refusals.length > 0) return { refusals };
  const backups = writes.map(([path, config]) => writeWithBackup(path, config)).filter(Boolean);
  return { refusals: [], added: choices, backups };
}
