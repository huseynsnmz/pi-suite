import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { STALL_MS } from "../render/timing.ts";
import {
	emptyTotals,
	perSecond,
	promptOf,
	REQUEST_CHANGES,
	type RequestRecord,
	type Totals,
	usageTotals,
} from "./totals.ts";

const MIN_SAMPLE_MS = 250;
/** Measured over 16,889 assistant messages: 2.88 characters per output token. */
const DEFAULT_CHARS_PER_TOKEN = 2.9;

/** So the wait for the first thought can be told from the first word. */
export type DeltaKind = "thinking" | "writing";

export interface RequestView {
	streaming: boolean;
	waiting: boolean;
	elapsedMs: number;
	/** From the request leaving to the first token of any kind. */
	waitMs: number | undefined;
	/** The same wait while it runs. */
	waitingMs: number;
	/** To the response headers: the provider's own latency. */
	serverMs: number | undefined;
	/** From the headers to the first token: the model reading the prompt. */
	prefillMs: number | undefined;
	/** Unset when it wrote without thinking. */
	thoughtMs: number | undefined;
	decode: number | undefined;
	prefill: number | undefined;
	usage: Totals;
	estimated: boolean;
}

/** One call to the model, for the line under its response. */
export interface Timing {
	/** When it left. */
	at: number;
	streaming: boolean;
	waitMs: number | undefined;
	waitingMs: number;
	serverMs: number | undefined;
	thoughtMs: number | undefined;
	totalMs: number;
	writingMs: number;
	/** Pauses of `STALL_MS` or more while it wrote. */
	stallMs: number;
	output: number;
	estimated: boolean;
}

export interface RunView {
	running: boolean;
	elapsedMs: number;
	requests: number;
	cost: number;
}

interface Request {
	startedAt: number;
	sentAt: number | undefined;
	headersAt: number | undefined;
	firstTokenAt: number | undefined;
	firstWritingAt: number | undefined;
	endedAt: number | undefined;
	messageAt?: number;
	usage: Totals;
	characters: number;
	lastDeltaAt: number | undefined;
	stallMs: number;
}

interface Run {
	startedAt: number;
	endedAt: number | undefined;
	requests: number;
	cost: number;
}

interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
}

function span(from: number | undefined, to: number | undefined): number | undefined {
	return from === undefined || to === undefined ? undefined : to - from;
}

export class Telemetry {
	readonly #now: () => number;
	#run: Run | undefined;
	#request: Request | undefined;
	#last: RequestView | undefined;
	/** By the response's timestamp, which stays the same while it's written. */
	#byMessage = new Map<number, Request>();
	#restored = new Map<number, Timing>();
	/** They arrive before the pi message they belong to. */
	#sentAt: number | undefined;
	#headersAt: number | undefined;
	/** So the live estimate uses a real ratio. */
	#sampled = { characters: 0, output: 0 };

	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	runStarted(): void {
		this.#run = { startedAt: this.#now(), endedAt: undefined, requests: 0, cost: 0 };
	}

