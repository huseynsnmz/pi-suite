// Real Pi with a fake model, in a real terminal: what the fakes in the other attach tests can't show.
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const pty = require("node-pty");
const { Terminal } = require("@xterm/headless");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Takes Shift+Tab the way pi-modes does, and shows how many it got.
const KEY_TAKER = `
import { matchesKey } from "@earendil-works/pi-tui";
export default function (pi) {
	let taken = 0;
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setStatus("taker", "taken:" + taken);
		ctx.ui.onTerminalInput((data) => {
			if (!matchesKey(data, "shift+tab")) return undefined;
			ctx.ui.setStatus("taker", "taken:" + ++taken);
			return { consume: true };
		});
	});
}`;

async function startModel() {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			for (const choice of [{ delta: { role: "assistant", content: "OK" } }, { delta: {}, finish_reason: "stop" }]) {
				res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, ...choice }] })}\n\n`);
			}
			res.end("data: [DONE]\n\n");
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return server;
}

function startPi(root, port, { shell = false } = {}) {
	const home = join(root, "h");
	const agent = join(home, ".pi/agent");
	const project = join(root, "p");
	// Short, since the sockets live in here and macOS limits their path.
	const board = join(root, "b");
	mkdirSync(agent, { recursive: true });
	mkdirSync(project);
	const taker = join(REPO, `test-support/.key-taker-${process.pid}.mjs`);
	writeFileSync(taker, KEY_TAKER);
	writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: { mock: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "unused", api: "openai-completions", models: [{ id: "m", name: "Mock", contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	writeFileSync(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "mock", defaultModel: "m", defaultThinkingLevel: "off", packages: [REPO], extensions: [taker] }));
	const term = new Terminal({ cols: 120, rows: 45, allowProposedApi: true });
	// Only a shell with job control can stop and resume what it runs.
	const [file, args] = shell ? ["/bin/bash", ["--norc", "--noprofile", "-i"]] : [join(REPO, "node_modules/.bin/pi"), []];
	const child = pty.spawn(file, args, {
		name: "xterm-256color",
		cols: 120,
		rows: 45,
		cwd: project,
		env: { PATH: `${join(REPO, "node_modules/.bin")}:${process.env.PATH}`, PS1: "SHELL$ ", BASH_SILENCE_DEPRECATION_WARNING: "1", HOME: home, TERM: "xterm-256color", LANG: "en_US.UTF-8", PI_CODING_AGENT_DIR: agent, PI_SKIP_VERSION_CHECK: "1", PI_OFFLINE: "1", TMPDIR: tmpdir(), AGENT_BOARD_ROOT: board },
	});
	child.onData((data) => term.write(data));
	const screen = () => {
		const buf = term.buffer.active;
		return Array.from({ length: term.rows }, (_, i) => buf.getLine(buf.viewportY + i)?.translateToString(true) ?? "").join("\n");
	};
	const waitFor = async (text, ms = 30000) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (screen().includes(text)) return;
			await sleep(50);
		}
		assert.fail(`never saw ${JSON.stringify(text)} on:\n${screen()}`);
	};
	const resize = (cols, rows) => {
		term.resize(cols, rows);
		child.resize(cols, rows);
	};
	return { child, screen, waitFor, resize, taker, board };
}

test("an attached session gets every key, and redraws at a new size each time it's attached", { timeout: 300000 }, async (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "rp-")));
	const model = await startModel();
	const pi = startPi(root, model.address().port);
	t.after(() => {
		pi.child.kill();
		model.close();
		rmSync(pi.taker, { force: true });
		try {
			execSync(`pkill -f ${root}`);
		} catch {
			/* Nothing left running. */
		}
		rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});
	await pi.waitFor("taken:0", 60000);
	pi.child.write("/agent-board\r");
	await pi.waitFor("π-board");
	await sleep(500);
	pi.child.write("\x1b[Z");
	await sleep(500);
	pi.child.write("hello");
	await sleep(300);
	pi.child.write("\r");
	await pi.waitFor("hosts:1");
	await sleep(3000);

	pi.child.write("\x1b[C");
	await pi.waitFor("taken:0");
	pi.child.write("\x1b[Z");
	await pi.waitFor("taken:1");

	// Each of these is an attach to a host that has already been resized.
	for (const [cols, rows] of [[90, 30], [130, 40]]) {
		pi.child.write("\x1c");
		await pi.waitFor("π-board");
		pi.resize(cols, rows);
		await sleep(500);
		pi.child.write("\x1b[C");
		await pi.waitFor("taken:1");
		assert.equal(pi.screen().split("\n").filter((line) => /^─{20,}$/.test(line.trimEnd())).at(-1)?.trimEnd().length, cols);
		pi.resize(cols + 4, rows + 1);
		await sleep(1500);
		assert.match(pi.screen(), /taken:1/);
		assert.doesNotMatch(pi.screen(), /waiting for the session to render/);
		pi.resize(cols, rows);
		await sleep(1000);
	}

	// The Pi behind them never got Shift+Tab, on the board or attached.
	pi.child.write("\x1c");
	await pi.waitFor("π-board");
	pi.child.write("\x1b");
	await pi.waitFor("taken:0");
	assert.equal((statSync(pi.board).mode & 0o777).toString(8), "700");
});

test("ctrl+z stops only this Pi, from the board and attached, and fg brings the view back", { timeout: 120000 }, async (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "rp-")));
	const model = await startModel();
	const pi = startPi(root, model.address().port, { shell: true });
	t.after(() => {
		pi.child.kill();
		model.close();
		rmSync(pi.taker, { force: true });
		try {
			execSync(`pkill -f ${root}`);
		} catch {
			/* Nothing left running. */
		}
		rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});
	await pi.waitFor("SHELL$");
	pi.child.write("pi\r");
	await pi.waitFor("taken:0", 60000);
	pi.child.write("/agent-board\r");
	await pi.waitFor("π-board");
	await sleep(500);
	pi.child.write("\x1a");
	await pi.waitFor("Stopped");
	pi.child.write("fg\r");
	await pi.waitFor("π-board");

	pi.child.write("hello");
	await sleep(300);
	pi.child.write("\r");
	await pi.waitFor("hosts:1");
	await sleep(3000);
	pi.child.write("\x1b[C");
	await pi.waitFor("detach");
	await pi.waitFor("taken:0");
	pi.child.write("\x1a");
	await pi.waitFor("Stopped");
	await sleep(300);
	pi.child.write("fg\r");
	await pi.waitFor("detach");
	await pi.waitFor("taken:0");
	// The session itself was never stopped, so it still takes what's typed.
	pi.child.write("typed-after-resume");
	await pi.waitFor("typed-after-resume");
});
