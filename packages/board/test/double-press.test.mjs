import assert from "node:assert/strict";
import test from "node:test";
import { createDoublePress, DOUBLE_PRESS_MS } from "../src/core/double-press.mjs";

function clocked() {
	let t = 1_000;
	return { presses: createDoublePress(() => t), wait: (ms) => (t += ms) };
}

test("a second press in time counts, and the one after it starts over", () => {
	const { presses, wait } = clocked();
	assert.equal(presses.press(), false);
	wait(DOUBLE_PRESS_MS);
	assert.equal(presses.press(), true);
	assert.equal(presses.press(), false);
});

test("a press too late, or after a reset, is a first press again", () => {
	const { presses, wait } = clocked();
	presses.press();
	wait(DOUBLE_PRESS_MS + 1);
	assert.equal(presses.press(), false);
	presses.reset();
	assert.equal(presses.press(), false);
});
