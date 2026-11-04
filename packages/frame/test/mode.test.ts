import { expect, test } from "bun:test";

import { fakePi } from "../src/kit/testing.ts";
import { createApp } from "../src/kit/index.ts";

import { frameColorOf, modeOf, SENT_IN_ENTRY, sentInFromEntries } from "../src/data/mode.ts";
import { frameFeature } from "../src/index.ts";
import { hints } from "../src/ui/header.ts";

const status = (text: string) => new Map([["pi-modes", text]]);

test.each([
	["normal", undefined],
	["auto", "warning"],
	["plan", "accent"],
	["read-only", "success"],
	["yolo", "error"],
])("the frame in %s mode is %s", (mode, color) => {
	expect(modeOf(status(`\u001b[33mmode: ${mode}\u001b[39m`))).toBe(mode as "auto");
	expect(frameColorOf(status(`mode: ${mode}`))).toBe(color as "accent");
});

test("anything else leaves the frame alone", () => {
	expect(frameColorOf(new Map())).toBeUndefined();
	expect(frameColorOf(status("mode: sideways"))).toBeUndefined();
});

test("a saved session gives each message back its mode, and ignores anything else", () => {
	const saved = (data: unknown) => ({ type: "custom", customType: SENT_IN_ENTRY, data });
	const user = (id: string, timestamp: number) => ({ type: "message", id, message: { role: "user", timestamp } });
	const sent = sentInFromEntries([
		saved({ at: 1, mode: "auto" }),
		user("first", 1),
		user("plain", 2),
		saved({ at: 3, mode: "sideways" }),
		user("bad", 3),
		saved(undefined),
		{ type: "custom", customType: "other", data: { at: 4, mode: "yolo" } },
		user("other", 4),
	]);
	expect([...sent]).toEqual([["first", "auto"]]);
});

test("the start card only promises what the keys do", () => {
	const plain = hints(false).map((hint) => hint.does);
	expect(plain).toEqual(["commands", "model", "settings"]);
});

function effortCommand() {
	const fake = fakePi();
	let level = "medium";
	const pi = fake.pi as unknown as Record<string, unknown>;
	pi.getThinkingLevel = () => level;
	pi.setThinkingLevel = (next: string) => {
		level = next === "max" ? "high" : next;
	};
	createApp(fake.pi, { name: "frame" }).use(frameFeature).build();
	const notes: [string, string][] = [];
	const ctx = {
		ui: {
			notify: (text: string, kind: string) => notes.push([text, kind]),
			select: async () => "low",
		},
	};
	const run = (args: string) => fake.commands.get("effort")?.handler(args, ctx as never);
	return { run, notes, level: () => level, command: fake.commands.get("effort") };
}

test("/effort sets the level you name, or the one you pick", async () => {
	const effort = effortCommand();
	await effort.run(" HIGH ");
	expect(effort.level()).toBe("high");
	await effort.run("");
	expect(effort.level()).toBe("low");
});

test("/effort says so when the model can't, and refuses a word it doesn't know", async () => {
	const effort = effortCommand();
	await effort.run("max");
	expect(effort.notes.at(-1)).toEqual(["This model can't use max, so effort is high", "warning"]);
	await effort.run("sideways");
	expect(effort.level()).toBe("high");
	expect(effort.notes.at(-1)?.[1]).toBe("error");
});

test("/effort completes level names", () => {
	const { command } = effortCommand();
	expect(command?.getArgumentCompletions?.("m")).toEqual([
		{ value: "minimal", label: "minimal" },
		{ value: "medium", label: "medium" },
		{ value: "max", label: "max" },
	]);
	expect(command?.getArgumentCompletions?.("zz")).toBeNull();
});
