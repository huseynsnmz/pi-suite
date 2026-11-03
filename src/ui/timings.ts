import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import type { AnsweredMessage } from "../render/timing.ts";

export type TimingSource = (message: AnsweredMessage, width: number) => string | undefined;

const PAD = 1;

let source: TimingSource = () => undefined;
let installed = false;

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
		return [...lines, truncateToWidth(`${" ".repeat(PAD)}${line}`, width)];
	};
}
