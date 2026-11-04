/** How close two presses must be to count as one double press. */
export const DOUBLE_PRESS_MS = 400;

/**
 * Tells a second press apart from a first. Anything else in between starts over.
 * @param {() => number} [now]
 * @returns {{ press(): boolean, reset(): void }} press() is true on the second press.
 */
export function createDoublePress(now = Date.now) {
	let last = null;
	return {
		press() {
			const at = now();
			const second = last !== null && at - last <= DOUBLE_PRESS_MS;
			last = second ? null : at;
			return second;
		},
		reset() {
			last = null;
		},
	};
}
