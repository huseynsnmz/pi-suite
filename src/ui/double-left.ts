/** Left arrow twice on an empty prompt puts this session on the board and opens it. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey } from "@earendil-works/pi-tui";
import { createDoublePress } from "../core/double-press.mjs";
import { watchFocus } from "./focus.ts";

export function watchDoubleLeft(ctx: ExtensionContext): () => void {
	const focus = watchFocus(ctx, "agent-board-double-left");
	const presses = createDoublePress();
	const stop = ctx.ui.onTerminalInput((data) => {
		if (isKeyRelease(data)) return undefined;
		// Checked first: the Enter below could otherwise answer a dialog that's on screen.
		if (!matchesKey(data, Key.left) || focus.promptText() !== "") {
			presses.reset();
			return undefined;
		}
		if (!presses.press()) return undefined;
		// A command runs with more than a key handler is given, so this goes the way a typed one does.
		ctx.ui.setEditorText("/bg");
		return { data: "\r" };
	});
	return () => {
		stop();
		focus.stop();
	};
}
