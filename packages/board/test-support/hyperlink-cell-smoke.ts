import { PtyAttachComponent } from "../src/ui/pty-attach.ts";

const tui = {
	terminal: { rows: 12, cols: 80, columns: 80, write: () => {} },
	requestRender: () => {},
};
const theme = { fg: (_c: string, text: string) => text, bold: (text: string) => text };

function hyperlink(text: string, url: string): string {
	return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

async function project(data: string): Promise<string[][]> {
	const attach = new PtyAttachComponent(
		tui as never,
		theme,
		{} as never,
		() => {},
		{ socketPath: "/no/such/socket", title: "hyperlink-cell" },
	);
	try {
		// SAFETY: These are the component's real private members; the fixture bypasses the socket to feed PTY output.
		const internals = attach as unknown as {
			term: { write: (data: string, callback: () => void) => void };
			receivedOutput: boolean;
			finishAttachTransition: () => void;
		};
		await new Promise<void>((resolve) => internals.term.write(`${data}\x1b[?25l`, resolve));
		internals.receivedOutput = true;
		internals.finishAttachTransition();
		return [attach.render(80).slice(1, -1), attach.render(80).slice(1, -1)];
	} finally {
		attach.dispose();
	}
}

console.log(JSON.stringify({
	read: await project(
		`read ${hyperlink("bin/with-test-lock", "file:///tmp/bin/with-test-lock")} complete\r\n` +
		"status: ready\r\n\r\n\x1b[32mfooter\x1b[0m",
	),
	multiple: await project(
		`prefix ${hyperlink("first", "file:///tmp/first")} middle ` +
		`${hyperlink("second", "file:///tmp/second")} suffix\r\n` +
		"\x1b[4mordinary underline\x1b[0m\r\nfooter",
	),
}));
