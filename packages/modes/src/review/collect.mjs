// Finds the approvals worth reviewing. Reads the log and config, and writes nothing.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const APPROVED = new Set(["approved", "approved_for_session", "session_approved"]);
/** Who approved: you, a rule you granted for the session, or your answer in a parent session. */
const PERSON = new Set(["user", "session_approval", "forwarded"]);
const SECRET = /(?:token|secret|password|passwd|api[_-]?key|authorization|credential)|\b[A-Za-z0-9_-]{32,}\b/i;
const MAX_EXAMPLES = 3;

/** A rule's `*` matches anything, so this is the same test the permission system applies. */
export function matches(pattern, value) {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[\\s\\S]*").replace(/\?/g, "[\\s\\S]");
  return new RegExp(`^${source}$`).test(value);
}

/** The last matching rule wins. */
export function ruleFor(rules, value) {
  let state;
  for (const [pattern, rule] of Object.entries(rules ?? {})) if (matches(pattern, value)) state = rule;
  return state;
}

/** Two words for tools with subcommands, like `git diff*`, and a narrower rule is the reviewer's to choose. */
export function suggestPattern(command) {
  const words = command.trim().split(/\s+/);
  const second = words[1];
  return second !== undefined && /^[a-z][\w:-]*$/i.test(second) ? `${words[0]} ${second}*` : `${words[0]}*`;
}

export function collect(entries, permission = {}, history = []) {
  const groups = new Map();
  let skipped = 0;
  const add = (key, base, entry, example, field = "approvals") => {
    const group = groups.get(key) ?? { ...base, approvals: 0, ran: 0, days: new Set(), last: "", examples: new Set() };
    group[field] += 1;
    const at = String(entry.timestamp ?? "");
    if (at !== "") group.days.add(at.slice(0, 10));
    if (at > group.last) group.last = at;
    if (example && group.examples.size < MAX_EXAMPLES) group.examples.add(example);
    groups.set(key, group);
  };

  for (const entry of entries) {
    if (!APPROVED.has(entry.resolution)) continue;
    const by = entry.decidedBy;
    if (!PERSON.has(by?.kind) && !(by?.kind === "authorizer" && by.name !== "pi-modes")) continue;
    const surface = entry.surface ?? entry.toolName;

    if (surface === "bash") {
      const command = entry.executedUnit ?? entry.command;
      if (typeof command !== "string" || command.trim() === "" || entry.matchedPattern?.startsWith("<")) skipped += 1;
      else if (SECRET.test(command)) skipped += 1;
      else if (ruleFor(permission.bash, command) === "allow") continue;
      else {
        const pattern = suggestPattern(command);
        add(`bash ${pattern}`, { kind: "bash", pattern }, entry, command.slice(0, 200));
      }
    } else if (surface === "path" || surface === "external_directory" || typeof surface !== "string") {
      skipped += 1; // Access outside the project is a decision for the config by hand, not a habit to learn.
    } else if (permission[surface] !== "allow") {
      add(`tool ${surface}`, { kind: "tool", tool: surface }, entry);
    }
  }

  for (const entry of history) {
    if (SECRET.test(entry.command) || ruleFor(permission.bash, entry.command) === "allow") continue;
    const pattern = suggestPattern(entry.command);
    add(`bash ${pattern}`, { kind: "bash", pattern }, entry, entry.command.slice(0, 200), "ran");
  }

  const candidates = [...groups.values()]
    .map((group) => ({ ...group, days: group.days.size, examples: [...group.examples] }))
    .sort((a, b) => b.approvals - a.approvals || b.ran - a.ran);
  return { candidates, skipped };
}

/**
 * Commands that ran, from one session's chat history. It doesn't say who approved them, so they
 * count separately from approvals. Failed or blocked calls and anything run in yolo are left out.
 */
export function ranCommands(entries) {
  const pending = [];
  const commands = [];
  let mode = "normal";
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "pi-modes") mode = entry.data?.mode ?? mode;
    if (entry.type !== "message") continue;
    const { message } = entry;
    if (message?.role === "toolResult") {
      // Matched in order, since not every provider keeps call ids unique.
      const at = pending.findIndex((call) => call.id === message.toolCallId);
      if (at === -1) continue;
      const [call] = pending.splice(at, 1);
      if (!message.isError && call.command !== undefined) commands.push({ command: call.command, timestamp: call.timestamp });
    } else if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        const command = block.name === "bash" && mode !== "yolo" && typeof block.arguments?.command === "string" ? block.arguments.command : undefined;
        pending.push({ id: block.id, command, timestamp: entry.timestamp });
      }
    }
  }
  return commands;
}

