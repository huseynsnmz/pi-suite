/** How close two presses must be to count as one double press. */
export const DOUBLE_PRESS_MS = 400;

/** Longer than Pi's own 500ms, or a session could take the second Ctrl+C and quit by itself. */
export const QUIT_PRESS_MS = 1000;

/**
 * Tells a second press apart from a first. Anything else in between starts over.
 * @param {() => number} [now]
 * @param {number} [windowMs]
 * @returns {{ press(): boolean, reset(): void }} press() is true on the second press.
 */
export function createDoublePress(now = Date.now, windowMs = DOUBLE_PRESS_MS) {
	let last = null;
	return {
		press() {
			const at = now();
			const second = last !== null && at - last <= windowMs;
			last = second ? null : at;
			return second;
		},
		reset() {
			last = null;
		},
	};
}
