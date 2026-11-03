import { visibleWidth } from "@earendil-works/pi-tui";

import type { Timing } from "../data/telemetry.ts";
import { latency, rate } from "./format.ts";

/** From here on, a pause while writing is worth pointing out. */
export const STALL_MS = 2_000;

export function clockTime(at: number): string {
	const date = new Date(at);
	const two = (value: number) => String(value).padStart(2, "0");
	const ms = String(date.getMilliseconds()).padStart(3, "0");
	return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${ms}`;
}

/** To the millisecond, as `812ms`, `4.218s` or `1m 04.218s`. */
export function exactly(ms: number): string {
	const whole = Math.round(ms);
	if (whole < 1000) return `${whole}ms`;
	if (whole < 60_000) return `${(whole / 1000).toFixed(3)}s`;
	const seconds = ((whole % 60_000) / 1000).toFixed(3).padStart(6, "0");
	return `${Math.floor(whole / 60_000)}m ${seconds}s`;
}

export interface AnsweredMessage {
	timestamp: number;
	stopReason?: string;
}

/** Each with its rank: the highest goes first when the line runs out of room. */
type Part = [text: string, drop: number];

function speedOf(timing: Timing): string | undefined {
	const writing = timing.writingMs - timing.stallMs;
	if (writing <= 0 || timing.output === 0) return undefined;
	const speed = rate((timing.output / writing) * 1000);
	return `${timing.estimated ? "~" : ""}${speed} tok/s`;
}

function partsOf(timing: Timing | undefined, message: AnsweredMessage): Part[] {
	// A session from before this was recorded, or another session's: only the clock is known.
	if (timing === undefined) return [[clockTime(message.timestamp), 0]];
	const clock: Part = [clockTime(timing.at), 0];
	const ttft: Part[] = timing.waitMs === undefined ? [] : [[`ttft ${latency(timing.waitMs)}`, 2]];
	const stall: Part[] = timing.stallMs >= STALL_MS ? [[`stall ${latency(timing.stallMs)}`, 3]] : [];
	const speed = speedOf(timing);
	const rated: Part[] = speed === undefined ? [] : [[speed, 4]];

	if (timing.streaming) {
		if (timing.waitMs === undefined) return [clock, [`waiting ${latency(timing.waitingMs)}`, 0]];
		return [clock, ...ttft, [`writing ${latency(timing.writingMs)}`, 0], ...stall, ...rated];
	}
	if (message.stopReason === "aborted") return [clock, ...ttft, [`stopped at ${latency(timing.totalMs)}`, 0]];
	if (message.stopReason === "error") return [clock, ...ttft, [`failed at ${latency(timing.totalMs)}`, 0]];
	return [
		clock,
		...ttft,
		...(timing.serverMs === undefined ? [] : ([[`server ${latency(timing.serverMs)}`, 6]] as Part[])),
		...(timing.thoughtMs === undefined ? [] : ([[`thought ${latency(timing.thoughtMs)}`, 5]] as Part[])),
		[`total ${exactly(timing.totalMs)}`, 0],
		...stall,
		...rated,
	];
}

/** What's known of a call to the model, as much of it as fits. */
export function timingLine(
	timing: Timing | undefined,
	message: AnsweredMessage,
	width: number,
): string {
	let parts = partsOf(timing, message);
	const text = () => parts.map(([part]) => part).join("  ");
	while (visibleWidth(text()) > width) {
		const highest = Math.max(...parts.map(([, drop]) => drop));
		if (highest === 0) break;
		parts = parts.filter(([, drop]) => drop !== highest);
	}
	return text();
}
