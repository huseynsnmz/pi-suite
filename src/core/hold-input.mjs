/**
 * While the board or an attached session is on screen, it owns the keyboard. Pi offers extensions'
 * key listeners every key first, so without this a listener in the Pi behind the overlay can take a
 * key: pi-modes' Shift+Tab, for one, changed that Pi's permission mode and never reached the session.
 *
 * Fullscreen Pi's mouse handling is a listener too, and has to keep running. It's added when the TUI
 * is built, so it's first in the set. Listeners added or removed meanwhile, as a session change does,
 * still apply once released. Does nothing if pi-tui changes shape, which leaves today's behavior.
 *
 * @param {any} tui
 * @returns {() => void} gives the keys back
 */
export function holdInputListeners(tui) {
	const listeners = tui?.inputListeners;
	if (!(listeners instanceof Set)) return () => {};
	const kept = typeof tui.handleViewportInput === "function" ? [...listeners].slice(0, 1) : [];
	const held = {
		size: kept.length,
		add: (listener) => listeners.add(listener),
		delete: (listener) => listeners.delete(listener),
		[Symbol.iterator]: () => kept[Symbol.iterator](),
	};
	tui.inputListeners = held;
	return () => {
		if (tui.inputListeners === held) tui.inputListeners = listeners;
	};
}
