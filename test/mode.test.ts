import { expect, test } from "bun:test";

import { fakePi } from "@adeildo/pi-kit/testing";
import { createApp } from "@adeildo/pi-kit";

import { frameColorOf, modeOf } from "../src/data/mode.ts";
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

test("the start card only promises what the keys do", () => {
	const shown = (modes: boolean, sandbox: "on" | "off" | undefined) =>
		hints(modes, sandbox).map((hint) => hint.key);
	expect(shown(true, "on")).toContain("/sandbox-disable");
	expect(shown(true, "off")).toContain("/sandbox-enable");
	const plain = hints(false, undefined).map((hint) => hint.does);
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
