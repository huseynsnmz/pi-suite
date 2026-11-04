import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import type { AnsweredMessage } from "../render/timing.ts";

export type TimingSource = (message: AnsweredMessage, width: number) => string | undefined;

const PAD = 1;

let source: TimingSource = () => undefined;
let installed = false;

interface Drawn {
	source: readonly string[];
	line: string;
	width: number;
	lines: string[];
}

/** Every message in the session draws again on each keypress, so a long one must not redo this work. */
const drawnBefore = new WeakMap<object, Drawn>();

function sameLines(a: readonly string[], b: readonly string[]): boolean {
	return a === b || (a.length === b.length && a.every((line, index) => line === b[index]));
}

/**
 * Pi has no hook for what follows a response, so this adds a line to its drawing. It asks on each
 * drawing, so the line keeps up while the response is written. Calling again changes the source.
 */
export function showTimings(next: TimingSource): void {
	source = next;
	if (installed) return;
	installed = true;
	const prototype = AssistantMessageComponent.prototype;
	const render = prototype.render;
	prototype.render = function (this: AssistantMessageComponent, width: number): string[] {
		const lines = render.call(this, width);
		const message = (this as unknown as { lastMessage?: AnsweredMessage }).lastMessage;
		const line = message === undefined ? undefined : source(message, Math.max(1, width - PAD));
		if (line === undefined) return lines;
		const known = drawnBefore.get(this);
		if (known?.line === line && known.width === width && sameLines(known.source, lines)) return known.lines;
		const drawn = [...lines, truncateToWidth(`${" ".repeat(PAD)}${line}`, width)];
		drawnBefore.set(this, { source: lines, line, width, lines: drawn });
		return drawn;
	};
}
