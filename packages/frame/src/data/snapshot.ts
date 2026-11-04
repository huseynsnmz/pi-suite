import { hostname } from "node:os";

import type { AccountState, Board, PeerMark, RoomMark, WritingMark } from "../kit/index.ts";
import { VERSION, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

import { plainText } from "../render/safe.ts";

import type { GitState } from "./git.ts";
import type { RequestView, RunView } from "./telemetry.ts";
import {
	type Averages,
	averagesOf,
	cacheHitPercent,
	cacheWarming,
	emptyTotals,
	type Totals,
	totalsOf,
} from "./totals.ts";

interface ModelInfo {
	name: string;
	provider: string;
	reasoning: boolean;
}

interface ContextInfo {
	percent: number;
	tokens: number;
	window: number;
}

/** pi-sandbox sets this while it's on, and empties it when it goes off. */
export const SANDBOX_STATUS = "sandbox";

export interface Snapshot {
	now: number;
	cwd: string;
	home: string | undefined;
	branch: string | null;
	git: GitState | undefined;
	host: string | undefined;
	sessionName: string | undefined;
	/** The word the room calls this session by, in its color once it is in a room. */
	me: { handle: string; color?: string } | undefined;
	version: string;
	model: ModelInfo | undefined;
	account: AccountState | undefined;
	thinking: string | undefined;
	context: ContextInfo | undefined;
	totals: Totals;
	cacheHit: number | undefined;
	cacheWarming: boolean;
	subscription: boolean;
	request: RequestView | undefined;
	last: RequestView | undefined;
	run: RunView | undefined;
	averages: Averages;
	statuses: ReadonlyMap<string, string>;
	/** Whether pi-sandbox is confining commands. Undefined when it isn't installed. */
	sandbox: "on" | "off" | undefined;
	/** When a board feature keeps it. */
	board: Board | undefined;
	/** When a peers feature keeps them. */
	peers: PeerMark[];
	/** Empty when the peers feature publishes only `peers`. */
	peersRooms: RoomMark[];
	peersUnread: number;
	peersWriting: WritingMark[];
}

export function emptySnapshot(): Snapshot {
	return {
		now: 0,
		cwd: "",
		home: undefined,
		branch: null,
		git: undefined,
		host: undefined,
		sessionName: undefined,
		me: undefined,
		version: VERSION,
		model: undefined,
		account: undefined,
		thinking: undefined,
		context: undefined,
		totals: emptyTotals(),
		cacheHit: undefined,
		cacheWarming: false,
		subscription: false,
		request: undefined,
		last: undefined,
		run: undefined,
		averages: { decode: undefined, prefill: undefined },
		statuses: new Map(),
		sandbox: undefined,
		board: undefined,
		peers: [],
		peersRooms: [],
		peersUnread: 0,
		peersWriting: [],
	};
}

export interface LiveInputs {
	branch: string | null;
	git: GitState | undefined;
	account?: AccountState | undefined;
	request: RequestView | undefined;
	last: RequestView | undefined;
	run: RunView | undefined;
	statuses: ReadonlyMap<string, string>;
	sandboxInstalled?: boolean;
	board?: Board | undefined;
	me?: { handle: string; color?: string } | undefined;
	peers?: PeerMark[] | undefined;
	peersRooms?: RoomMark[] | undefined;
	peersUnread?: number | undefined;
	peersWriting?: WritingMark[] | undefined;
}

interface Derived {
	totals: Totals;
	cacheHit: number | undefined;
	cacheWarming: boolean;
	averages: Averages;
	context: ContextInfo | undefined;
	answeredBy: string | undefined;
}

const VIRTUAL_API = "pi-virtual";

export class SnapshotReader {
	#key: string | undefined;
	#derived: Derived | undefined;
	readonly #host = hostname().split(".")[0];

	read(ctx: ExtensionContext, live: LiveInputs): Snapshot {
		const model = ctx.model;
		const derived = this.#derive(ctx);

		return {
			now: Date.now(),
			cwd: ctx.cwd,
			home: process.env.HOME ?? process.env.USERPROFILE,
			branch: live.branch,
			git: live.git,
			host: this.#host,
			sessionName: ctx.sessionManager.getSessionName(),
			me: live.me,
			version: VERSION,
			model:
				model === undefined
					? undefined
					: {
							name:
								model.api === VIRTUAL_API && derived.answeredBy !== undefined
									? `${model.name} \u2192 ${derived.answeredBy}`
									: (model.name ?? model.id),
							provider: ctx.modelRegistry.getProviderDisplayName(model.provider),
							reasoning: model.reasoning,
						},
			thinking: ctx.thinkingLevel,
			account: live.account,
			...derived,
			subscription: model === undefined ? false : ctx.modelRegistry.isUsingOAuth(model),
			request: live.request,
			last: live.last,
			run: live.run,
			statuses: new Map(
				[...live.statuses.entries()]
					.toSorted(([a], [b]) => a.localeCompare(b))
					.map(([key, text]): [string, string] => [key, sanitize(text)])
					.filter(([, text]) => text !== ""),
			),
			sandbox: !live.sandboxInstalled ? undefined : live.statuses.get(SANDBOX_STATUS) ? "on" : "off",
			board: live.board,
			peers: live.peers ?? [],
			peersRooms: live.peersRooms ?? [],
			peersUnread: live.peersUnread ?? 0,
			peersWriting: live.peersWriting ?? [],
		};
	}

	#derive(ctx: ExtensionContext): Derived {
		// Entries are appended at the leaf, so the sums change only when the leaf or the model does.
		const key = `${ctx.sessionManager.getLeafId() ?? ""}\u0000${ctx.model?.provider}/${ctx.model?.id}`;
		if (this.#derived !== undefined && key === this.#key) return this.#derived;

		const entries: readonly SessionEntry[] = ctx.sessionManager.getBranch();
		this.#key = key;
		this.#derived = {
			totals: totalsOf(entries),
			cacheHit: cacheHitPercent(entries),
			cacheWarming: cacheWarming(entries),
			averages: averagesOf(entries),
			context: contextOf(ctx),
			answeredBy: answeredBy(ctx, entries),
		};
		return this.#derived;
	}
}

/** A virtual model only says what was selected. The latest answer says which model it chose. */
function answeredBy(ctx: ExtensionContext, entries: readonly SessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
		if (entry.message.stopReason === "error" || entry.message.stopReason === "aborted") continue;
		const { provider, model } = entry.message;
		return plainText(ctx.modelRegistry.find(provider, model)?.name ?? model).replace(/\s+/g, " ");
	}
	return undefined;
}

function contextOf(ctx: ExtensionContext): ContextInfo | undefined {
	const usage = ctx.getContextUsage();
	if (usage === undefined || usage.percent === null || usage.tokens === null) return undefined;
	return { percent: usage.percent, tokens: usage.tokens, window: usage.contextWindow };
}

function sanitize(text: string): string {
	return text.replace(/[\r\n\t]+/g, " ").trim();
}
