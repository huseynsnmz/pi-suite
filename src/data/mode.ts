// The mode pi-modes reports. It only publishes a status, so the text is the contract.
import { stripTerminalSequences } from "@earendil-works/pi-tui";

const MODE_STATUS = "pi-modes";
const REPORTED = /^mode: (normal|auto|plan|read-only)$/;

type Mode = "normal" | "auto" | "plan" | "read-only";

/** The same colors pi-modes gives the word. In `normal`, the frame stays pi's own. */
const FRAME_COLORS = { auto: "warning", plan: "accent", "read-only": "success" } as const;

export function modeOf(statuses: ReadonlyMap<string, string>): Mode | undefined {
	const status = statuses.get(MODE_STATUS);
	if (status === undefined) return undefined;
	return REPORTED.exec(stripTerminalSequences(status).trim())?.[1] as Mode | undefined;
}

export function frameColorOf(
	statuses: ReadonlyMap<string, string>,
): (typeof FRAME_COLORS)[keyof typeof FRAME_COLORS] | undefined {
	const mode = modeOf(statuses);
	return mode === undefined || mode === "normal" ? undefined : FRAME_COLORS[mode];
}
