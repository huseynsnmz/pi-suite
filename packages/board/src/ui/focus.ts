/** What has the keyboard, which only the TUI knows, and only a widget is handed the TUI. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Editorish = { getExpandedText?: () => string };

export interface Focus {
	/** The prompt's text if it has the keyboard, or undefined if something else does. */
	promptText(): string | undefined;
	/** Whether anything is known about what has the keyboard, on this version of Pi. */
	known(): boolean;
	stop(): void;
}

export function watchFocus(ctx: ExtensionContext, widget: string): Focus {
	let focused: (() => unknown) | null = null;
	ctx.ui.setWidget(widget, (tui) => {
		const reader = tui as unknown as { getFocusedComponent?: () => unknown };
		if (reader.getFocusedComponent) focused = () => reader.getFocusedComponent?.();
		return { render: () => [], invalidate() {} };
	});
	return {
		promptText: () => (focused?.() as Editorish | null | undefined)?.getExpandedText?.(),
		known: () => focused !== null,
		stop: () => {
			try {
				ctx.ui.setWidget(widget, undefined);
			} catch {
				/* the session it belonged to has already gone, and its widget with it */
			}
		},
	};
}
