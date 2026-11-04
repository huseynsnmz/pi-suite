/**
 * The board blanks Pi's header and footer while it is up. Pi can only hand them back as its
 * defaults, so this also tells any extension that drew its own to draw them again.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const BOARD_CLOSED_EVENT = "agent-board:closed";

let events: ExtensionAPI["events"] | null = null;

export function announceBoardClosedOn(bus: ExtensionAPI["events"]): void {
	events = bus;
}

export function restoreChrome(ctx: Pick<ExtensionContext, "ui">): void {
	ctx.ui.setHeader(undefined);
	ctx.ui.setFooter(undefined);
	ctx.ui.setWorkingVisible(true);
	events?.emit(BOARD_CLOSED_EVENT, undefined);
}
