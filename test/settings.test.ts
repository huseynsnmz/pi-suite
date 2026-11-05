import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { typedValue } from "../src/settings-ui.ts";
import { loadSettings, moveOldSettings, parseSettings, PART_NAMES, readSection, saveSettings, separateInstalls, writeSection } from "../src/settings.ts";

const dir = () => mkdtempSync(join(tmpdir(), "suite-"));

test("modes loads first, so its checks see tool calls before anything else", () => {
  assert.equal(PART_NAMES[0], "modes");
});

test("listed parts are off, and everything else is on", () => {
  assert.deepEqual([...parseSettings('{"off":["web","board"],"on":["subscription"]}').off], ["web", "board"]);
  assert.deepEqual([...parseSettings("{}").off], ["subscription"]);
  assert.deepEqual([...parseSettings('{"on":["subscription"]}').off], []);
  assert.deepEqual([...parseSettings('{"on":["subscription"],"off":["subscription"]}').off], ["subscription"]);
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
    assert.deepEqual([...loaded.off], ["subscription"]);
    assert.ok(loaded.problem);
  });
}

test("no file means everything is on, and what's saved loads again", () => {
  const agent = dir();
  assert.deepEqual([...loadSettings(agent).off], ["subscription"]);
  saveSettings(agent, new Set(["board", "web", "subscription"]));
  assert.deepEqual(JSON.parse(readFileSync(join(agent, "suite.json"), "utf8")), { off: ["web", "board"] });
  assert.deepEqual([...loadSettings(agent).off].sort(), ["board", "subscription", "web"]);
  saveSettings(agent, new Set(["board"]));
  assert.deepEqual(JSON.parse(readFileSync(join(agent, "suite.json"), "utf8")), { off: ["board"], on: ["subscription"] });
  assert.deepEqual([...loadSettings(agent).off], ["board"]);
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

test("old settings files move in once, and what's already here wins", () => {
  const agent = dir();
  writeFileSync(join(agent, "router.json"), JSON.stringify({ plan: "a/b", build: "c/d" }));
  writeFileSync(join(agent, "web.json"), JSON.stringify({ companySearch: true }));
  mkdirSync(join(agent, "extensions", "pi-modes"), { recursive: true });
  writeFileSync(join(agent, "extensions", "pi-modes", "config.json"), JSON.stringify({ defaultMode: "plan" }));
  mkdirSync(join(agent, "extensions", "pi-harness"), { recursive: true });
  writeFileSync(join(agent, "extensions", "pi-harness", "settings.json"), JSON.stringify({ frame: { icons: "ascii" } }));
  writeFileSync(join(agent, "suite.json"), JSON.stringify({ off: ["board"], web: { strictUrls: true } }));
  assert.deepEqual(moveOldSettings(agent), []);
  const saved = JSON.parse(readFileSync(join(agent, "suite.json"), "utf8"));
  assert.deepEqual(saved, { router: { plan: "a/b", build: "c/d" }, modes: { defaultMode: "plan" }, frame: { icons: "ascii" }, off: ["board"], web: { strictUrls: true } });
  assert.equal(existsSync(join(agent, "router.json")), false);
  assert.equal(existsSync(join(agent, "router.json.bak")), true);
  assert.equal(existsSync(join(agent, "web.json.bak")), true);
  assert.deepEqual(moveOldSettings(agent), []);
});

test("a broken old file stays where it is, is reported, and its part refuses rather than use nothing", () => {
  const agent = dir();
  writeFileSync(join(agent, "web.json"), "{oops");
  assert.match(moveOldSettings(agent)[0] ?? "", /web\.json can't be read/);
  assert.equal(readFileSync(join(agent, "web.json"), "utf8"), "{oops");
  assert.throws(() => readSection(agent, "web"), /Fix or delete it/);
});

test("sections keep each other, turning a part on keeps them, and a broken file isn't written over", () => {
  const agent = dir();
  writeSection(agent, "web", { strictUrls: true });
  writeSection(agent, "router", { plan: "a/b" });
  saveSettings(agent, new Set(["board"]));
  assert.deepEqual(readSection(agent, "web"), { strictUrls: true });
  assert.deepEqual(readSection(agent, "router"), { plan: "a/b" });
  writeSection(agent, "router", {});
  assert.equal("router" in JSON.parse(readFileSync(join(agent, "suite.json"), "utf8")), false);
  assert.equal(statSync(join(agent, "suite.json")).mode & 0o077, 0);
  writeFileSync(join(agent, "suite.json"), "{oops");
  assert.throws(() => writeSection(agent, "web", {}));
  assert.throws(() => saveSettings(agent, new Set()));
  assert.throws(() => readSection(agent, "web"));
  assert.equal(readFileSync(join(agent, "suite.json"), "utf8"), "{oops");
});

test("what's typed in /suite becomes the setting, or is refused", () => {
  const list = { key: "x", label: "X", kind: "list" } as const;
  const number = { key: "n", label: "N", kind: "number", min: 1, max: 10 } as const;
  assert.deepEqual(typedValue(list, " a.com, b.com ,, "), ["a.com", "b.com"]);
  assert.equal(typedValue(list, "  "), undefined);
  assert.equal(typedValue(number, "4"), 4);
  assert.throws(() => typedValue(number, "11"), /from 1 to 10/);
  assert.throws(() => typedValue(number, "lots"));
});
