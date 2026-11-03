// Ctrl+C: stops the run if there is one, then asks once more before leaving.
// Pi's own double press has half a second, too short to read a message about it.
export const EXIT_WINDOW_MS = 2000;

export interface InterruptState {
	/** The second press before this time exits. */
	armedUntil?: number;
}

export type InterruptAction = "abort" | "arm" | "exit";

/** Stopping a run never arms the exit, so a double press to stop it cannot close Pi. */
export function nextInterrupt(
	state: InterruptState,
	idle: boolean,
	now: number,
): { action: InterruptAction; state: InterruptState } {
	if (!idle) return { action: "abort", state: {} };
	if (state.armedUntil !== undefined && now < state.armedUntil) return { action: "exit", state: {} };
	return { action: "arm", state: { armedUntil: now + EXIT_WINDOW_MS } };
}
