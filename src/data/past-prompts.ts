import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const NEWEST_FILES = 20;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PROMPTS = 1000;

function promptOf(line: string): string | undefined {
	if (!line.includes('"role":"user"')) return undefined;
	try {
		const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
		if (entry.type !== "message" || entry.message?.role !== "user") return undefined;
		const content = entry.message.content;
		if (typeof content === "string") return content.trim() || undefined;
		if (!Array.isArray(content)) return undefined;
		const text = content
			.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("\n")
			.trim();
		return text || undefined;
	} catch {
		return undefined;
	}
}

/** What was typed in this folder's recent sessions, newest first. A file it can't read is skipped. */
export function pastPrompts(sessionDir: string): string[] {
	const prompts: string[] = [];
	let files: { path: string; modified: number; size: number }[] = [];
	try {
		files = readdirSync(sessionDir)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => {
				const path = join(sessionDir, name);
				const { mtimeMs, size } = statSync(path);
				return { path, modified: mtimeMs, size };
			});
	} catch {
		return [];
	}
	files.sort((a, b) => b.modified - a.modified);
	for (const { path, size } of files.slice(0, NEWEST_FILES)) {
		if (size > MAX_FILE_BYTES || prompts.length >= MAX_PROMPTS) continue;
		try {
			const found: string[] = [];
			for (const line of readFileSync(path, "utf8").split("\n")) {
				const prompt = promptOf(line);
				if (prompt) found.push(prompt);
			}
			prompts.push(...found.reverse());
		} catch {
			/* it may be gone, or still being written */
		}
	}
	return prompts.slice(0, MAX_PROMPTS);
}
