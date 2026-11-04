import assert from "node:assert/strict";
import test from "node:test";
import { isOpenableLink, findHttpUrlAtCells, findHttpUrlRangeAtCells, findWordRangeAtCells, trimTrailingUrlPunctuation } from "../src/core/pty-links.mjs";

test("trimTrailingUrlPunctuation removes unmatched wrappers and punctuation", () => {
	assert.equal(trimTrailingUrlPunctuation("https://example.com."), "https://example.com");
	assert.equal(trimTrailingUrlPunctuation("https://en.wikipedia.org/wiki/Function_(mathematics))"), "https://en.wikipedia.org/wiki/Function_(mathematics)");
});

test("findHttpUrlAtCells finds plain urls at clicked column", () => {
	const cells = Array.from("1. https://developer.mozilla.org docs");
	assert.equal(findHttpUrlAtCells(cells, 6), "https://developer.mozilla.org");
	assert.equal(findHttpUrlAtCells(cells, 30), "https://developer.mozilla.org");
	assert.equal(findHttpUrlAtCells(cells, 2), null);
});

test("findHttpUrlRangeAtCells returns clickable span", () => {
	const cells = Array.from("(https://openai.com)");
	assert.deepEqual(findHttpUrlRangeAtCells(cells, 10), {
		text: "https://openai.com",
		start: 1,
		end: 18,
	});
});

test("findWordRangeAtCells selects word and prefers full url", () => {
	assert.deepEqual(findWordRangeAtCells(Array.from("hello world"), 7), {
		text: "world",
		start: 6,
		end: 10,
		kind: "word",
	});
	assert.deepEqual(findWordRangeAtCells(Array.from("see https://github.com now"), 12), {
		text: "https://github.com",
		start: 4,
		end: 21,
		kind: "url",
	});
});

for (const [name, target, want] of [
	["opens a web link", "https://example.com/a?b=1", true],
	["opens a plain http link", "http://localhost:3000", true],
	["refuses a file link, which could start an app", "file:///Applications/Calculator.app", false],
	["refuses a custom scheme", "x-man-page://ls", false],
	["refuses what open would read as an option", "-a Calculator", false],
	["refuses a scheme with nothing after it", "https://", false],
]) {
	test(`isOpenableLink ${name}`, () => assert.equal(isOpenableLink(target), want));
}
