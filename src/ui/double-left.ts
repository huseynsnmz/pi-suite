/** Left arrow twice on an empty prompt puts this session on the board and opens it. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey } from "@earendil-works/pi-tui";
import { createDoublePress } from "../core/double-press.mjs";

const WIDGET = "agent-board-double-left";

type Editorish = { getExpandedText?: () => string };

export function watchDoubleLeft(ctx: ExtensionContext): () => void {
	// Only a widget is handed the TUI, and only the TUI knows what has focus: without this check,
	// the Enter below could answer a dialog that's on screen.
	let focused: () => unknown = () => null;
	ctx.ui.setWidget(WIDGET, (tui) => {
		// Newer than some versions of Pi this may load in. Without it, double left does nothing.
		focused = () => (tui as unknown as { getFocusedComponent?: () => unknown }).getFocusedComponent?.();
		return { render: () => [], invalidate() {} };
	});
	const presses = createDoublePress();
	const stop = ctx.ui.onTerminalInput((data) => {
		if (isKeyRelease(data)) return undefined;
		const editor = focused() as Editorish | null | undefined;
		if (!matchesKey(data, Key.left) || editor?.getExpandedText?.() !== "") {
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
		ctx.ui.setWidget(WIDGET, undefined);
	};
}