const SANDBOX_BLOCKS = [
  ["read", /^Sandbox: read access denied for "(.+)"$/],
  ["write", /^Sandbox: write access denied for "(.+)" \(not in allowWrite\)$/],
  ["domain", /^Network access to "(.+)" is blocked \(not in allowedDomains\)\.$/],
];

/**
 * What pi-sandbox blocked, from one session's chat history. Paths in denyWrite are left out, since
 * someone chose those. What the OS stopped has no clean path to allow, so it comes as examples.
 */
export function sandboxBlocks(entries) {
  const blocks = [];
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "toolResult" || !Array.isArray(entry.message.content)) continue;
    const text = entry.message.content.map((part) => part.text ?? "").join("").trim();
    if (entry.message.isError && entry.message.toolName === "bash" && text.includes("Operation not permitted")) {
      const example = text.split("\n").find((line) => line.includes("Operation not permitted"));
      blocks.push({ kind: "os", example, timestamp: entry.timestamp });
    }
    for (const [kind, shape] of SANDBOX_BLOCKS) {
      const value = shape.exec(text)?.[1];
      if (value !== undefined) blocks.push({ kind, value, timestamp: entry.timestamp });
    }
  }
  return blocks;
}

/** Blocks grouped by what would have to be allowed, without what the config allows by now. */
export function collectSandbox(blocks, config = {}) {
  const allowed = {
    read: config.filesystem?.allowRead ?? [],
    write: config.filesystem?.allowWrite ?? [],
    domain: config.network?.allowedDomains ?? [],
  };
  const groups = new Map();
  let osBlocks = 0;
  const osExamples = new Set();
  let skipped = 0;
  for (const { kind, value, example, timestamp } of blocks) {
    if (kind === "os") {
      osBlocks += 1;
      if (osExamples.size < MAX_EXAMPLES && !SECRET.test(example)) osExamples.add(example.slice(0, 200));
    } else if (SECRET.test(value)) skipped += 1;
    else if (!allowed[kind].includes(value)) {
      const group = groups.get(`${kind} ${value}`) ?? { kind, value, blocks: 0, days: new Set(), last: "" };
      group.blocks += 1;
      const at = String(timestamp ?? "");
      if (at !== "") group.days.add(at.slice(0, 10));
      if (at > group.last) group.last = at;
      groups.set(`${kind} ${value}`, group);
    }
  }
  const candidates = [...groups.values()].map((group) => ({ ...group, days: group.days.size })).sort((a, b) => b.blocks - a.blocks);
  return { candidates, osBlocks, osExamples: [...osExamples], skipped };
}

function parseLog(text) {
  return text.split("\n").flatMap((line) => {
    try {
      return line.trim() === "" ? [] : [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

/** More than anyone would read through, and the model would pay for each one. */
export const MAX_CANDIDATES = 60;

function capped({ candidates, ...rest }) {
  return { ...rest, candidates: candidates.slice(0, MAX_CANDIDATES), more: Math.max(0, candidates.length - MAX_CANDIDATES) };
}

/** Everything the skill needs to assess. One file at a time, so Pi stays responsive with a long history. */
export async function reviewData(agent) {
  const dir = join(agent, "extensions", "pi-permission-system");
  const logPath = join(dir, "logs", "pi-permission-system-permission-review.jsonl");
  const configPath = join(dir, "config.json");
  const logFound = existsSync(logPath);
  const permission = existsSync(configPath) ? (JSON.parse(readFileSync(configPath, "utf8")).permission ?? {}) : {};
  const history = [];
  const blocks = [];
  // Sessions started from pi-board are kept apart from the others.
  for (const sessions of [join(agent, "sessions"), join(agent, "agent-board", "sessions")]) {
    if (!existsSync(sessions)) continue;
    for (const name of readdirSync(sessions, { recursive: true }).map(String).filter((file) => file.endsWith(".jsonl"))) {
      const entries = parseLog(await readFile(join(sessions, name), "utf8").catch(() => ""));
      history.push(...ranCommands(entries));
      blocks.push(...sandboxBlocks(entries));
    }
  }
  const result = capped(collect(logFound ? parseLog(await readFile(logPath, "utf8")) : [], permission, history));
  const sandboxPath = join(agent, "sandbox.json");
  let sandboxConfig = {};
  try {
    if (existsSync(sandboxPath)) sandboxConfig = JSON.parse(readFileSync(sandboxPath, "utf8"));
  } catch {
    // Comments are allowed there. Already-allowed entries may show up, and apply won't add them twice.
  }
  return { logFound, ...result, sandbox: capped(collectSandbox(blocks, sandboxConfig)) };
}
