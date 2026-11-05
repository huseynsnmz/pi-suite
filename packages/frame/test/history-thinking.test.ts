import { describe, expect, test } from "bun:test";

import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";

import { startPrefix, stepPrefix } from "../src/ui/history-search.ts";
import { showThinkingWhileLive } from "../src/ui/thinking.ts";

describe("Up with text typed", () => {
	const entries = ["git status", "npm test", "git push", "Git log", "git status"];

	test("goes back through prompts that start with it, whatever the case, then forward to what was typed", () => {
		const search = startPrefix("git", entries);
		expect(stepPrefix(search, 1)).toBe("git status");
		expect(stepPrefix(search, 1)).toBe("git push");
		expect(stepPrefix(search, 1)).toBe("Git log");
		expect(stepPrefix(search, 1)).toBeUndefined();
		expect(stepPrefix(search, -1)).toBe("git push");
		expect(stepPrefix(search, -1)).toBe("git status");
		expect(stepPrefix(search, -1)).toBe("git");
		expect(stepPrefix(search, -1)).toBeUndefined();
	});

	test("no match leaves it alone, and the same text isn't a step", () => {
		expect(stepPrefix(startPrefix("zzz", entries), 1)).toBeUndefined();
		expect(startPrefix("npm test", entries).matches).toEqual([]);
	});
});

describe("reasoning", () => {
	const message = {
		role: "assistant",
		content: [{ type: "thinking", thinking: "SECRETPLAN" }],
		stopReason: "stop",
		timestamp: 0,
	} as never;
	const label = "Thought";
	const plain = (view: AssistantMessageComponent) => view.render(80).join("\n");

	test("shows while it's written, collapses when done, and a late toggle still works", () => {
		initTheme("dark");
		showThinkingWhileLive(() => true);
		const view = new AssistantMessageComponent(undefined, true, undefined, label);
		view.updateContent(message, true);
		expect(plain(view)).toContain("SECRETPLAN");
		view.updateContent(message, false);
		expect(plain(view)).not.toContain("SECRETPLAN");
		expect(plain(view)).toContain(label);
		view.setHideThinkingBlock(false);
		expect(plain(view)).toContain("SECRETPLAN");
	});
});
