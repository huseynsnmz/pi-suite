import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const PROBE = join(ROOT_DIR, "test-support", "dashboard-delete-key-probe.ts");

// One probe run feeds every assertion below.
const report = JSON.parse(
	execFileSync(process.execPath, ["--experimental-transform-types", PROBE], {
		encoding: "utf8",
		timeout: 60_000,
	}),
);

test("typed x is text, not a delete", () => {
	assert.equal(report.typing.mode, "dispatch");
	assert.equal(report.typing.input, "x");
	assert.deepEqual(report.typing.archived, []);
});

test("ctrl+x twice on an inactive row deletes it with no confirm step", () => {
	assert.match(report.double.armed, /Press ctrl\+x again/);
	assert.equal(report.double.mode, "list");
	assert.deepEqual(report.double.archived, ["v1"]);
});

test("another key between presses disarms it", () => {
	assert.deepEqual(report.disarmed.archived, []);
});

test("ctrl+x on a live row stops it first", () => {
	assert.equal(report.live.stopped.length, 1);
	assert.deepEqual(report.live.archivedAfterFirst, []);
});

test("multi-select keeps its confirm", () => {
	assert.equal(report.selectMode.ctrlX.mode, "confirm");
	assert.match(report.selectMode.ctrlX.prompt, /^Delete 1 done session\? Session files are preserved\. \(y\/N\)$/);
	assert.equal(report.selectMode.ctrlX.returnMode, "select");
	assert.deepEqual(report.selectMode.archived, []);
	assert.deepEqual(report.selectMode.archiveManyCalls, [[report.selectMode.target]]);
});
