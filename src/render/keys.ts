import { type KeyId, matchesKey } from "@earendil-works/pi-tui";

/** Opens the settings. Alt+S belongs to pi-sandbox, which can't be rebound. */
export const SETTINGS_KEY = "ctrl+s";

/**
 * Pi warns at every start about a shortcut on Ctrl+S, which its pickers use for themselves. So the
 * shortcut sits here and the editor passes Ctrl+S on to it, which leaves the pickers their key.
 */
export const SETTINGS_SHORTCUT = "ctrl+alt+s";
export const SETTINGS_SHORTCUT_INPUT = "\u001b[115;7u";

/** Cmd reaches Pi only through the kitty keyboard protocol, and not every Cmd key: these are free. */
const CMD_KEYS: Readonly<Record<string, { key: string; sends: string }>> = {
	s: { key: SETTINGS_KEY, sends: "\u0013" },
	o: { key: "alt+o", sends: "\u001b[111;3u" },
};

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
	const letter = Object.keys(CMD_KEYS).find((name) => CMD_KEYS[name]?.key === key);
	if (cmd && letter !== undefined) return `cmd+${letter}`;
	return key.replace(/\balt\+/g, "option+");
}

/**
 * On a Mac, Option+S types `ß` unless the terminal sends Option as Alt, so the sandbox's Alt+S
 * never fires. Without the sandbox this stays a plain `ß`.
 */
export function optionSAsAlt(data: string, platform: string = process.platform): string | undefined {
	return platform === "darwin" && (data === "ß" || data === "\u001b[223u") ? "\u001b[115;3u" : undefined;
}

/** A Cmd key as the key its shortcut listens for. Undefined for any other input. */
export function cmdAsKey(data: string): string | undefined {
	for (const [letter, { sends }] of Object.entries(CMD_KEYS))
		if (matchesKey(data, `super+${letter}` as KeyId)) return sends;
	return undefined;
}
