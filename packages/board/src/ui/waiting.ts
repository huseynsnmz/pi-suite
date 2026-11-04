/**
 * Tells the board when a session is waiting on you. A permission prompt or any other dialog takes
 * the keyboard from the prompt while a run is under way, whichever extension opened it.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { watchFocus } from "./focus.ts";

const CHECK_MS = 500;

export function watchWaiting(ctx: ExtensionContext, changed: (waiting: boolean) => void): () => void {
	const focus = watchFocus(ctx, "agent-board-waiting");
	let waiting = false;
	const timer = setInterval(() => {
		try {
			const now = focus.known() && !ctx.isIdle() && focus.promptText() === undefined;
			if (now === waiting) return;
			waiting = now;
			// If the run has ended too, its own end has already said so, and this would undo that.
			if (now || !ctx.isIdle()) changed(now);
		} catch {
			// The session was replaced before this could be stopped. An error here would end Pi.
			clearInterval(timer);
		}
	}, CHECK_MS);
	timer.unref?.();
	return () => {
		clearInterval(timer);
		focus.stop();
	};
}
