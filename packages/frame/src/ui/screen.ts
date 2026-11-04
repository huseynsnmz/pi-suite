import type { Snapshot } from "../data/snapshot.ts";
import type { Piece } from "../render/fit.ts";
import type { FrameStyle } from "../render/frame.ts";
import type { Glyphs } from "../render/glyphs.ts";
import type { Paint } from "../render/paint.ts";
import { renderSegments, type SegmentId, type SegmentOptions } from "../render/segments.ts";
import type { CursorStyle } from "../settings.ts";

export type SlotName =
	| "strip"
	| "stripRight"
	| "topLeft"
	| "topRight"
	| "bottomLeft"
	| "bottomRight"
	| "below"
	| "belowRight";

export interface Screen {
	snapshot(): Snapshot;
	glyphs(): Glyphs;
	paint(frame?: (text: string) => string): Paint;
	separator(): string;
	options(): SegmentOptions;
	slot(name: SlotName): readonly SegmentId[];
	frameStyle(): FrameStyle | "off";
	/** Undefined leaves the frame in pi's own color. */
	frameColor(): ((text: string) => string) | undefined;
	cursor(): CursorStyle;
	decorate(line: string): string;
	/** The color of a `/command` or `!command` at the start of the prompt. */
	promptColor(kind: "command" | "bash"): (text: string) => string;
	/** What was typed in this folder's sessions, newest first. */
	pastPrompts(): string[];
	skills(): boolean;
	/** Changes when another package reports something new. */
	statusesKey(): string;
	/** A short message for the bottom line, in place of the session's numbers. */
	notice(): string | undefined;
	/** Ctrl+C with the editor focused, typed text included so it can be cleared. */
	interrupt(clearEditor: () => void): void;
	/** Compared by anything that keeps a drawing, so a change does not wait for the next keystroke. */
	revision(): number;
	bump(): void;
}

export function slotPieces(
	screen: Screen,
	name: SlotName,
	snapshot: Snapshot,
	paint: Paint,
): Piece[] {
	return renderSegments(screen.slot(name), {
		snapshot,
		glyphs: screen.glyphs(),
		paint,
		options: screen.options(),
	});
}
