import { describe, expect, test } from "bun:test";

import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";

import { cmdAsKey, SETTINGS_SHORTCUT, SETTINGS_SHORTCUT_INPUT, keyLabel } from "../src/render/keys.ts";
import { fitNames } from "../src/ui/header.ts";
import { EXIT_WINDOW_MS, nextInterrupt } from "../src/ui/interrupt.ts";

describe("Ctrl+C", () => {
	test("stops a run without arming the exit", () => {
		const step = nextInterrupt({ armedUntil: 100 }, false, 0);
		expect(step.action).toBe("abort");
		expect(step.state).toEqual({});
	});

	test("when idle, the first press warns and the second exits", () => {
		const first = nextInterrupt({}, true, 0);
		expect(first.action).toBe("arm");
		expect(nextInterrupt(first.state, true, EXIT_WINDOW_MS - 1).action).toBe("exit");
	});

	test("a press after the window warns again", () => {
		const first = nextInterrupt({}, true, 0);
		expect(nextInterrupt(first.state, true, EXIT_WINDOW_MS).action).toBe("arm");
	});
});

test("key labels name the key that works", () => {
	expect(keyLabel("ctrl+s", "darwin", false)).toBe("ctrl+s");
	expect(keyLabel("ctrl+s", "darwin", true)).toBe("cmd+s");
	expect(keyLabel("alt+s", "darwin", true)).toBe("option+s");
	expect(keyLabel("alt+o", "darwin", true)).toBe("cmd+o");
	expect(keyLabel("alt+g", "darwin", true)).toBe("option+g");
	expect(keyLabel("alt+s", "linux", true)).toBe("alt+s");
	expect(keyLabel("shift+tab", "darwin", true)).toBe("shift+tab");
});

test("the settings shortcut is reached with and without the kitty protocol", () => {
	expect(matchesKey(SETTINGS_SHORTCUT_INPUT, SETTINGS_SHORTCUT)).toBe(true);
});

test("Cmd+S opens the settings without reaching for pi-sandbox's Alt+S", () => {
	expect(matchesKey(cmdAsKey("\u001b[115;9u") ?? "", "ctrl+s")).toBe(true);
	expect(matchesKey(cmdAsKey("\u001b[111;9u") ?? "", "alt+o")).toBe(true);
	expect(cmdAsKey("\u001b[99;9u")).toBeUndefined();
	expect(cmdAsKey("s")).toBeUndefined();
});

test("a row of names ends in how many did not fit", () => {
	expect(fitNames(["ab", "cd"], 20)).toBe("ab, cd");
	expect(fitNames(["ab", "cd", "ef", "gh"], 10)).toBe("ab, cd, +2");
	expect(visibleWidth(fitNames(["abcdefghijklmnop", "cd"], 8))).toBeLessThanOrEqual(8);
});
