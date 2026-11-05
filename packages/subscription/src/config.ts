import { readSection } from "../../../src/settings.ts";

export interface Config {
	pathToClaudeCodeExecutable?: string;
	/** "claude" (default): a pi prompt prefix written for Claude. "pi": pi's default prompt. */
	promptMode?: "claude" | "pi";
	maxSessions?: number;
	idleMinutes?: number;
}

const intIn = (lo: number, hi: number) => (n: unknown): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
const validMaxSessions = intIn(1, 16);
const validIdleMinutes = intIn(1, 24 * 60);

/** Its settings are all conveniences, so broken ones just mean the defaults. */
function readSaved(agentDir: string): Record<string, unknown> {
	try {
		return readSection(agentDir, "subscription");
	} catch {
		return {};
	}
}

/** Global only: a repository must not choose which program runs, or how many, or how your prompt is built. */
export function resolveConfig(where: { agentDir: string; env: Record<string, string | undefined> }): Config {
	const saved = readSaved(where.agentDir);
	const path = where.env.PI_CLAUDE_SDK_CLAUDE_PATH ?? saved.pathToClaudeCodeExecutable;
	return {
		...(typeof path === "string" && path !== "" ? { pathToClaudeCodeExecutable: path } : {}),
		...(validMaxSessions(saved.maxSessions) ? { maxSessions: saved.maxSessions } : {}),
		...(validIdleMinutes(saved.idleMinutes) ? { idleMinutes: saved.idleMinutes } : {}),
		promptMode: where.env.PI_CLAUDE_SDK_PROMPT === "pi" || (where.env.PI_CLAUDE_SDK_PROMPT === undefined && saved.promptMode === "pi") ? "pi" : "claude",
	};
}
