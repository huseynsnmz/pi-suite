import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";

/** Private in pi. If a release renames them, reasoning just follows pi's setting again. */
interface Message {
	updateContent(message: { content: readonly { type: string }[] }, isStreaming?: boolean): void;
	isStreaming?: boolean;
	thinkingVisibilityOverrides?: Map<number, boolean>;
}

const live = new WeakSet<object>();
let isActive: () => boolean = () => false;
let installed = false;

/**
 * With pi's setting that collapses reasoning on, it still shows while it's being written, and
 * collapses once the message is done. Ctrl+T or a click opens it again.
 */
export function showThinkingWhileLive(active: () => boolean): void {
	isActive = active;
	if (installed) return;
	installed = true;
	const prototype = AssistantMessageComponent.prototype as unknown as Message;
	const own = prototype.updateContent;
	prototype.updateContent = function updateContent(this: Message, message, isStreaming = this.isStreaming) {
		const overrides = this.thinkingVisibilityOverrides;
		if (overrides !== undefined && isActive() && isStreaming === true) {
			live.add(this);
			message.content.forEach((_part, run) => overrides.set(run, false));
		} else if (overrides !== undefined && live.delete(this)) {
			overrides.clear();
		}
		own.call(this, message, isStreaming);
	};
}
