import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadSettings, parseSettings, PART_NAMES, saveSettings, separateInstalls } from "../src/settings.ts";

const dir = () => mkdtempSync(join(tmpdir(), "suite-"));

test("modes loads first, so its checks see tool calls before anything else", () => {
  assert.equal(PART_NAMES[0], "modes");
});

test("listed parts are off, and everything else is on", () => {
  assert.deepEqual([...parseSettings('{"off":["web","board"]}').off], ["web", "board"]);
  assert.deepEqual([...parseSettings("{}").off], []);
});

for (const [name, text] of [
  ["broken JSON", "{oops"],
  ["the wrong shape", '{"off":"web"}'],
  ["an array", "[]"],
  ["null", "null"],
  ["an unknown part", '{"off":["modes","wbe"]}'],
  ["a part that isn't text", '{"off":[1]}'],
] as const) {
  test(`${name} leaves everything on and says so, so a typo can't turn off plan mode`, () => {
    const loaded = parseSettings(text);
    assert.equal(loaded.off.size, 0);
    assert.ok(loaded.problem);
  });
}

test("no file means everything is on, and what's saved loads again", () => {
  const agent = dir();
  assert.equal(loadSettings(agent).off.size, 0);
  saveSettings(agent, new Set(["board", "web"]));
  assert.deepEqual(JSON.parse(readFileSync(join(agent, "suite.json"), "utf8")), { off: ["web", "board"] });
  assert.deepEqual([...loadSettings(agent).off].sort(), ["board", "web"]);
  writeFileSync(join(agent, "suite.json"), "{oops");
  assert.ok(loadSettings(agent).problem);
});

test("separate installs of the same parts are found, and other packages aren't", () => {
  assert.deepEqual(
    separateInstalls(["npm:@huseynsnmz/pi-frame@0.5.0", { source: "npm:@huseynsnmz/pi-modes" }, "npm:@huseynsnmz/pi-suite@0.1.0", "npm:pi-sandbox@0.7.3", "npm:@huseynsnmz/pi-frameworks"]),
    ["npm:@huseynsnmz/pi-frame@0.5.0", "npm:@huseynsnmz/pi-modes"],
  );
  assert.deepEqual(separateInstalls(undefined), []);
});
