import { describe, expect, test } from "bun:test";

import { matchesKey } from "@earendil-works/pi-tui";

import { cmdAsAlt, keyLabel } from "../src/render/keys.ts";
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
	expect(keyLabel("alt+s", "darwin", false)).toBe("option+s");
	expect(keyLabel("alt+s", "darwin", true)).toBe("cmd+s");
	expect(keyLabel("alt+g", "darwin", true)).toBe("option+g");
	expect(keyLabel("alt+s", "linux", true)).toBe("alt+s");
	expect(keyLabel("shift+tab", "darwin", true)).toBe("shift+tab");
});

test("Cmd+S arrives as Alt+S, and other Cmd keys stay out of it", () => {
	expect(matchesKey(cmdAsAlt("\u001b[115;9u") ?? "", "alt+s")).toBe(true);
	expect(matchesKey(cmdAsAlt("\u001b[111;9u") ?? "", "alt+o")).toBe(true);
	expect(cmdAsAlt("\u001b[99;9u")).toBeUndefined();
	expect(cmdAsAlt("s")).toBeUndefined();
});
