/** `/bg` command: adopt the current interactive Pi session into Agent Board. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createService } from "../runtime/service.mjs";
import { dashboardAttachLoop } from "./agent-board.js";

const NEW_SESSION = "new session";

export interface BgCommandOptions {
	root: string;
	runnerScript: string;
	ptyRunnerScript?: string;
	titleRunnerScript?: string;
	piCommand: string;
	piArgsPrefix: string[];
	getThinkingLevel: () => "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export function registerBgCommand(pi: ExtensionAPI, opts: BgCommandOptions): void {
	pi.registerCommand("bg", {
		description: "Adopt the current session into Agent Board and optionally queue a prompt",
		handler: async (args, ctx) => {
			await handleBgCommand(args, ctx, opts);
		},
	});
}

async function handleBgCommand(args: string, ctx: ExtensionCommandContext, opts: BgCommandOptions): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/bg requires interactive mode.", "warning");
		return;
	}
	const sessionFile = ctx.sessionManager.getSessionFile();
	const service = createService({
		root: opts.root,
		runnerScript: opts.runnerScript,
		ptyRunnerScript: opts.ptyRunnerScript,
		titleRunnerScript: opts.titleRunnerScript,
		piCommand: opts.piCommand,
		piArgsPrefix: opts.piArgsPrefix,
		defaultCwd: ctx.cwd,
		// Stale-defaultModel launch guard (issue #90): live list, undefined
		// when the registry is unavailable so validation conservatively skips.
		availableModels: () => {
			try {
				return ctx.modelRegistry.getAvailable();
			} catch {
				return undefined;
			}
		},
	});
	// A session that isn't saved anywhere has nothing to come back to, but the board still opens.
	if (!sessionFile) {
		await dashboardAttachLoop(ctx, service, opts.root, null, opts.getThinkingLevel);
		return;
	}
	const model = modelRef(ctx.model as any);
	// adoptSession is async (routes through the view-state coordinator, issue #91).
	const adopted = await service.adoptSession({
		sessionFile,
		cwd: ctx.cwd,
		model,
		thinkingLevel: opts.getThinkingLevel(),
		// A row that exists keeps its name, which may be one you gave it.
		name: hasOwnName(service, sessionFile) ? undefined : sessionName(ctx),
	});
	if (!adopted.ok || !adopted.viewId) {
		ctx.ui.notify(adopted.error ?? "Could not background current session.", "warning");
		return;
	}
	const prompt = String(args || "").trim();
	if (prompt) {
		const reply = service.queueFollowUp(adopted.viewId, prompt, { delivery: "queue", source: "bg-command" }) as { ok: boolean; error?: string };
		if (!reply.ok) ctx.ui.notify(reply.error ?? "Could not queue background prompt.", "warning");
		else ctx.ui.notify("Prompt queued for background session.", "info");
	}
	await dashboardAttachLoop(ctx, service, opts.root, adopted.viewId, opts.getThinkingLevel);
}

function hasOwnName(service: ReturnType<typeof createService>, sessionFile: string): boolean {
	const row = service.rows().find((candidate) => candidate.meta.sessionFile === sessionFile);
	return row !== undefined && row.meta.name !== NEW_SESSION;
}

/** Its name if it has one, then what you first asked. A session with neither is new. */
function sessionName(ctx: ExtensionCommandContext): string {
	const named = ctx.sessionManager.getSessionName?.();
	if (named) return named;
	for (const entry of ctx.sessionManager.getEntries() as any[]) {
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const content = entry.message.content;
		const text = typeof content === "string" ? content : (content ?? []).map((part: any) => part.text ?? "").join(" ");
		const line = String(text).trim().split("\n")[0];
		if (line) return line.slice(0, 48);
	}
	return NEW_SESSION;
}

function modelRef(model: any): string | null {
	if (!model || typeof model !== "object") return null;
	if (typeof model.provider === "string" && typeof model.id === "string") return `${model.provider}/${model.id}`;
	if (typeof model.id === "string") return model.id;
	return null;
}
