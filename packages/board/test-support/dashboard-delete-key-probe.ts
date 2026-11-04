// Delete-key probe: drive the dashboard delete gestures through the public
// handleInput() and report observable state as JSON. One run covers the new
// `x` -> (y/N) path plus the legacy ctrl+x and multi-select regressions.
// Run via `node --experimental-transform-types` (dashboard.ts uses TS
// parameter properties). Not typechecked (tsconfig excludes test-support).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createService } from "../src/runtime/service.mjs";
import { createView } from "../src/core/store.mjs";
import { DashboardComponent } from "../src/ui/dashboard.ts";

type Row = { meta: { id: string; name: string }; alive: boolean; hostAlive: boolean; state: Record<string, unknown> | null };

function makeEnv(): {
	service: ReturnType<typeof createService>;
	root: string;
	archiveCalls: string[];
	archiveManyCalls: string[][];
	setRowPatch: (fn: ((r: Row) => Row) | null) => void;
} {
	const root = mkdtempSync(join(tmpdir(), "agentview-delete-key-"));
	createView(root, { id: "v1", name: "one", cwd: root });
	createView(root, { id: "v2", name: "two", cwd: root });
	const service = createService({
		root,
		runnerScript: "/no/runner.mjs",
		piCommand: "pi",
		piArgsPrefix: [],
		defaultCwd: root,
		launch: () => ({ pid: null, configPath: "/no/config.json" }),
		launchHost: () => ({ pid: null, configPath: "/no/host-config.json" }),
		launchTitle: () => ({ pid: null, configPath: "/no/title-config.json" }),
	});
	const archiveCalls: string[] = [];
	const realArchive = service.archive.bind(service);
	service.archive = ((id: string) => {
		archiveCalls.push(id);
		return realArchive(id);
	}) as typeof service.archive;
	// archiveMany calls archiveView directly (bypasses the archive wrapper
	// above), so the batch path needs its own recorder.
	const archiveManyCalls: string[][] = [];
	const realArchiveMany = service.archiveMany.bind(service);
	service.archiveMany = ((ids: string[]) => {
		archiveManyCalls.push([...ids]);
		return realArchiveMany(ids);
	}) as typeof service.archiveMany;
	const realRows = service.rows.bind(service);
	let rowPatch: ((r: Row) => Row) | null = null;
	service.rows = (() => realRows().map((r) => (rowPatch ? rowPatch(r as unknown as Row) : r))) as typeof service.rows;
	// selectedBatchRows() reads service.row(id), not service.rows() — patch
	// both so fixtures (busy/completed rows) stay consistent everywhere.
	const realRow = service.row.bind(service);
	service.row = ((id: string) => {
		const r = realRow(id);
		return r && rowPatch ? rowPatch(r as unknown as Row) : r;
	}) as typeof service.row;
	return { service, root, archiveCalls, archiveManyCalls, setRowPatch: (fn) => { rowPatch = fn; } };
}

const writes: string[] = [];
const tui = {
	terminal: { rows: 24, cols: 80, columns: 80, write: (d: string) => { writes.push(d); } },
	requestRender: () => {},
};
const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t, bg: (_c: string, t: string) => t };

function makeDash(env: ReturnType<typeof makeEnv>): DashboardComponent {
	return new DashboardComponent(tui as never, theme as never, { matches: () => false } as never, () => {}, {
		service: env.service,
		root: env.root,
		defaultCwd: env.root,
		availableModels: [],
		currentModel: null,
		currentThinkingLevel: "off",
	} as never);
}

async function waitFor(pred: () => boolean, ms = 2000): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (pred()) return true;
		await new Promise((r) => setTimeout(r, 10));
	}
	return pred();
}

type Snapshot = { mode: string; prompt: string | null; notice: string | null; archived: string[] };

function snap(dash: DashboardComponent, env: ReturnType<typeof makeEnv>): Snapshot {
	const d = dash as unknown as { mode: string; pending: { prompt: string } | null; inputNotice: { text: string } | null };
	return { mode: d.mode, prompt: d.pending?.prompt ?? null, notice: d.inputNotice?.text ?? null, archived: [...env.archiveCalls] };
}

