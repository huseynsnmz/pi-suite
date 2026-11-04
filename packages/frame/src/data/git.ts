import { processRunner, type Runner } from "./runner.ts";

export interface GitState {
	ahead: number;
	behind: number;
	staged: number;
	modified: number;
	untracked: number;
	conflicted: number;
	stashed: number;
}

export function emptyGit(): GitState {
	return { ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicted: 0, stashed: 0 };
}

export function parseStatus(output: string): GitState {
	const state = emptyGit();

	for (const line of output.split("\n")) {
		if (line.startsWith("# branch.ab ")) {
			const [, , ahead, behind] = line.split(" ");
			state.ahead = Math.abs(Number(ahead ?? "0")) || 0;
			state.behind = Math.abs(Number(behind ?? "0")) || 0;
		} else if (line.startsWith("# stash ")) {
			state.stashed = Number(line.slice("# stash ".length)) || 0;
		} else if (line.startsWith("1 ") || line.startsWith("2 ")) {
			// `XY` is the index column, then the tree column, with `.` for unchanged.
			const index = line[2];
			const tree = line[3];
			if (index !== undefined && index !== ".") state.staged++;
			if (tree !== undefined && tree !== ".") state.modified++;
		} else if (line.startsWith("u ")) {
			state.conflicted++;
		} else if (line.startsWith("? ")) {
			state.untracked++;
		}
	}

	return state;
}

/**
 * `git status` runs after every tool call, outside any permission check, so nothing the repository
 * configures may run through it: an agent can write `.git/config`, and a downloaded folder can bring one.
 */
const SAFE_STATUS = [
	"-c",
	"core.fsmonitor=false",
	"-c",
	"core.hooksPath=/dev/null",
	"--no-optional-locks",
];

/** Keys and scopes separated by NUL, as `git config --show-scope --name-only --list -z` prints them. */
export function hasRepoFilter(config: string): boolean {
	const fields = config.split("\0");
	for (let at = 0; at + 1 < fields.length; at += 2) {
		const scope = fields[at];
		if (scope !== "local" && scope !== "worktree") continue;
		if (/^filter\..+\.(?:clean|smudge|process)$/is.test(fields[at + 1] ?? "")) return true;
	}
	return false;
}

export async function readGit(
	cwd: string,
	run: Runner = processRunner(cwd, 2000),
): Promise<GitState | undefined> {
	try {
		// A filter's name is free, so no option can turn them all off.
		const config = await run("git", ["-C", cwd, "config", "--show-scope", "--name-only", "--list", "-z"]);
		if (hasRepoFilter(config)) return undefined;
		return parseStatus(
			await run("git", [
				...SAFE_STATUS,
				"-C",
				cwd,
				"status",
				"--porcelain=v2",
				"--branch",
				"--show-stash",
				"--ignore-submodules=all",
			]),
		);
	} catch {
		// Not a repository, or git did not answer: the card says nothing.
		return undefined;
	}
}
