import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyConfig, configEnv, readConfig, setHelperModel } from "../src/core/config.mjs";

const MODELS = ["AGENT_BOARD_AUTO_STATE_MODEL", "AGENT_BOARD_SUMMARY_MODEL", "AGENT_BOARD_TITLE_MODEL"];

test("helper models are off until one is chosen, and one model drives all three", () => {
	for (const name of MODELS) {
		assert.equal(configEnv({})[name], "off");
		assert.equal(configEnv({ model: "a/b" })[name], "a/b");
	}
});

test("settings become the variables the runners read", () => {
	const vars = configEnv({ wheelLines: 3, forwardClipboard: false, autoDone: true, disablePty: true, codeRefs: false });
	assert.equal(vars.AGENT_BOARD_WHEEL_LINES, "3");
	assert.equal(vars.AGENT_BOARD_FORWARD_OSC52, "0");
	assert.equal(vars.AGENT_BOARD_AUTO_STATE_NO_DONE, "0");
	assert.equal(vars.AGENT_BOARD_DISABLE_PTY, "1");
	assert.equal(vars.AGENT_BOARD_CODE_REFS, "off");
});

test("a variable already set wins over the config", () => {
	const env = { AGENT_BOARD_SUMMARY_MODEL: "x/y" };
	applyConfig(env, { model: "a/b" });
	assert.equal(env.AGENT_BOARD_SUMMARY_MODEL, "x/y");
	assert.equal(env.AGENT_BOARD_TITLE_MODEL, "a/b");
});

test("a broken file is the defaults, and choosing a model keeps other settings", () => {
	const dir = mkdtempSync(join(tmpdir(), "board-config-"));
	try {
		const file = join(dir, "sub", "config.json");
		assert.deepEqual(readConfig(file), {});
		const env = {};
		setHelperModel("a/b", env, file);
		assert.equal(env.AGENT_BOARD_TITLE_MODEL, "a/b");
		writeFileSync(file, JSON.stringify({ model: "a/b", wheelLines: 2 }));
		setHelperModel(null, env, file);
		assert.deepEqual(readConfig(file), { model: null, wheelLines: 2 });
		assert.equal(env.AGENT_BOARD_TITLE_MODEL, "off");
		writeFileSync(file, "{nope");
		assert.deepEqual(readConfig(file), {});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
