import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readGit } from "../src/data/git.ts";
import { visit } from "../src/data/visits.ts";

let dir: string;
const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });

function script(name: string): string {
	const path = join(dir, name);
	writeFileSync(path, `#!/bin/sh\ntouch "${dir}/ran-${name}"\ncat\n`);
	chmodSync(path, 0o755);
	return path;
}
const ran = (name: string) => existsSync(join(dir, `ran-${name}`));

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "frame-git-"));
	git("init", "-q");
	git("config", "user.email", "t@example.com");
	git("config", "user.name", "t");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reading git never runs what the repository names", () => {
	test("core.fsmonitor", async () => {
		git("config", "core.fsmonitor", script("monitor"));
		expect((await readGit(dir))?.untracked).toBeGreaterThan(0);
		expect(ran("monitor")).toBe(false);
	});

	test("hooks", async () => {
		const hooks = join(dir, ".git", "hooks");
		mkdirSync(hooks, { recursive: true });
		writeFileSync(join(hooks, "post-index-change"), `#!/bin/sh\ntouch "${dir}/ran-hook"\n`);
		chmodSync(join(hooks, "post-index-change"), 0o755);
		await readGit(dir);
		expect(ran("hook")).toBe(false);
	});

	test("clean filters: says nothing rather than run one", async () => {
		writeFileSync(join(dir, ".gitattributes"), "*.txt filter=x\n");
		writeFileSync(join(dir, "a.txt"), "aa\n");
		git("add", "a.txt", ".gitattributes");
		git("commit", "-qm", "one");
		git("config", "filter.x.clean", script("filter"));
		// The same size with a new time, so git has to read the file through the filter.
		writeFileSync(join(dir, "a.txt"), "bb\n");
		utimesSync(join(dir, "a.txt"), new Date(), new Date(Date.now() + 5000));
		expect(await readGit(dir)).toBeUndefined();
		expect(ran("filter")).toBe(false);
	});

	test("a submodule's own fsmonitor", async () => {
		const inner = mkdtempSync(join(tmpdir(), "frame-sub-"));
		execFileSync("git", ["-C", inner, "init", "-q"]);
		execFileSync("git", ["-C", inner, "-c", "user.email=t@e.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"]);
		git("-c", "protocol.file.allow=always", "submodule", "add", "-q", inner, "sub");
		execFileSync("git", ["-C", join(dir, "sub"), "config", "core.fsmonitor", script("submonitor")]);
		await readGit(dir);
		rmSync(inner, { recursive: true, force: true });
		expect(ran("submonitor")).toBe(false);
	});

	test("still counts an ordinary repository", async () => {
		writeFileSync(join(dir, "new.txt"), "x");
		expect((await readGit(dir))?.untracked).toBe(1);
	});
});

describe("the visits file", () => {
	test("is private to you and leaves no temporary file", () => {
		const file = join(dir, "state", "visits.json");
		visit(file, "/a", "1", 5);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(JSON.parse(readFileSync(file, "utf8"))["/a"].at).toBe(5);
		expect(execFileSync("ls", [join(dir, "state")]).toString().trim()).toBe("visits.json");
	});

	test("ignores an entry of the wrong shape", () => {
		const file = join(dir, "visits.json");
		writeFileSync(file, JSON.stringify({ "/a": { at: "soon", version: 3 } }));
		expect(visit(file, "/a", "1", 5)).toBeUndefined();
	});
});
