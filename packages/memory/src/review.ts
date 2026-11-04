/** Reads what's new in Pi's session files, as text a model can distill. */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets } from "./secrets.ts";

/** About 15,000 tokens a pass: enough to be useful, not enough to surprise anyone with a bill. */
export const BATCH_CHARS = 60_000;
const MESSAGE_CHARS = 2_000;

export interface SessionPart {
  path: string;
  sessionId: string | null;
  cwd: string | null;
  /** How far this part reaches. Saved once it's reviewed, so a session that continues later is read from there. */
  endBytes: number;
  text: string;
}

export interface ReviewBatch {
  parts: SessionPart[];
  /** Sessions with more to read after this batch. */
  remaining: number;
}

export function sessionFiles(roots: string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root);
  return files.sort();
}

/** Only what people and the model said. Tool output is left out: it's the biggest part, and anything a file or web page says could end up as a memory. */
function messageText(entry: { type?: string; message?: { role?: string; content?: unknown } }): string | null {
  if (entry.type !== "message") return null;
  const role = entry.message?.role;
  if (role !== "user" && role !== "assistant") return null;
  const content = entry.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.flatMap((part) => (part?.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n")
        : "";
  const trimmed = text.trim();
  if (!trimmed) return null;
  const short = trimmed.length > MESSAGE_CHARS ? `${trimmed.slice(0, MESSAGE_CHARS)} [cut]` : trimmed;
  return `${role}: ${redactSecrets(short)}`;
}

function readFrom(path: string, start: number, size: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    const read = readSync(fd, buffer, 0, buffer.length, start);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** The session's id and folder, from the header on its first line. */
function readHeader(path: string, size: number): { sessionId: string | null; cwd: string | null } {
  try {
    const first = readFrom(path, 0, Math.min(size, 8192)).toString("utf8").split("\n", 1)[0] ?? "";
    const header = JSON.parse(first);
    return { sessionId: typeof header.id === "string" ? header.id : null, cwd: typeof header.cwd === "string" ? header.cwd : null };
  } catch {
    return { sessionId: null, cwd: null };
  }
}

/** Reads whole lines from `start`, stopping when the budget runs out. A line still being written waits for next time. */
function readPart(path: string, start: number, size: number, budget: number): { part: SessionPart; cutShort: boolean } | null {
  const { sessionId, cwd } = readHeader(path, size);
  const data = readFrom(path, start, size);
  const lines: string[] = [];
  let used = 0;
  let offset = 0;
  let cutShort = false;
  while (offset < data.length) {
    const newline = data.indexOf(0x0a, offset);
    if (newline < 0) break;
    let text: string | null = null;
    try {
      text = messageText(JSON.parse(data.toString("utf8", offset, newline)));
    } catch {
      // A line that isn't JSON tells us nothing, and shouldn't hold up the rest.
    }
    if (text !== null && used > 0 && used + text.length > budget) {
      cutShort = true;
      break;
    }
    offset = newline + 1;
    if (text !== null) {
      lines.push(text);
      used += text.length;
    }
  }
  if (offset === 0) return null;
  return { part: { path, sessionId, cwd, endBytes: start + offset, text: lines.join("\n\n") }, cutShort };
}

/**
 * The next batch of unreviewed conversation. Parts with no conversation in them have an empty `text`:
 * they're returned so they get marked too, and aren't read again.
 */
export function nextBatch(files: string[], reviewedBytes: (path: string) => number, options: { skip?: string | null; budget?: number } = {}): ReviewBatch {
  let budget = options.budget ?? BATCH_CHARS;
  const parts: SessionPart[] = [];
  let remaining = 0;
  for (const path of files) {
    if (path === options.skip) continue;
    const start = reviewedBytes(path);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      continue; // Deleted since the listing.
    }
    if (size <= start) continue;
    if (budget <= 0) {
      remaining += 1;
      continue;
    }
    const read = readPart(path, start, size, budget);
    if (read === null) continue;
    parts.push(read.part);
    budget -= read.part.text.length;
    if (read.cutShort) remaining += 1;
  }
  return { parts, remaining };
}

/** Sessions with anything unread, for the count `/memory` shows. */
export function countUnreviewed(files: string[], reviewedBytes: (path: string) => number, skip?: string | null): number {
  return files.filter((path) => {
    if (path === skip) return false;
    try {
      return statSync(path).size > reviewedBytes(path);
    } catch {
      return false;
    }
  }).length;
}
