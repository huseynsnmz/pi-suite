import { type KeyId, matchesKey } from "@earendil-works/pi-tui";

/** Cmd reaches Pi only through the kitty keyboard protocol, and not every Cmd key: these are free. */
const CMD_KEYS: Readonly<Record<string, string>> = { s: "115", o: "111" };

let reportsCmd: () => boolean = () => false;

/** Called with the terminal once there is one. It answers after the first draw. */
export function watchCmdKey(reports: () => boolean): void {
	reportsCmd = reports;
}

/** A Mac has Option where others have Alt, and Cmd where the terminal can send it. */
export function keyLabel(
	key: string,
	platform: string = process.platform,
	cmd: boolean = reportsCmd(),
): string {
	if (platform !== "darwin") return key;
	const letter = /^alt\+(.)$/.exec(key)?.[1];
	if (cmd && letter !== undefined && CMD_KEYS[letter] !== undefined) return `cmd+${letter}`;
	return key.replace(/\balt\+/g, "option+");
}

/** Cmd+S as the Alt+S that the shortcuts listen for. Undefined for any other input. */
export function cmdAsAlt(data: string): string | undefined {
	for (const [letter, code] of Object.entries(CMD_KEYS))
		if (matchesKey(data, `super+${letter}` as KeyId)) return `\u001b[${code};3u`;
	return undefined;
}
