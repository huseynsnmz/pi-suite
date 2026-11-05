#!/usr/bin/env node
// Runs test/*.test.mjs. Quick files by default, the ones that start real processes with --integration.
// Every coordinator test spawns a detached process, and one that won't step down stays alive unnoticed,
// so a run fails if one of its coordinators outlives it.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
// Several checks read this package's own node_modules, and in pi-suite they sit at the root.
if (!existsSync(join(repoRoot, "node_modules"))) symlinkSync("../../node_modules", join(repoRoot, "node_modules"));

const integration = process.argv.includes("--integration");
const files = readdirSync(join(repoRoot, "test"))
	.filter((name) => name.endsWith(".test.mjs") && name.endsWith(".integration.test.mjs") === integration)
	.map((name) => join("test", name));

const script = join(repoRoot, "runner/state-coordinator.mjs");

/** Coordinators this checkout's tests started: its script, with a root under the temp folder. */
function coordinators() {
	if (process.platform === "win32") return [];
	const found = [];
	for (const line of execFileSync("ps", ["-e", "-ww", "-o", "pid=,args="], { encoding: "utf8" }).split("\n")) {
		const [pid, ...args] = line.trim().split(/\s+/);
		const at = args.indexOf(script);
		if (at >= 0 && args[at + 1]?.startsWith(tmpdir())) found.push(Number(pid));
	}
	return found;
}

const before = new Set(coordinators());
const run = spawnSync(process.execPath, ["--test", ...files], { cwd: repoRoot, stdio: "inherit" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let leaked = coordinators().filter((pid) => !before.has(pid));
for (let waited = 0; leaked.length > 0 && waited < 10_000; waited += 100) {
	await sleep(100);
	leaked = coordinators().filter((pid) => !before.has(pid));
}
for (const pid of leaked) {
	console.error(`run-tests: state coordinator ${pid} outlived the tests`);
	process.kill(pid, "SIGKILL");
}
process.exitCode = leaked.length > 0 || run.status !== 0 ? 1 : 0;
