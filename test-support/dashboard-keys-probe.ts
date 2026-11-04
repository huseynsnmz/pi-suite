// Drives the board's keys through handleInput() and reports what they did, as JSON.
// Run via `node --experimental-transform-types`. Not typechecked.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createService } from "../src/runtime/service.mjs";
import { createView } from "../src/core/store.mjs";
import { DashboardComponent } from "../src/ui/dashboard.ts";

const root = mkdtempSync(join(tmpdir(), "board-keys-"));
for (const [id, name] of [["v1", "one"], ["v2", "two"], ["v3", "three"]]) createView(root, { id, name, cwd: root });
const dispatched = [];
const real = createService({
	root,
	runnerScript: "/no/runner.mjs",
	piCommand: "pi",
	piArgsPrefix: [],
	defaultCwd: root,
	launch: () => ({ pid: null, configPath: "/no/config.json" }),
	launchHost: () => ({ pid: null, configPath: "/no/host-config.json" }),
	launchTitle: () => ({ pid: null, configPath: "/no/title-config.json" }),
});
const service = Object.create(real);
service.dispatch = async (text, options) => {
	dispatched.push({ text, cwd: options.cwd });
	return { ok: true, viewId: "v1", hostMode: "pty" };
};

const tui = { terminal: { rows: 24, cols: 80, columns: 80, write: () => {} }, requestRender: () => {} };
const theme = { fg: (_c, t) => t, bold: (t) => t, bg: (_c, t) => t };
const results = [];
const make = (extra = {}) =>
	new DashboardComponent(tui, theme, { matches: () => false }, (r) => results.push(r), {
		service, root, defaultCwd: root, availableModels: [], currentModel: null, currentThinkingLevel: "off", ...extra,
	});
const press = (dash, ...keys) => { for (const key of keys) dash.handleInput(key); };
const out = {};

{
	const dash = make();
	press(dash, "j");
	out.typing = { mode: dash.mode, input: dash.input, selected: dash.selectedId === dash.orderedIds[0] };
	press(dash, "\x7f");
	out.emptied = dash.mode;
	press(dash, "ab", "\x1b");
	out.escClears = { mode: dash.mode, input: dash.input };
	press(dash, "go", "\r");
	await new Promise((r) => setTimeout(r, 20));
	out.started = { mode: dash.mode, dispatched: [...dispatched] };
	dash.dispose();
}
{
	const dash = make();
	const ids = dash.orderedIds;
	const at = () => ids.indexOf(dash.selectedId);
	const moves = [];
	press(dash, "\x1b[B"); moves.push(at());
	press(dash, "\x1b[A"); moves.push(at());
	press(dash, "\x1b[F"); moves.push(at());
	press(dash, "\x1b[H"); moves.push(at());
	press(dash, "\x1b[6~"); moves.push(at());
	press(dash, "\x1b[5~"); moves.push(at());
	out.moves = moves;
	for (const key of ["\r", "\x1b[C", "\x1b[D", "\x1b1"]) {
		results.length = 0;
		press(dash, key);
		out[`attach ${JSON.stringify(key)}`] = results.map((r) => r.action);
		dash.mode = "list";
	}
	const modes = {};
	for (const [name, key] of [["peek", " "], ["filter", "/"], ["find", "\x06"], ["help", "?"], ["pty", "!"], ["select", "\x01"], ["session", "\x0f"], ["evidence", "\x05"], ["rename", "\x12"]]) {
		press(dash, key);
		modes[name] = dash.mode;
		dash.mode = "list";
		dash.setInput("");
	}
	out.modes = modes;
	dash.dispose();
}
{
	const dash = make();
	press(dash, " ");
	const opened = dash.mode;
	press(dash, " ");
	const closed = dash.mode;
	press(dash, " ", "h", "i");
	out.peek = { opened, closed, reply: { mode: dash.mode, input: dash.input } };
	dash.dispose();
}
{
	results.length = 0;
	const dash = make();
	press(dash, "\x03");
	const once = results.length;
	press(dash, "\x03");
	out.ctrlC = { once, twice: results.map((r) => r.action) };
	results.length = 0;
	const again = make();
	press(again, "\x1b");
	out.esc = results.map((r) => r.action);
	dash.dispose();
	again.dispose();
}
{
	const dash = make();
	const lines = dash.render(120);
	out.frame = { top: lines[0], card: lines.some((l) => l.startsWith("╭─ new session")), hints: lines.find((l) => l.startsWith("╰─ enter")) ?? null };
	dash.dispose();
}
{
	// The session on screen must not get a second Pi started on its file.
	const file = "/some/session.jsonl";
	const row = real.rows()[0];
	const rows = real.rows();
	const wrapped = Object.create(service);
	const prewarmed = [];
	wrapped.rows = () => rows.map((r) => (r.meta.id === row.meta.id ? { ...r, meta: { ...r.meta, sessionFile: file } } : r));
	wrapped.prewarmHost = (id) => { prewarmed.push(id); return { ok: true }; };
	const dash = make({ service: wrapped, currentSessionFile: file });
	dash.selectedId = row.meta.id;
	dash.prewarmSelected();
	out.prewarmedCurrent = prewarmed.includes(row.meta.id);
	dash.dispose();
}
console.log(JSON.stringify(out));
