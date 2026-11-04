import type { PtyAttachComponent } from "../src/ui/pty-attach.ts";

/** Typed test-only access to real private members, without changing the instance. */
export function fixtureInternals<T>(instance: unknown): T {
	// SAFETY: Callers declare the actual private-member shape of their fixture;
	// this helper exposes it only for test-state setup and transport replacement.
	return instance as T;
}

/** Feed the production output paths and wait for xterm's asynchronous parser. */
export async function feedAttachOutput(attach: PtyAttachComponent, data: string, source: "live" | "snapshot" | "history" = "live"): Promise<void> {
	// SAFETY: These are the component's private production methods. Only the
	// transport is bypassed; parsing and readiness updates remain unchanged.
	const internals = attach as unknown as {
		pushOutput: (data: string, opts?: { forwardProtocols?: boolean }) => void;
		handleAttachEvent: (event: string, payload: unknown) => void;
		term: { write: (data: string, callback: () => void) => void };
	};
	if (source === "snapshot") internals.handleAttachEvent("snapshotReady", { frame: data });
	else internals.pushOutput(data, { forwardProtocols: source === "live" });
	await new Promise<void>((resolve) => internals.term.write("", resolve));
}
