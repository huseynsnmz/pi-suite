// The GitLab version of github.ts: the branch's last pipeline, and your merge requests that wait on you.
// glab sends a token from the environment to whichever host it is pointed at, and the repository
// chooses that host, so with such a token it starts only for gitlab.com or GITLAB_HOST.
import { ask, field, type GithubState, numberOf, rows } from "./github.ts";
import type { Runner } from "./runner.ts";

/** gitlab.com, or a self-hosted name like gitlab.acme.dev. */
const GITLAB_HOST = /(?:@|\/\/)((?:[\w-]+\.)*gitlab\.[\w.-]+)[:/]/gi;
const TOKENS = ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN", "OAUTH_TOKEN"];
const WAITS = {
	requested_changes: "changes requested",
	discussions_not_resolved: "open threads",
} as const;

export function gitlabHosts(remotes: string): string[] {
	return [...remotes.matchAll(GITLAB_HOST)].map((match) => (match[1] ?? "").toLowerCase());
}

export function glabMayStart(
	hosts: readonly string[],
	env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	if (hosts.length === 0) return false;
	if (!TOKENS.some((name) => env[name])) return true;
	const trusted = ["gitlab.com", env["GITLAB_HOST"]?.replace(/^https?:\/\//, "").toLowerCase()];
	return hosts.every((host) => trusted.includes(host));
}

/** Never rejects. */
export async function readGitlab(run: Runner, branch: string | undefined): Promise<GithubState> {
	const [ci, pr] = await Promise.all([
		branch === undefined ? undefined : failedPipeline(run, branch),
		mergeRequest(run),
	]);
	return { ci, pr };
}

async function failedPipeline(run: Runner, branch: string): Promise<GithubState["ci"]> {
	const out = await ask(() =>
		run("glab", ["ci", "list", "--ref", branch, "--per-page", "1", "--output", "json"]),
	);
	const [last] = rows(out);
	if (last === undefined || field(last, "status") !== "failed") return undefined;
	return {
		branch,
		sha: (field(last, "sha") ?? "").slice(0, 7),
		name: field(last, "name") ?? "pipeline",
	};
}

async function mergeRequest(run: Runner): Promise<GithubState["pr"]> {
	const out = await ask(() =>
		run("glab", ["mr", "list", "--author", "@me", "--per-page", "10", "--output", "json"]),
	);
	for (const mr of rows(out)) {
		const number = numberOf(mr, "iid");
		const title = field(mr, "title");
		const waits = WAITS[field(mr, "detailed_merge_status") as keyof typeof WAITS];
		if (number !== undefined && title !== undefined && waits !== undefined)
			return { number, title, waits, ref: `MR !${number}` };
	}
	return undefined;
}
