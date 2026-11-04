// Text from a model, a repository or another program must not drive the terminal: no clipboard
// writes, no moved cursor, no command that reads differently from what runs.

// oxlint-disable-next-line no-control-regex -- escape sequences are what this removes
const ESCAPE = /\u001b(?:\[[0-?]*[ -/]*[@-~]?|[\]PX^_][^\u0007\u001b\n]*(?:\u0007|\u001b\\)?|[ -/]*[0-~]?)/g;
// oxlint-disable-next-line no-control-regex -- color codes are escape sequences
const COLOR = /^\u001b\[[0-9;:]*m$/;
/** Keeps tabs and line breaks. ESCAPE has already taken every escape character. */
// oxlint-disable-next-line no-control-regex -- control characters are what this removes
const CONTROLS = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

export function plainText(text: string): string {
	return text.replace(ESCAPE, "").replace(CONTROLS, "");
}

/** For lines already painted: keeps the colors and nothing else that talks to the terminal. */
export function styledText(text: string): string {
	return text.replace(ESCAPE, (found) => (COLOR.test(found) ? found : "")).replace(CONTROLS, "");
}
