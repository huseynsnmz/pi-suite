import { describe, expect, test } from "bun:test";

import { readGithub } from "../src/data/github.ts";
import { gitlabHosts, glabMayStart } from "../src/data/gitlab.ts";
import type { Runner } from "../src/data/runner.ts";

/** A command line that answers only what the test set up, and fails for anything else. */
function runner(answers: { branch?: string; runs?: string; pulls?: string; remotes?: string }): Runner {
	return async (file, args) => {
		if (file === "git" && args[0] === "remote")
			return answers.remotes ?? "origin\tgit@github.com:a/b.git (fetch)\n";
		if (file === "git") {
			if (answers.branch === undefined) throw new Error("no git here");
			return answers.branch;
		}
		const line = args.join(" ");
		if (line.startsWith("run list")) {
			if (answers.runs === undefined) throw new Error("no gh run");
			return answers.runs;
		}
		if (line.startsWith("pr list")) {
			if (answers.pulls === undefined) throw new Error("no gh pr");
			return answers.pulls;
		}
		throw new Error(`unexpected ${file} ${line}`);
	};
}

const FAILED_RUN = JSON.stringify([
	{
		conclusion: "failure",
		headSha: "b8e20baa8078f142fcadcd2246c7d3d3600d873a",
		name: "Release",
		displayTitle: "perf: the start card",
	},
]);

const MISSING: Runner = async () => {
	throw new Error("command not found");
};

const BROKEN: Runner = async (file, args) =>
	file === "git" ? "main\n" : args.join(" ").startsWith("run list") ? "not json" : "{}";

function pull(pr: Record<string, unknown>): string {
	return JSON.stringify([{ number: 52, title: "Fix the frame", author: { login: "me" }, ...pr }]);
}

describe("what GitHub answers for the folder", () => {
	test("the last run of the branch failing: its short sha and its workflow", async () => {
		const state = await readGithub(
			"/repo",
			undefined,
			runner({ branch: "main\n", runs: FAILED_RUN }),
		);
		expect(state.ci).toEqual({ branch: "main", sha: "b8e20ba", name: "Release" });
	});

	test("the branch is what the run is asked about, and a branch with no name has no run to ask", async () => {
		const asked: string[] = [];
		const watch =
			(branch: string): Runner =>
			async (file, args) => {
				asked.push(args.join(" "));
				return runner({ branch, runs: FAILED_RUN, pulls: "[]" })(file, args);
			};
		await readGithub("/repo", undefined, watch("feature/start-card\n"));
		expect(asked.some((line) => line.includes("--branch feature/start-card"))).toBe(true);

		asked.length = 0;
		const state = await readGithub("/repo", undefined, watch(""));
		expect(state.ci).toBeUndefined();
		expect(asked.some((line) => line.startsWith("run list"))).toBe(false);
	});

	test("a run that passed, one still going, or one given up on shows nothing", async () => {
		const states = await Promise.all(
			["success", "cancelled", "in_progress", ""].map((conclusion) =>
				readGithub(
					"/repo",
					undefined,
					runner({
						branch: "main",
						runs: JSON.stringify([{ conclusion, headSha: "b8e20ba", name: "CI" }]),
					}),
				),
			),
		);
		expect(states.map((state) => state.ci)).toEqual([undefined, undefined, undefined, undefined]);
	});

	test("a review asking for changes: the number and the title", async () => {
		const state = await readGithub(
			"/repo",
			undefined,
			runner({ branch: "main", pulls: pull({ reviewDecision: "CHANGES_REQUESTED" }) }),
		);
		expect(state.pr).toEqual({ number: 52, title: "Fix the frame", waits: "changes requested" });
	});

	test("a comment newer than the last session, from somebody else, is news", async () => {
		const since = Date.parse("2026-10-14T09:00:00Z");
		const pulls = pull({
			reviewDecision: "",
			comments: [{ author: { login: "reviewer" }, createdAt: "2026-10-14T10:00:00Z" }],
		});
		const state = await readGithub("/repo", since, runner({ branch: "main", pulls }));
		expect(state.pr).toEqual({ number: 52, title: "Fix the frame", waits: "new comment" });
	});

	test("an old comment, your own comment, or a first session is not news", async () => {
		const since = Date.parse("2026-10-14T09:00:00Z");
		const old = pull({
			comments: [{ author: { login: "reviewer" }, createdAt: "2026-10-14T08:00:00Z" }],
		});
		const mine = pull({
			comments: [{ author: { login: "me" }, createdAt: "2026-10-14T10:00:00Z" }],
		});
		const fresh = pull({
			comments: [{ author: { login: "reviewer" }, createdAt: "2026-10-14T10:00:00Z" }],
		});
		const states = await Promise.all([
			readGithub("/repo", since, runner({ branch: "main", pulls: old })),
			readGithub("/repo", since, runner({ branch: "main", pulls: mine })),
			readGithub("/repo", undefined, runner({ branch: "main", pulls: fresh })),
		]);
		expect(states.map((state) => state.pr)).toEqual([undefined, undefined, undefined]);
	});

	test("an approved pull request, or one waiting on a reviewer, waits on nobody", async () => {
		const states = await Promise.all(
			["APPROVED", "REVIEW_REQUIRED", ""].map((reviewDecision) =>
				readGithub("/repo", undefined, runner({ branch: "main", pulls: pull({ reviewDecision }) })),
			),
		);
		expect(states.map((state) => state.pr)).toEqual([undefined, undefined, undefined]);
	});

	test("of several pull requests, the first with something waiting on you", async () => {
		const pulls = JSON.stringify([
			{ number: 51, title: "Quiet one", reviewDecision: "APPROVED", author: { login: "me" } },
			{
				number: 52,
				title: "Fix the frame",
				reviewDecision: "CHANGES_REQUESTED",
				author: { login: "me" },
			},
		]);
		const state = await readGithub("/repo", undefined, runner({ branch: "main", pulls }));
		expect(state.pr?.number).toBe(52);
	});

	test("without gh, without a repository or without an answer, nothing at all", async () => {
		expect(await readGithub("/tmp", undefined, MISSING)).toEqual({ ci: undefined, pr: undefined });
		expect(await readGithub("/repo", undefined, BROKEN)).toEqual({ ci: undefined, pr: undefined });
	});
});

