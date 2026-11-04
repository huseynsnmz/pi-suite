import assert from "node:assert/strict";
import test from "node:test";
import { holdInputListeners } from "../src/core/hold-input.mjs";

const offer = (tui, data) => [...tui.inputListeners].map((listener) => listener(data));

test("while held, no listener sees a key, and release gives them back", () => {
	const seen = [];
	const tui = { inputListeners: new Set([(data) => seen.push(data)]) };
	const release = holdInputListeners(tui);
	assert.equal(tui.inputListeners.size, 0);
	offer(tui, "held");
	release();
	release();
	offer(tui, "free");
	assert.deepEqual(seen, ["free"]);
});

test("listeners added or removed while held apply after release", () => {
	const kept = () => "kept";
	const removed = () => "removed";
	const added = () => "added";
	const tui = { inputListeners: new Set([kept, removed]) };
	const release = holdInputListeners(tui);
	tui.inputListeners.add(added);
	tui.inputListeners.delete(removed);
	release();
	assert.deepEqual(offer(tui, "x"), ["kept", "added"]);
});

test("fullscreen Pi keeps its own mouse handling, and only that", () => {
	const seen = [];
	const tui = { handleViewportInput() {}, inputListeners: new Set([() => seen.push("pi"), () => seen.push("extension")]) };
	const release = holdInputListeners(tui);
	offer(tui, "x");
	assert.deepEqual(seen, ["pi"]);
	release();
	offer(tui, "x");
	assert.deepEqual(seen, ["pi", "pi", "extension"]);
});

test("a TUI without the listener set is left alone", () => {
	const tui = {};
	holdInputListeners(tui)();
	assert.deepEqual(tui, {});
	assert.doesNotThrow(() => holdInputListeners(undefined)());
});
