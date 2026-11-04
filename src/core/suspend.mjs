/**
 * Ctrl+Z from the board or an attached session. Pi only handles it at its own prompt. Sent on to a
 * session it would stop that session's screen for good: nothing there can be stopped or resumed,
 * since a session has no shell. Stops only this Pi, as sessions run in their own process groups.
 *
 * The same steps as Pi's own, which an extension can't call. On Windows `app.suspend` has no key,
 * so this isn't reached.
 *
 * @param {{ start(): void, stop(): void, requestRender(force?: boolean): void }} tui
 * @param {{ beforeStop?: () => void, afterResume?: () => void }} [hooks]
 */
export function suspendToShell(tui, hooks = {}) {
	// Without a handle holding the event loop open, Node could exit on `fg` before SIGCONT arrives.
	const keepAlive = setInterval(() => {}, 2 ** 30);
	// Ctrl+C at the shell mustn't kill what's in the background.
	const ignoreSigint = () => {};
	process.on("SIGINT", ignoreSigint);
	const finish = () => {
		clearInterval(keepAlive);
		process.removeListener("SIGINT", ignoreSigint);
	};
	process.once("SIGCONT", () => {
		finish();
		tui.start();
		hooks.afterResume?.();
		tui.requestRender(true);
	});
	try {
		hooks.beforeStop?.();
		tui.stop();
		process.kill(0, "SIGTSTP");
	} catch (error) {
		finish();
		throw error;
	}
}
