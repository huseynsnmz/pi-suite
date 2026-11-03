import { describe, expect, test } from "bun:test";

import { keyLabel } from "../src/render/keys.ts";
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

test("key labels say Option on a Mac", () => {
	expect(keyLabel("alt+s", "darwin")).toBe("option+s");
	expect(keyLabel("alt+s", "linux")).toBe("alt+s");
	expect(keyLabel("shift+tab", "darwin")).toBe("shift+tab");
});