	runEnded(): void {
		if (this.#run !== undefined && this.#run.endedAt === undefined) this.#run.endedAt = this.#now();
	}

	/** Before every call to the model: the start of the wait. */
	providerRequestSent(): void {
		this.#sentAt = this.#now();
		this.#headersAt = undefined;
		this.#attach();
	}

	/** Before the stream is read. */
	providerResponseArrived(): void {
		this.#headersAt = this.#now();
		this.#attach();
	}

	requestStarted(): void {
		this.#sentAt = undefined;
		this.#headersAt = undefined;
		this.#begin();
		if (this.#run === undefined || this.#run.endedAt !== undefined) this.runStarted();
		if (this.#run !== undefined) this.#run.requests++;
	}

	/** Later requests of a turn: the next call after a tool ran. */
	answerStarted(messageAt?: number): void {
		if (this.#request === undefined || this.#request.endedAt !== undefined) this.#begin();
		if (messageAt !== undefined && this.#request !== undefined) {
			this.#byMessage.set(messageAt, this.#request);
			this.#request.messageAt = messageAt;
		}
	}

	answerGrew(delta: string, usage: UsageLike, kind: DeltaKind): void {
		const request = this.#request;
		if (request === undefined || request.endedAt !== undefined) return;
		request.usage = usageTotals(usage);
		if (delta.length === 0) return;
		const grewAt = this.#now();
		const gap = grewAt - (request.lastDeltaAt ?? grewAt);
		if (gap >= STALL_MS) request.stallMs += gap;
		request.lastDeltaAt = grewAt;
		request.characters += delta.length;
		request.firstTokenAt ??= this.#now();
		if (kind === "writing") request.firstWritingAt ??= this.#now();
	}

	answerEnded(usage: UsageLike): RequestRecord | undefined {
		const request = this.#request;
		if (request === undefined || request.endedAt !== undefined) return undefined;

		const now = this.#now();
		request.endedAt = now;
		request.usage = usageTotals(usage);
		if (this.#run !== undefined) this.#run.cost += usage.cost.total;
		if (request.usage.output === 0 && request.firstTokenAt === undefined) return undefined;

		if (request.characters > 0 && request.usage.output > 0) {
			this.#sampled.characters += request.characters;
			this.#sampled.output += request.usage.output;
		}

		const firstTokenAt = request.firstTokenAt ?? now;
		const from = request.sentAt ?? request.startedAt;
		this.#last = this.#view(request);
		const timing = this.#timing(request);
		return {
			output: request.usage.output,
			prompt: promptOf(request.usage),
			firstTokenMs: firstTokenAt - from,
			generationMs: now - firstTokenAt,
			at: from,
			messageAt: request.messageAt,
			serverMs: span(request.sentAt, request.headersAt),
			thoughtMs: timing.thoughtMs,
			totalMs: now - from,
			stallMs: request.stallMs,
		};
	}

	timingOf(messageAt: number): Timing | undefined {
		const request = this.#byMessage.get(messageAt);
		return request === undefined ? this.#restored.get(messageAt) : this.#timing(request);
	}

	/** The calls an earlier run of this session recorded. */
	restore(entries: readonly SessionEntry[]): void {
		for (const entry of entries) {
			if (entry.type !== "custom" || entry.customType !== REQUEST_CHANGES) continue;
			const record = entry.data as Partial<RequestRecord> | undefined;
			if (record?.messageAt === undefined || record.at === undefined) continue;
			this.#restored.set(record.messageAt, {
				at: record.at,
				streaming: false,
				waitMs: record.firstTokenMs,
				waitingMs: record.firstTokenMs ?? 0,
				serverMs: record.serverMs,
				thoughtMs: record.thoughtMs,
				totalMs: record.totalMs ?? 0,
				writingMs: record.generationMs ?? 0,
				stallMs: record.stallMs ?? 0,
				output: record.output ?? 0,
				estimated: false,
			});
		}
	}

	request(): RequestView | undefined {
		const request = this.#request;
		return request === undefined ? undefined : this.#view(request);
	}

	last(): RequestView | undefined {
		return this.#last;
	}

	run(): RunView | undefined {
		const run = this.#run;
		if (run === undefined) return undefined;
		const running = run.endedAt === undefined;
		return {
			running,
			elapsedMs: (run.endedAt ?? this.#now()) - run.startedAt,
			requests: run.requests,
			cost: run.cost,
		};
	}

	reset(): void {
		this.#run = undefined;
		this.#request = undefined;
		this.#last = undefined;
		this.#byMessage.clear();
		this.#restored.clear();
		this.#sentAt = undefined;
		this.#headersAt = undefined;
	}

	#begin(): void {
		this.#request = {
			startedAt: this.#now(),
			sentAt: this.#sentAt,
			headersAt: this.#headersAt,
			firstTokenAt: undefined,
			firstWritingAt: undefined,
			endedAt: undefined,
			usage: emptyTotals(),
			characters: 0,
			lastDeltaAt: undefined,
			stallMs: 0,
		};
	}

	/** Pi sends before it opens the message, so the marks may arrive first. */
	#attach(): void {
		const request = this.#request;
		if (request === undefined || request.endedAt !== undefined) return;
		request.sentAt = this.#sentAt;
		request.headersAt = this.#headersAt;
	}

	#timing(request: Request): Timing {
		const view = this.#view(request);
		const end = request.endedAt ?? this.#now();
		const from = request.sentAt ?? request.startedAt;
		// While it's paused, the pause so far counts too.
		const pause = request.endedAt === undefined ? end - (request.lastDeltaAt ?? end) : 0;
		return {
			at: from,
			streaming: view.streaming,
			waitMs: view.waitMs,
			waitingMs: view.waitingMs,
			serverMs: view.serverMs,
			thoughtMs: view.thoughtMs,
			totalMs: end - from,
			writingMs: request.firstTokenAt === undefined ? 0 : end - request.firstTokenAt,
			stallMs: request.stallMs + (pause >= STALL_MS ? pause : 0),
			output: view.usage.output,
			estimated: view.estimated,
		};
	}

	#view(request: Request): RequestView {
		const now = this.#now();
		const streaming = request.endedAt === undefined;
		const from = request.sentAt ?? request.startedAt;
		const waitMs = span(from, request.firstTokenAt);
		const estimated = streaming && request.usage.output === 0;
		const output = estimated
			? Math.round(request.characters / this.#charsPerToken())
			: request.usage.output;
		const writingMs =
			request.firstTokenAt === undefined ? 0 : (request.endedAt ?? now) - request.firstTokenAt;
		const thoughtMs = span(request.firstTokenAt, request.firstWritingAt);

		return {
			streaming,
			waiting: streaming && request.firstTokenAt === undefined,
			elapsedMs: (request.endedAt ?? now) - request.startedAt,
			waitMs,
			waitingMs: (request.endedAt ?? now) - from,
			serverMs: span(request.sentAt, request.headersAt),
			prefillMs: span(request.headersAt ?? request.sentAt, request.firstTokenAt),
			thoughtMs: thoughtMs !== undefined && thoughtMs > 0 ? thoughtMs : undefined,
			decode: writingMs < MIN_SAMPLE_MS && streaming ? undefined : perSecond(output, writingMs),
			prefill: waitMs === undefined ? undefined : perSecond(promptOf(request.usage), waitMs),
			usage: { ...request.usage, output },
			estimated,
		};
	}

	/** This session's ratio, or the measured default. */
	#charsPerToken(): number {
		const { characters, output } = this.#sampled;
		return output > 0 ? characters / output : DEFAULT_CHARS_PER_TOKEN;
	}
}
