import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import xtermHeadless from "@xterm/headless";

const { Terminal } = xtermHeadless;
const SMOKE_SCRIPT = new URL("../test-support/hyperlink-cell-smoke.ts", import.meta.url);
const projections = JSON.parse(execFileSync(process.execPath, ["--experimental-transform-types", fileURLToPath(SMOKE_SCRIPT)], {
	encoding: "utf8",
	timeout: 30_000,
}));

async function linkedText(lines) {
	const terminal = new Terminal({ cols: 80, rows: 12, allowProposedApi: true });
	try {
		const data = lines.map((line) => line.replaceAll("\x1b_pi:c\x07", "")).join("\r\n");
		await new Promise((resolve) => terminal.write(data, resolve));
		const spans = [];
		for (let row = 0; row < terminal.buffer.active.length; row++) {
			const line = terminal.buffer.active.getLine(row);
			let span;
			for (let col = 0; col < line.length; col++) {
				// Fresh cells keep the assertion independent of the reusable-cell bug.
				const cell = line.getCell(col);
				if (cell.getWidth() === 0) continue;
				const id = cell.extended?.urlId ?? 0;
				const url = terminal._core._oscLinkService.getLinkData(id)?.uri;
				if (!url) {
					span = undefined;
					continue;
				}
				if (!span || span.url !== url) {
					span = { url, text: "" };
					spans.push(span);
				}
				span.text += cell.getChars() || " ";
			}
		}
		return spans;
	} finally {
		terminal.dispose();
	}
}

test("attach confines read hyperlinks to the filename, not adjacent text or later rows", async () => {
	for (const lines of projections.read) {
		assert.deepEqual(await linkedText(lines), [{
			url: "file:///tmp/bin/with-test-lock",
			text: "bin/with-test-lock",
		}]);
	}
});

test("attach preserves distinct hyperlinks without linking ordinary underlined text", async () => {
	for (const lines of projections.multiple) {
		assert.deepEqual(await linkedText(lines), [
			{ url: "file:///tmp/first", text: "first" },
			{ url: "file:///tmp/second", text: "second" },
		]);
		assert.match(lines.find((line) => line.includes("ordinary underline")), /\x1b\[[\d;]*;4(?:;|m)/);
	}
});
