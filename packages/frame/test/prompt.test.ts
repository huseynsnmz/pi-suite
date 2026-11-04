import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pastPrompts } from "../src/data/past-prompts.ts";
import { paintLead, promptLead } from "../src/render/lead.ts";
import { findPrompt, shownText, startSearch } from "../src/ui/history-search.ts";

const mark = (text: string) => `<${text}>`;

describe("what counts as a command", () => {
	test.each([
		["/model", "command", 6],
		["/skill:review the diff", "command", 13],
		["!ls -la", "bash", 3],
		["!! ls -la", "bash", 5],
	])("%s", (text, kind, length) => {
		expect(promptLead(text)).toEqual({ kind, length } as never);
	});

	test.each(["fix /model", "/usr/bin/env is wrong", "/", "hello"])("not %s", (text) => {
		expect(promptLead(text)).toBeUndefined();
	});
});

describe("painting the start of a line", () => {
	test("stops after the command, and leaves the rest", () => {
		expect(paintLead("/model rest", 6, mark)).toBe("</model> rest");
	});

	test("keeps an escape in the middle, like the cursor, out of the paint", () => {
		expect(paintLead("/mo\x1b_pi:c\x07del x", 6, mark)).toBe("</mo>\x1b_pi:c\x07<del> x");
		expect(paintLead("/m\x1b[7mo\x1b[0mdel", 6, mark)).toBe("</m>\x1b[7m<o>\x1b[0m<del>");
	});
});

describe("searching", () => {
	const search = startSearch("draft", ["fix the tests", "Run tests", "deploy", "fix the tests"]);

	test("repeats are gone, and it ignores case", () => {
		search.query = "TESTS";
		expect(search.entries).toHaveLength(3);
		expect(findPrompt(search, 0)).toBe(0);
		expect(findPrompt(search, 1)).toBe(1);
		expect(findPrompt(search, 2)).toBe(-1);
	});

	test("the prompt shows the match, or the draft", () => {
		search.at = 1;
		expect(shownText(search)).toBe("Run tests");
		search.at = -1;
		expect(shownText(search)).toBe("draft");
	});
});

describe("past prompts", () => {
	const line = (role: string, content: unknown) => JSON.stringify({ type: "message", message: { role, content } });

	test("newest session first, newest prompt first, and only what a person typed", () => {
		const dir = mkdtempSync(join(tmpdir(), "prompts-"));
		mkdirSync(dir, { recursive: true });
		const older = join(dir, "a.jsonl");
		const newer = join(dir, "b.jsonl");
		writeFileSync(older, [line("user", "old"), line("assistant", "no"), "not json"].join("\n"));
		writeFileSync(newer, [line("user", [{ type: "text", text: "first" }]), line("user", "second")].join("\n"));
		utimesSync(older, new Date(1000), new Date(1000));
		expect(pastPrompts(dir)).toEqual(["second", "first", "old"]);
	});

	test("a folder that isn't there has none", () => {
		expect(pastPrompts("/nonexistent/folder")).toEqual([]);
	});
});
