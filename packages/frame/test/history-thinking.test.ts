import { describe, expect, test } from "bun:test";

import { AssistantMessageComponent, initTheme, SettingsManager } from "@earendil-works/pi-coding-agent";

import { startPrefix, stepPrefix } from "../src/ui/history-search.ts";
import { collapseThinkingByDefault, showThinkingWhileLive } from "../src/ui/thinking.ts";

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
	test("collapses unless you've chosen otherwise, and only with the frame on", () => {
		let on = true;
		collapseThinkingByDefault(() => on);
		const unset = SettingsManager.inMemory();
		expect(unset.getHideThinkingBlock()).toBe(true);
		expect(SettingsManager.inMemory({ hideThinkingBlock: false }).getHideThinkingBlock()).toBe(false);
		expect(SettingsManager.inMemory({ hideThinkingBlock: true }).getHideThinkingBlock()).toBe(true);
		unset.setHideThinkingBlock(false);
		expect(unset.getHideThinkingBlock()).toBe(false);
		on = false;
		expect(SettingsManager.inMemory().getHideThinkingBlock()).toBe(false);
		on = true;
	});

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