const report: Record<string, unknown> = {};

// Typed text never reaches the delete gesture.
{
	const env = makeEnv();
	const dash = makeDash(env);
	dash.handleInput("x");
	const d = dash as unknown as { mode: string; input: string };
	report.typing = { mode: d.mode, input: d.input, archived: [...env.archiveCalls] };
	dash.dispose();
}

// An inactive row: ctrl+x twice inside the window deletes, with no confirm step.
{
	const env = makeEnv();
	const dash = makeDash(env);
	dash.handleInput("\x18");
	const armed = (dash as unknown as { inputNotice: { text: string } | null }).inputNotice?.text ?? null;
	dash.handleInput("\x18");
	await waitFor(() => env.archiveCalls.length > 0);
	report.double = { ...snap(dash, env), armed };
	dash.dispose();
}

// The cursor stays in the deleted row's group, and the notice sits on the frame's bottom edge.
{
	const env = makeEnv();
	createView(env.root, { id: "v3", name: "three", cwd: env.root });
	createView(env.root, { id: "v4", name: "four", cwd: env.root });
	env.setRowPatch((r) => (r.meta.id === "v1" ? { ...r, state: { ...(r.state ?? {}), semanticState: "completed" } } : r));
	const dash = makeDash(env);
	const d = dash as unknown as { orderedIds: string[]; selectedId: string | null; refresh(): void };
	const order = [...d.orderedIds];
	const del = async (id: string) => {
		d.selectedId = id;
		dash.handleInput("\x18");
		dash.handleInput("\x18");
		await waitFor(() => !d.orderedIds.includes(id));
	};
	const live = order.filter((id) => id !== "v1");
	await del(live[2]);
	const afterLast = d.selectedId;
	const screen = dash.render(80);
	await del(live[0]);
	const afterFirst = d.selectedId;
	report.cursor = { order, live, afterLast, afterFirst, bottom: screen.at(-1), top: screen.slice(0, -1).some((line) => line.includes("Deleted")) };
	dash.dispose();
}

// A press that isn't ctrl+x disarms it.
{
	const env = makeEnv();
	const dash = makeDash(env);
	dash.handleInput("\x18");
	dash.handleInput("\x1b[B");
	dash.handleInput("\x18");
	report.disarmed = snap(dash, env);
	dash.dispose();
}

// A live row: the first press stops it, the second deletes.
{
	const env = makeEnv();
	const stopped: string[] = [];
	env.setRowPatch((r) => ({ ...r, alive: true }));
	(env.service as unknown as { stop: (id: string) => unknown }).stop = (id: string) => {
		stopped.push(id);
		return { ok: true };
	};
	const dash = makeDash(env);
	dash.handleInput("\x18");
	report.live = { stopped: [...stopped], archivedAfterFirst: [...env.archiveCalls] };
	dash.dispose();
}

// Multi-select keeps its own ctrl+x confirm.
{
	const env = makeEnv();
	env.setRowPatch((r) => ({ ...r, state: { ...(r.state ?? {}), semanticState: "completed" } }));
	const dash = makeDash(env);
	const target = (dash as unknown as { orderedIds: string[] }).orderedIds[0];
	dash.handleInput("\x01");
	dash.handleInput(" ");
	dash.handleInput("\x18");
	const d1 = dash as unknown as { mode: string; pending: { prompt: string; returnMode?: string } | null };
	const ctrlX = { mode: d1.mode, prompt: d1.pending?.prompt ?? null, returnMode: d1.pending?.returnMode ?? null };
	dash.handleInput("y");
	const d2 = dash as unknown as { orderedIds: string[] };
	await waitFor(() => !d2.orderedIds.includes(target), 5000);
	report.selectMode = { ctrlX, target, archiveManyCalls: [...env.archiveManyCalls], archived: [...env.archiveCalls] };
	dash.dispose();
}

console.log(JSON.stringify(report));
