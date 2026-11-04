// Drives the board's keys through handleInput() and reports what they did, as JSON.
// Run via `node --experimental-transform-types`. Not typechecked.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createService } from "../src/runtime/service.mjs";
import { createView } from "../src/core/store.mjs";
import { DashboardComponent } from "../src/ui/dashboard.ts";

const root = mkdtempSync(join(tmpdir(), "board-keys-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
const fakeEditor = join(root, "edit.sh");
writeFileSync(fakeEditor, '#!/bin/sh\necho " edited" >> "$1"\n', { mode: 0o755 });
process.env.VISUAL = fakeEditor;
delete process.env.EDITOR;
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
	for (const [name, key] of [["peek", " "], ["filter", "\x06"], ["help", "?"], ["pty", "!"], ["select", "\x01"], ["session", "\x0f"], ["evidence", "\x05"], ["rename", "\x12"]]) {
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
	results.length = 0;
	const dash = make();
	press(dash, "x", "\x03", "\x03");
	out.ctrlCFromTyping = results.map((r) => r.action);
	dash.dispose();
}
{
	const commands = [
		{ name: "model", description: "Select model", source: "builtin" },
		{ name: "tldr", source: "prompt" },
	];
	const settle = () => new Promise((r) => setTimeout(r, 150));
	results.length = 0;
	dispatched.length = 0;
	const dash = make({ commands });
	press(dash, "/");
	await settle();
	const slashMode = dash.mode;
	const menu = dash.editor.isShowingAutocomplete();
	const frame = dash.render(120);
	const drawn = frame.some((l) => l.includes("Select model"));
	const ruleInside = frame.some((l) => /^─+ *$/.test(l.trim()) && l.trim().length > 20);
	press(dash, "m", "o");
	await settle();
	press(dash, "\r");
	await settle();
	const ran = [...results];
	const typed = make({ commands });
	for (const text of ["/tldr", "/not-a-command"]) {
		press(typed, text);
		await settle();
		typed.editor.isShowingAutocomplete() && press(typed, "\x1b");
		press(typed, "\r");
		await settle();
	}
	const filter = make({ commands });
	press(filter, "\x06", "/");
	await settle();
	out.slash = {
		mode: slashMode, menu, drawn, ruleInside, ran,
		started: dispatched.map((d) => d.text),
		filterMenu: filter.editor.isShowingAutocomplete(), filterMode: filter.mode,
	};
	dash.dispose(); typed.dispose(); filter.dispose();
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
{
	// Ctrl+S groups by directory, and back; the choice is saved in the config.
	const dash = make();
	const header = () => dash.render(120).join("\n");
	const before = header();
	press(dash, "\x13");
	out.grouping = { before: before.includes("▾"), after: header().includes("▾"), summaryNamesState: /Needs|Queued|Working|Running/i.test(header()) };
	press(dash, "\x13");
	out.groupingBack = !header().includes("▾ ");
	dash.dispose();
}
{
	// Shift+arrows swap neighbors in a group, and it lasts.
	const dash = make();
	dash.refresh();
	const before = [...dash.orderedIds];
	dash.selectedId = before[0];
	press(dash, "\x1b[1;2B");
	const after = [...dash.orderedIds];
	const reopened = make();
	out.reorder = { before, after, selected: dash.selectedId, lasting: [...reopened.orderedIds] };
	press(dash, "\x1b[1;2A");
	out.reorderBack = [...dash.orderedIds];
	dash.dispose();
	reopened.dispose();
}
{
	// A dialog during a run puts the row in Needs answer, and closing it takes it back.
	const id = real.rows()[0].meta.id;
	await real.syncHostedEvent(id, { type: "agent_board_waiting", waiting: true });
	await new Promise((r) => setTimeout(r, 300));
	const waiting = real.row(id).state;
	const reply = await real.reply(id, "y");
	const queuedDuringDialog = reply.queued === true && reply.sent !== true;
	await real.syncHostedEvent(id, { type: "agent_board_waiting", waiting: false });
	await new Promise((r) => setTimeout(r, 300));
	const resumed = real.row(id).state;
	out.waiting = { state: waiting.semanticState, question: waiting.question, resumed: resumed.semanticState, cleared: resumed.question };
	out.replyDuringDialog = { queuedDuringDialog, pendingWhileWaiting: waiting.pendingQuestions.length, pendingAfter: resumed.pendingQuestions.length };
}
{
	// Ctrl+G hands the text to the editor, and takes back what it wrote.
	const dash = make();
	const stops = [];
	dash.tui.stop = () => stops.push("stop");
	dash.tui.start = () => stops.push("start");
	press(dash, "draft", "\x07");
	await new Promise((r) => setTimeout(r, 700));
	out.editor = { input: dash.input, mode: dash.mode, stops };
	dash.dispose();
}
console.log(JSON.stringify(out));
