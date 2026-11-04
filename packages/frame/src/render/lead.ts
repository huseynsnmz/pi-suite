/** How much of a prompt Pi will treat as a command: `/name` or `!command`, up to the first space. */
export function promptLead(text: string): { kind: "command" | "bash"; length: number } | undefined {
	const command = /^\/[\w:.-]+(?=\s|$)/.exec(text);
	if (command) return { kind: "command", length: command[0].length };
	const bash = /^!{1,2}\s*\S*/.exec(text);
	return bash ? { kind: "bash", length: bash[0].length } : undefined;
}

// oxlint-disable-next-line no-control-regex -- a rendered line carries escapes between its characters
const ESCAPE = /^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|[_\]][^\x07\x1b]*(?:\x07|\x1b\\))/;

/** Paints the first characters of a rendered line. Its escapes, like the cursor, stay where they are. */
export function paintLead(line: string, length: number, paint: (text: string) => string): string {
	let out = "";
	let run = "";
	let left = length;
	let at = 0;
	const flush = () => {
		if (run) out += paint(run);
		run = "";
	};
	while (at < line.length && left > 0) {
		const escape = ESCAPE.exec(line.slice(at));
		if (escape) {
			flush();
			out += escape[0];
			at += escape[0].length;
			continue;
		}
		const char = String.fromCodePoint(line.codePointAt(at) as number);
		run += char;
		at += char.length;
		left--;
	}
	flush();
	return out + line.slice(at);
}