describe("readGithub outside GitHub", () => {
	test("never starts gh for a GitLab remote", async () => {
		const asked: string[] = [];
		const run: Runner = async (file, args) => {
			asked.push(file);
			if (args[0] === "remote") return "origin\tgit@gitlab.com:a/b.git (fetch)\n";
			return "main";
		};
		expect(await readGithub("/x", undefined, run)).toEqual({ ci: undefined, pr: undefined });
		expect(asked).not.toContain("gh");
	});
	test.each(["https://github.com/a/b.git", "git@github.com:a/b.git", "ssh://git@github.acme.dev/a/b"])(
		"asks gh for %s",
		async (url) => {
			const asked: string[] = [];
			const run: Runner = async (file, args) => {
				asked.push(file);
				if (args[0] === "remote") return `origin\t${url} (fetch)\n`;
				return file === "git" ? "main" : "[]";
			};
			await readGithub("/x", undefined, run);
			expect(asked).toContain("gh");
		},
	);
});

describe("what GitLab answers for the folder", () => {
	const GITLAB = "origin\tgit@gitlab.com:a/b.git (fetch)\n";
	function glab(answers: { ci?: string; mrs?: string }, seen: string[] = []): Runner {
		return async (file, args) => {
			if (file === "git") return args[0] === "remote" ? GITLAB : "feat\n";
			seen.push(`${file} ${args.join(" ")}`);
			if (args[0] === "ci" && answers.ci !== undefined) return answers.ci;
			if (args[0] === "mr" && answers.mrs !== undefined) return answers.mrs;
			throw new Error("no answer");
		};
	}
	const mr = (status: string) =>
		JSON.stringify([{ iid: 7, title: "Fix it", detailed_merge_status: status }]);

	test("a failed pipeline, and a merge request with changes requested", async () => {
		const seen: string[] = [];
		const state = await readGithub(
			"/x",
			undefined,
			glab(
				{
					ci: JSON.stringify([{ status: "failed", sha: "abcdef1234567", name: "" }]),
					mrs: mr("requested_changes"),
				},
				seen,
			),
		);
		expect(state.ci).toEqual({ branch: "feat", sha: "abcdef1", name: "pipeline" });
		expect(state.pr).toEqual({ number: 7, title: "Fix it", waits: "changes requested", ref: "MR !7" });
		expect(seen.every((line) => line.startsWith("glab "))).toBe(true);
	});

	test("a passing pipeline and a mergeable request are not news", async () => {
		const state = await readGithub(
			"/x",
			undefined,
			glab({ ci: JSON.stringify([{ status: "success" }]), mrs: mr("mergeable") }),
		);
		expect(state).toEqual({ ci: undefined, pr: undefined });
	});

	test("without glab there is nothing to say", async () => {
		expect(await readGithub("/x", undefined, glab({}))).toEqual({ ci: undefined, pr: undefined });
	});

	test("names the hosts, and not lookalikes", () => {
		expect(gitlabHosts("o\thttps://gitlab.acme.dev/a/b.git (fetch)\n")).toEqual(["gitlab.acme.dev"]);
		expect(gitlabHosts("o\thttps://evil.com/gitlab.com/b.git (fetch)\n")).toEqual([]);
		expect(gitlabHosts("o\thttps://gitlab.com@evil.com/b.git (fetch)\n")).toEqual([]);
	});

	test("a token from the environment only goes to a host you chose", () => {
		expect(glabMayStart(["gitlab.acme.dev"], {})).toBe(true);
		expect(glabMayStart(["gitlab.com"], { GITLAB_TOKEN: "x" })).toBe(true);
		expect(glabMayStart(["gitlab.evil.dev"], { GITLAB_TOKEN: "x" })).toBe(false);
		expect(glabMayStart(["gitlab.acme.dev"], { GITLAB_TOKEN: "x", GITLAB_HOST: "https://gitlab.acme.dev" })).toBe(true);
		expect(glabMayStart([], {})).toBe(false);
	});
});
