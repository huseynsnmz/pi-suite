import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PtyAttachComponent } from "../src/ui/pty-attach.ts";
import { ensureNodePtySpawnHelperExecutable } from "../src/core/pty-support.mjs";

const require = createRequire(import.meta.url);
ensureNodePtySpawnHelperExecutable(require);
const pty = require("node-pty") as typeof import("node-pty");
const root = mkdtempSync(join(tmpdir(), "agent-board-startup-color-"));
const query = "\x1b]11;?\x07";
const reply = "\x1b]11;rgb:2887/2a18/353c\x1b\\";
const echoedReply = "^[]11;rgb:2887/2a18/353c^[\\";
const schemeReport = "\x1b[?997;1n";
const readyPath = join(root, "ready");
const stopPath = join(root, "stop");
// Keep canonical/echo mode until the fixture explicitly releases startup.
// Like Pi, switch to raw mode BEFORE enabling bracketed paste. Split the
// enable sequence across writes to exercise the real streaming parser.
const child = pty.spawn(process.execPath, ["-e", `
const fs = require("node:fs");
process.stdout.write("BOOTING\\r\\n");
let started = false;
const timer = setInterval(() => {
	if (started) {
		if (!fs.existsSync(${JSON.stringify(stopPath)})) return;
		clearInterval(timer);
		process.stdout.write("\\x1b[?2004l");
		process.stdin.setRawMode(false);
		process.stdout.write("STOPPED\\r\\n");
		return;
	}
	if (!fs.existsSync(${JSON.stringify(readyPath)})) return;
	started = true;
	process.stdin.setRawMode(true);
	process.stdin.on("data", data => process.stdout.write("INPUT:" + data.toString("hex") + "\\r\\n"));
	process.stdout.write("\\x1b[?20");
	setTimeout(() => process.stdout.write("04hREADY\\r\\n"), 20);
}, 10);
`], {
	name: "xterm-256color",
	cols: 80,
	rows: 24,
	cwd: root,
	env: process.env,
});
let output = "";
let attach: PtyAttachComponent | undefined;
const dataSubscription = child.onData((data) => {
	output += data;
	// SAFETY: Feed the real private output path; only the control socket is replaced.
	(attach as unknown as { pushOutput: (data: string, opts: { forwardProtocols: boolean }) => void } | undefined)
		?.pushOutput(data, { forwardProtocols: true });
});
const childExit = new Promise<void>((resolve) => child.onExit(() => resolve()));

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 5000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(`timed out waiting for PTY output: ${JSON.stringify(output.slice(-2000))}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

try {
	await waitFor(() => output.includes("BOOTING"));
	const writes: string[] = [];
	const sent: string[] = [];
	// The tracked API returns immediately, well before child startup finishes.
	let schemeListener: ((scheme: "light" | "dark") => void) | undefined;
	const tui = {
		terminal: {
			rows: 24, cols: 80, columns: 80,
			write: (data: string) => {
				writes.push(data);
				if (data === query) attach?.handleInput(reply);
			},
		},
		requestRender: () => {},
		onTerminalColorSchemeChange: (listener: typeof schemeListener) => {
			schemeListener = listener;
			return () => { schemeListener = undefined; };
		},
		queryTerminalColors: async () => ({ background: { r: 41, g: 41, b: 54 } }),
	};
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
	attach = new PtyAttachComponent(tui as never, theme, {} as never, () => {}, {
		socketPath: join(root, "missing.sock"), title: "startup-color",
	});
	// SAFETY: These are the production component's private methods; only the
	// socket transport is replaced so input reaches the real canonical PTY.
	const internals = attach as unknown as {
		send: (message: { type: string; data?: string }) => void;
		finishAttachTransition: () => void;
		connected: boolean;
	};
	internals.send = (message) => {
		if (message.type !== "input" || !message.data) return;
		sent.push(message.data);
		child.write(message.data);
	};
	internals.connected = true;
	internals.finishAttachTransition();
	internals.finishAttachTransition();
	await new Promise((resolve) => setImmediate(resolve));
	// Real-terminal notifications must obey the same gate and coalesce to
	// the latest scheme rather than queueing several startup input packets.
	schemeListener?.("light");
	schemeListener?.("dark");
	await new Promise((resolve) => setTimeout(resolve, 100));
	const result = {
		settleQueries: writes.filter((data) => data === query).length,
		settleInput: [...sent],
		startupOutput: output,
		canonicalEchoReproduced: false,
		schemeEchoReproduced: false,
		readyInput: [] as string[],
		rawInputReceived: false,
	};
	// Now let the actual child enter raw mode. Its live enable sequence must
	// release exactly one queued report, consumed as input rather than echoed.
	writeFileSync(readyPath, "ready");
	await waitFor(() => output.includes("INPUT:" + Buffer.from(schemeReport).toString("hex")));
	result.readyInput = sent.filter((data) => data.startsWith("\x1b[?997;"));
	result.rawInputReceived = true;
	// Positive controls run AFTER delivery, so their canonical input cannot
	// contaminate the raw-mode assertion. Both fragments must really echo on
	// this same PTY once the child returns to canonical mode.
	writeFileSync(stopPath, "stop");
	await waitFor(() => output.includes("STOPPED"));
	tui.terminal.write(query);
	await waitFor(() => output.includes(echoedReply));
	result.canonicalEchoReproduced = true;
	child.write(schemeReport);
	await waitFor(() => output.includes("^[[?997;1n"));
	result.schemeEchoReproduced = true;
	console.log(JSON.stringify(result));
} finally {
	attach?.dispose();
	child.kill();
	await childExit;
	dataSubscription.dispose();
	rmSync(root, { recursive: true, force: true });
}
