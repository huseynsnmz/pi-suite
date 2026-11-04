// The mode pi-modes reports. It only publishes a status, so the text is the contract.
import { stripTerminalSequences } from "@earendil-works/pi-tui";

const MODE_STATUS = "pi-modes";
const REPORTED = /^mode: (normal|auto|plan|read-only|yolo)$/;

export type Mode = "normal" | "auto" | "plan" | "read-only" | "yolo";

/** The same colors pi-modes gives the word. In `normal`, the frame stays pi's own. */
const FRAME_COLORS = { auto: "warning", plan: "accent", "read-only": "success", yolo: "error" } as const;

export function modeOf(statuses: ReadonlyMap<string, string>): Mode | undefined {
	const status = statuses.get(MODE_STATUS);
	if (status === undefined) return undefined;
	return REPORTED.exec(stripTerminalSequences(status).trim())?.[1] as Mode | undefined;
}

/** A message's frame stays pi's own in `normal` too. */
export function modeColor(mode: Mode): (typeof FRAME_COLORS)[keyof typeof FRAME_COLORS] | undefined {
	return mode === "normal" ? undefined : FRAME_COLORS[mode];
}

export function frameColorOf(
	statuses: ReadonlyMap<string, string>,
): (typeof FRAME_COLORS)[keyof typeof FRAME_COLORS] | undefined {
	const mode = modeOf(statuses);
	return mode === undefined ? undefined : modeColor(mode);
}

/** Saved with the session, so a resumed conversation still shows which mode each message went out in. */
export const SENT_IN_ENTRY = "pi-frame-sent-in";

/** The session entry of each message sent in a mode, joined on the message's timestamp, since a live message has no entry yet. */
export function sentInFromEntries(
	entries: readonly { type: string; id?: string; customType?: string; data?: unknown; message?: { role?: string; timestamp?: number } }[],
): Map<string, Mode> {
	const byTime = new Map<number, Mode>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== SENT_IN_ENTRY) continue;
		const { at, mode } = (entry.data ?? {}) as { at?: unknown; mode?: unknown };
		if (typeof at === "number" && typeof mode === "string" && REPORTED.test(`mode: ${mode}`)) byTime.set(at, mode as Mode);
	}
	const sent = new Map<string, Mode>();
	for (const entry of entries) {
		const mode = entry.type === "message" && entry.message?.role === "user" ? byTime.get(entry.message.timestamp ?? -1) : undefined;
		if (mode !== undefined && entry.id !== undefined) sent.set(entry.id, mode);
	}
	return sent;
}
