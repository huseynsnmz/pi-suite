import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const out = JSON.parse(
	execFileSync(process.execPath, ["--experimental-transform-types", join(ROOT_DIR, "test-support", "dashboard-keys-probe.ts")], {
		encoding: "utf8",
		timeout: 60_000,
	}),
);

test("typing goes straight into the task, whatever the letter", () => {
	assert.deepEqual(out.typing, { mode: "dispatch", input: "j", selected: true });
	assert.equal(out.emptied, "list");
	assert.deepEqual(out.escClears, { mode: "list", input: "" });
});

test("enter starts the task with no dialog", () => {
	assert.equal(out.started.mode, "list");
	assert.equal(out.started.dispatched.length, 1);
	assert.equal(out.started.dispatched[0].text, "go");
});

test("rows move with the arrows and page keys", () => {
	assert.deepEqual(out.moves, [1, 0, 2, 0, 2, 0]);
});

test("enter, both arrows and alt+number attach", () => {
	for (const key of ["\r", "\x1b[C", "\x1b[D", "\x1b1"]) {
		assert.deepEqual(out[`attach ${JSON.stringify(key)}`], ["attach"], JSON.stringify(key));
	}
});

test("the shortcuts open what they say", () => {
	assert.deepEqual(out.modes, {
		peek: "peek", filter: "filter", find: "filter", help: "help", pty: "ptyHelp",
		select: "select", session: "session", evidence: "evidence", rename: "rename",
	});
});

test("space closes peek, and typing there is a reply", () => {
	assert.equal(out.peek.opened, "peek");
	assert.equal(out.peek.closed, "list");
	assert.deepEqual(out.peek.reply, { mode: "reply", input: "hi" });
});

test("esc leaves at once, and ctrl+c takes two presses", () => {
	assert.deepEqual(out.esc, ["exit"]);
	assert.equal(out.ctrlC.once, 0);
	assert.deepEqual(out.ctrlC.twice, ["exit"]);
});

test("it's drawn in frames, with the keys on the bottom edge", () => {
	assert.match(out.frame.top, /^╭─ π-board \S+ ─+ .* ─╮$/);
	assert.equal(out.frame.card, true);
	assert.match(out.frame.hints, /^╰─ enter .*space peek.*\/ filter.*─╯$/);
});

test("the session on screen is never prewarmed", () => {
	assert.equal(out.prewarmedCurrent, false);
});

test("ctrl+s switches between state and directory groups", () => {
	assert.equal(out.grouping.before, false);
	assert.equal(out.grouping.after, true);
	assert.equal(out.grouping.summaryNamesState, true);
	assert.equal(out.groupingBack, true);
});

test("shift+arrows swap neighbors, and it survives reopening", () => {
	const { before, after, lasting } = out.reorder;
	assert.deepEqual(after, [before[1], before[0], before[2]]);
	assert.equal(out.reorder.selected, before[0]);
	assert.deepEqual(lasting, after);
	assert.deepEqual(out.reorderBack, before);
});

test("a dialog during a run shows as waiting, and closing it clears that", () => {
	assert.equal(out.waiting.state, "needs_input");
	assert.match(out.waiting.question, /Attach to answer/);
	assert.equal(out.waiting.resumed, "working");
	assert.equal(out.waiting.cleared, null);
});

test("ctrl+g edits the task in the external editor", () => {
	assert.equal(out.editor.input, "draft edited");
	assert.equal(out.editor.mode, "dispatch");
	assert.deepEqual(out.editor.stops, ["stop", "start"]);
});

test("a reply during a dialog waits in the queue, so it can't answer the dialog", () => {
	assert.deepEqual(out.replyDuringDialog, { queuedDuringDialog: true, pendingWhileWaiting: 1, pendingAfter: 0 });
});
