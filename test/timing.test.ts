import { expect, test } from "bun:test";

import type { Timing } from "../src/data/telemetry.ts";
import { clockTime, exactly, timingLine } from "../src/render/timing.ts";

const at = new Date(2026, 10, 3, 14, 3, 22, 418).getTime();
const CLOCK = "14:03:22.418";
const done: Timing = {
	at,
	streaming: false,
	waitMs: 812,
	waitingMs: 812,
	serverMs: 240,
	thoughtMs: 1_900,
	totalMs: 4_218,
	writingMs: 3_406,
	stallMs: 0,
	output: 327,
	estimated: false,
};
const message = { timestamp: at };
const line = (timing: Timing | undefined, width = 200, stopReason?: string) =>
	timingLine(timing, { ...message, stopReason }, width);

test("clock times and durations keep their milliseconds", () => {
	expect(clockTime(at)).toBe(CLOCK);
	expect(exactly(812)).toBe("812ms");
	expect(exactly(4_218)).toBe("4.218s");
	expect(exactly(64_218)).toBe("1m 04.218s");
});

test("a finished call says all it knows", () => {
	expect(line(done)).toBe(`${CLOCK}  ttft 812ms  server 240ms  thought 1.9s  total 4.218s  96 tok/s`);
});

test("the line follows the call while it's written", () => {
	const live = { ...done, streaming: true };
	expect(line({ ...live, waitMs: undefined, waitingMs: 600, writingMs: 0, output: 0 })).toBe(`${CLOCK}  waiting 600ms`);
	expect(line({ ...live, writingMs: 2_100, output: 197, estimated: true })).toBe(`${CLOCK}  ttft 812ms  writing 2.1s  ~94 tok/s`);
});

test("a stall is named and left out of the speed, and a short pause isn't", () => {
	const stalled = { ...done, totalMs: 24_218, writingMs: 23_406, stallMs: 20_000 };
	expect(line(stalled)).toEndWith("total 24.218s  stall 20s  96 tok/s");
	expect(line({ ...done, stallMs: 1_999 })).not.toContain("stall");
});

test("a call that didn't finish says so, without a speed", () => {
	expect(line({ ...done, totalMs: 2_100 }, 200, "aborted")).toBe(`${CLOCK}  ttft 812ms  stopped at 2.1s`);
	expect(line({ ...done, waitMs: undefined, totalMs: 30_000 }, 200, "error")).toBe(`${CLOCK}  failed at 30s`);
});

test("short of room, the clock and total stay longest", () => {
	expect(line(done, 62)).toBe(`${CLOCK}  ttft 812ms  thought 1.9s  total 4.218s  96 tok/s`);
	expect(line(done, 50)).toBe(`${CLOCK}  ttft 812ms  total 4.218s  96 tok/s`);
	expect(line(done, 30)).toBe(`${CLOCK}  total 4.218s`);
});

test("a call with no record shows only its time", () => {
	expect(line(undefined)).toBe(CLOCK);
});
