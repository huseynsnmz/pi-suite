import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../test-support/attach-scheme-readiness-smoke.ts", import.meta.url));

test("scheme reports require current child readiness, survive reload, and stop at teardown", () => {
	const out = JSON.parse(execFileSync(process.execPath, ["--experimental-transform-types", script], {
		encoding: "utf8", timeout: 15000,
	}));
	assert.deepEqual(out.historyInput, [], "historical raw-mode output is not a readiness handshake");
	assert.deepEqual(out.historyDiagnostics, [], "a deferred report must not claim successful delivery");
	assert.deepEqual(out.historyThenLiveInput, [], "live boot text must not inherit historical paste mode");
	assert.deepEqual(out.emptySnapshotInput, [], "an empty snapshot plus boot output remains unready");
	assert.deepEqual(out.partialEnableInput, [], "a split enable sequence must be complete before delivery");
	assert.deepEqual(out.readyInput, ["\x1b[?997;2n"], "late replies replace the pending startup scheme");
	assert.equal(out.readyDiagnostics.at(-1).details.outcome, "reported");
	assert.equal(out.readyDiagnostics.at(-1).details.late, true);
	assert.deepEqual(out.repeatedOutputInput, out.readyInput, "pending reports flush once only");
	assert.deepEqual(out.stoppedInput, out.readyInput, "notifications and late replies wait during shutdown/reload");
	assert.deepEqual(out.restartedInput, ["\x1b[?997;2n", "\x1b[?997;2n"], "only the latest queued scheme reaches the restarted editor");
	assert.deepEqual(out.warmSnapshotInput, ["\x1b[?997;1n"], "a current snapshot permits delivery to an existing raw-mode editor");
	assert.deepEqual(out.closedInput, [], "closing discards pending reports, including late callbacks");
});
