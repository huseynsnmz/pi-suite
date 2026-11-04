/**
 * The board's settings, from `~/.pi/agent/extensions/pi-board/config.json`.
 *
 * The runners are separate processes that read `AGENT_BOARD_*` from their environment, so a
 * setting reaches them by being put there before anything starts. A variable that's already set
 * wins, which keeps one run's override and the tests working.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Which model each kind of helper call uses when the config has none of its own. */
const MODEL_VARS = ["AGENT_BOARD_AUTO_STATE_MODEL", "AGENT_BOARD_SUMMARY_MODEL", "AGENT_BOARD_TITLE_MODEL"];

const off = (value) => (value ? "1" : "0");
const SETTINGS = {
	root: ["AGENT_BOARD_ROOT", String],
	titleThinking: ["AGENT_BOARD_TITLE_THINKING_LEVEL", String],
	autoDone: ["AGENT_BOARD_AUTO_STATE_NO_DONE", (value) => (value ? "0" : "1")],
	codeRefs: ["AGENT_BOARD_CODE_REFS", (value) => (value ? "1" : "off")],
	disablePty: ["AGENT_BOARD_DISABLE_PTY", (value) => (value ? "1" : "")],
	attachMouse: ["AGENT_BOARD_ATTACH_MOUSE", off],
	mouseScroll: ["AGENT_BOARD_ENABLE_MOUSE_SCROLL", off],
	wheelLines: ["AGENT_BOARD_WHEEL_LINES", String],
	maxWarmHosts: ["AGENT_BOARD_MAX_WARM_HOSTS", String],
	warmHostTtlMs: ["AGENT_BOARD_WARM_HOST_TTL_MS", String],
	nativePaste: ["AGENT_BOARD_ATTACH_NATIVE_PASTE", off],
	forwardClipboard: ["AGENT_BOARD_FORWARD_OSC52", off],
	forwardImages: ["AGENT_BOARD_FORWARD_IMAGES", off],
	imeFix: ["AGENT_BOARD_IME_FIX", off],
	terminalSnapshot: ["AGENT_BOARD_TERMINAL_SNAPSHOT", off],
	replyGuard: ["AGENT_BOARD_REPLY_GUARD", off],
};

/** @param {NodeJS.ProcessEnv} [env] */
export function configPath(env = process.env) {
	const agentDir = env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
	return path.join(agentDir, "extensions", "pi-board", "config.json");
}

/** A missing or broken file is the defaults: the board must still open. */
export function readConfig(file = configPath()) {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

export function writeConfig(changes, file = configPath()) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify({ ...readConfig(file), ...changes }, null, 2)}\n`);
}

/** Helper model calls cost money and send text to a provider, so they're off until one is chosen. */
export function configEnv(config) {
	const vars = {};
	for (const [key, [name, convert]] of Object.entries(SETTINGS)) {
		if (config[key] !== undefined && config[key] !== null) vars[name] = convert(config[key]);
	}
	const models = typeof config.model === "string" && config.model ? config.model : "off";
	for (const name of MODEL_VARS) vars[name] = models;
	return vars;
}

export function applyConfig(env = process.env, config = readConfig(configPath(env))) {
	for (const [name, value] of Object.entries(configEnv(config))) {
		if (env[name] === undefined) env[name] = value;
	}
}

/** Takes effect for sessions started from now on. */
export function setHelperModel(model, env = process.env, file = configPath(env)) {
	writeConfig({ model }, file);
	for (const name of MODEL_VARS) env[name] = model ?? "off";
}
