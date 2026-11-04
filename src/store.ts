/** The SQLite store. One file, shared by every Pi running at the time. */
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { hasSecret } from "./secrets.ts";

export const CATEGORIES = ["preference", "fact", "decision", "project"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Memory {
  id: number;
  category: Category;
  content: string;
  project: string | null;
  sourceSession: string | null;
  updatedAt: string;
}

export const MAX_CONTENT = 500;

const SCHEMA = `
  CREATE TABLE memories (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    project TEXT,
    source_session TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX memories_unique ON memories (content, ifnull(project, ''));
  CREATE VIRTUAL TABLE memories_fts USING fts5(content, content='memories', content_rowid='id');
  CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts (rowid, content) VALUES (new.id, new.content);
  END;
  CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts (memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
  END;
  CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts (memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO memories_fts (rowid, content) VALUES (new.id, new.content);
  END;
  CREATE TABLE reviewed (
    path TEXT PRIMARY KEY,
    bytes INTEGER NOT NULL,
    reviewed_at TEXT NOT NULL
  );
`;

/** node:sqlite warns that it's experimental on some Node versions, and the warning would land on Pi's screen. */
async function loadSqlite(): Promise<typeof import("node:sqlite")> {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (!String(warning).includes("SQLite")) (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return await import("node:sqlite");
  } finally {
    process.emitWarning = emitWarning;
  }
}

function toMemory(row: Record<string, unknown>): Memory {
  return {
    id: Number(row.id),
    category: row.category as Category,
    content: String(row.content),
    project: row.project === null ? null : String(row.project),
    sourceSession: row.source_session === null ? null : String(row.source_session),
    updatedAt: String(row.updated_at),
  };
}

/** Control characters would reach the system prompt and the terminal. */
function clean(content: string): string {
  const text = content.replace(/[\x00-\x1f\x7f-\x9f]+/g, " ").trim();
  if (!text) throw new Error("A memory can't be empty.");
  if (text.length > MAX_CONTENT) throw new Error(`Keep a memory to ${MAX_CONTENT} characters, so it stays one fact.`);
  if (hasSecret(text)) throw new Error("This looks like it contains a secret, so it wasn't saved. Save where the secret lives instead, not its value.");
  return text;
}

/** Every word must match, each as a prefix. Quoted, so what's searched for can't be read as FTS syntax. */
function ftsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `"${word.replaceAll('"', '""')}"*`)
    .join(" ");
}

export class MemoryStore {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static async open(path: string): Promise<MemoryStore> {
    const { DatabaseSync } = await loadSqlite();
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
    db.exec("BEGIN IMMEDIATE");
    try {
      const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
      if (version === 0) db.exec(`${SCHEMA} PRAGMA user_version = 1;`);
      else if (version !== 1) throw new Error(`${path} was written by a newer pi-memory (schema ${version}).`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      db.close();
      throw err;
    }
    return new MemoryStore(db);
  }

  close(): void {
    this.db.close();
  }

  add(input: { category: Category; content: string; project?: string | null; sourceSession?: string | null }): { memory: Memory; added: boolean } {
    const content = clean(input.content);
    const project = input.project ?? null;
    const now = new Date().toISOString();
    const inserted = this.db
      .prepare("INSERT OR IGNORE INTO memories (category, content, project, source_session, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.category, content, project, input.sourceSession ?? null, now, now);
    const row = this.db.prepare("SELECT * FROM memories WHERE content = ? AND ifnull(project, '') = ifnull(?, '')").get(content, project);
    return { memory: toMemory(row as Record<string, unknown>), added: inserted.changes > 0 };
  }

  update(id: number, content: string): boolean {
    return this.db.prepare("UPDATE memories SET content = ?, updated_at = ? WHERE id = ?").run(clean(content), new Date().toISOString(), id).changes > 0;
  }

  delete(id: number): boolean {
    return this.db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
  }

  /** Newest first. With a project, its memories and the global ones, with its own first. */
  list(options: { project?: string; limit?: number } = {}): Memory[] {
    const rows =
      options.project === undefined
        ? this.db.prepare("SELECT * FROM memories ORDER BY updated_at DESC, id DESC LIMIT ?").all(options.limit ?? -1)
        : this.db
            .prepare("SELECT * FROM memories WHERE project IS NULL OR project = ? ORDER BY project IS NULL, updated_at DESC, id DESC LIMIT ?")
            .all(options.project, options.limit ?? -1);
    return rows.map((row) => toMemory(row as Record<string, unknown>));
  }

  /** Best match first, across every project: what was decided elsewhere can still help here. */
  search(query: string, limit = 20): Memory[] {
    const match = ftsQuery(query);
    if (!match) return [];
    return this.db
      .prepare("SELECT m.* FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts) LIMIT ?")
      .all(match, limit)
      .map((row) => toMemory(row as Record<string, unknown>));
  }

  reviewedBytes(path: string): number {
    const row = this.db.prepare("SELECT bytes FROM reviewed WHERE path = ?").get(path) as { bytes: number } | undefined;
    return row?.bytes ?? 0;
  }

  markReviewed(path: string, bytes: number): void {
    this.db
      .prepare("INSERT INTO reviewed (path, bytes, reviewed_at) VALUES (?, ?, ?) ON CONFLICT (path) DO UPDATE SET bytes = excluded.bytes, reviewed_at = excluded.reviewed_at")
      .run(path, bytes, new Date().toISOString());
  }
}
