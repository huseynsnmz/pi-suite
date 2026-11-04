/**
 * Pi's own commands. It doesn't export this list, and pi.getCommands() leaves them out.
 * From pi-coding-agent 1.5.0, dist/core/slash-commands.js.
 */
export const BUILTIN_COMMANDS = [
	["settings", "Open settings menu"],
	["model", "Select model (opens selector UI)"],
	["tree", "Navigate session tree (switch branches)"],
	["thinking", "Set thinking level"],
	["scoped-models", "Enable/disable models for Ctrl+P cycling"],
	["export", "Export session (HTML default, or specify path: .html/.jsonl)"],
	["import", "Import a JSONL session, preserving its ID and working directory"],
	["share", "Share session via a Radius artifact or a GitHub gist"],
	["bug", "Report a bug to the Pi developers"],
	["copy", "Copy last agent message to clipboard"],
	["name", "Set session display name"],
	["session", "Show session info and stats"],
	["changelog", "Show changelog entries"],
	["hotkeys", "Show all keyboard shortcuts"],
	["fork", "Create a new fork from a previous user message"],
	["clone", "Duplicate the current session at the current position"],
	["trust", "Save project trust decision for future sessions"],
	["login", "Configure provider authentication"],
	["logout", "Remove provider authentication"],
	["new", "Start a new session"],
	["compact", "Manually compact the session context"],
	["resume", "Resume another session"],
	["reload", "Reload keybindings, extensions, skills, prompts, themes, and context files"],
	["quit", "Quit Pi"],
].map(([name, description]) => ({ name, description, source: "builtin" }));

/**
 * What the board offers after `/`: Pi's commands, then what extensions, templates and skills add.
 * @param {{ name: string, description?: string, source: string }[]} added from pi.getCommands()
 */
export function boardCommands(added) {
	const seen = new Set(BUILTIN_COMMANDS.map((command) => command.name));
	return [...BUILTIN_COMMANDS, ...added.filter((command) => !seen.has(command.name))];
}

/**
 * Commands act on the Pi the board is open in. Templates and skills are prompts, so they
 * start a session like any task, and so does anything that isn't a command.
 * @param {string} text
 * @param {{ name: string, source: string }[]} commands
 */
export function runsInPi(text, commands) {
	if (!text.startsWith("/")) return false;
	const name = text.slice(1).split(/\s/, 1)[0];
	const command = commands.find((candidate) => candidate.name === name);
	return command !== undefined && command.source !== "prompt" && command.source !== "skill";
}
