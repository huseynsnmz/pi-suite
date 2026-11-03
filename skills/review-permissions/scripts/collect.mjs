#!/usr/bin/env node
// Prints the approvals worth reviewing. Reads the log and config, and writes nothing.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

export function collect(entries, permission = {}) {
  const groups = new Map();
  let skipped = 0;
  const add = (key, base, entry, example) => {
    const group = groups.get(key) ?? { ...base, approvals: 0, days: new Set(), last: "", examples: new Set() };
    group.approvals += 1;
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

  const candidates = [...groups.values()]
    .map((group) => ({ ...group, days: group.days.size, examples: [...group.examples] }))
    .sort((a, b) => b.approvals - a.approvals);
  return { candidates, skipped };
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const agent = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const dir = join(agent, "extensions", "pi-permission-system");
  const logPath = join(dir, "logs", "pi-permission-system-permission-review.jsonl");
  const configPath = join(dir, "config.json");
  const logFound = existsSync(logPath);
  const permission = existsSync(configPath) ? (JSON.parse(readFileSync(configPath, "utf8")).permission ?? {}) : {};
  const result = collect(logFound ? parseLog(readFileSync(logPath, "utf8")) : [], permission);
  console.log(JSON.stringify({ logFound, ...result }, null, 2));
}
