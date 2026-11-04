import { describe, expect, test } from "bun:test";

import { plainText, styledText } from "../src/render/safe.ts";

const ATTACKS: [string, string][] = [
	["clipboard write", "\u001b]52;c;QUJD\u0007"],
	["window title", "\u001b]0;pwned\u001b\\"],
	["clear screen", "\u001b[2J"],
	["cursor move", "\u001b[1;1H"],
	["full reset", "\u001bc"],
	["device control", "\u001bP+q\u001b\\"],
	["private message", "\u001b^x\u001b\\"],
	["c1 control sequence", "\u009b2J"],
	["c1 string", "\u009d0;x\u009c"],
	["bell", "\u0007"],
	["backspace over text", "\b\b"],
	["carriage return", "\r"],
	["bidi override", "‮"],
	["bidi isolate", "⁦"],
	["escape split by a null", "\u001b\u0000[2J"],
];

describe("text that reaches the terminal", () => {
	test.each(ATTACKS)("removes %s", (_name, attack) => {
		for (const clean of [plainText(`a${attack}b`), styledText(`a${attack}b`)]) {
			expect(clean).toMatch(/^a[^]*b$/);
			// oxlint-disable-next-line no-control-regex -- control characters are what this checks
			expect(clean).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/);
		}
	});

	test("styled text keeps colors, plain text does not", () => {
		const red = "\u001b[31mred\u001b[0m";
		expect(styledText(red)).toBe(red);
		expect(plainText(red)).toBe("red");
	});

	test("a string nobody ends stops at the line's end, so it cannot hide what follows", () => {
		expect(plainText("a\u001b]52;c;QUJD\nb")).toBe("a\nb");
	});

	test("keeps line breaks, tabs and other languages", () => {
		expect(plainText("a\n\tb שלום 你好 🙂")).toBe("a\n\tb שלום 你好 🙂");
	});
});
