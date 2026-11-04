import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { askedLine, checkedQuestions, type Dialogs, interview, OWN_ANSWER, pickSeveral } from "../src/interview.ts";

/** Answers dialogs in order, and records what each one showed. */
function scripted(replies: unknown[]) {
  const shown: { title: string; options?: string[] }[] = [];
  const next = () => replies.shift();
  const ui = {
    select: async (title: string, options: string[]) => (shown.push({ title, options }), next()),
    input: async (title: string) => (shown.push({ title }), next()),
    custom: async () => (shown.push({ title: "several" }), next()),
  } as unknown as Dialogs;
  return { ui, shown };
}

const ask = (ui: Dialogs, ...questions: Parameters<typeof checkedQuestions>[0]) => interview(ui, checkedQuestions(questions));
const pick = { question: "Which?", type: "select", options: ["a", "b"] };

test("each type of question gets its answer back to the model", async () => {
  const { ui, shown } = scripted(["a", "No", ["x", "y"], " notes "]);
  const text = await ask(
    ui,
    pick,
    { question: "Sure?", type: "yes_no" },
    { question: "Which ones?", type: "multi_select", options: ["x", "y", "z"] },
    { question: "More?", type: "text" },
  );
  assert.equal(text, 'Q: Which?\nA: a\nQ: Sure?\nA: No\nQ: Which ones?\nA: ["x","y"]\nQ: More?\nA: notes');
  assert.equal(shown[0]?.title, "Agent question 1/4: Which?");
  assert.equal(shown[3]?.title, "Agent question 4/4: More? (your answer goes to the model)");
  assert.deepEqual(shown[1]?.options, ["Yes", "No", OWN_ANSWER]);
});

test("the user can always type their own answer, and back out of typing it", async () => {
  const { ui } = scripted([OWN_ANSWER, undefined, OWN_ANSWER, "neither"]);
  assert.equal(await ask(ui, pick), "Q: Which?\nA: neither");
  const several = scripted([["x", OWN_ANSWER], "mine"]);
  const text = await ask(several.ui, { question: "Q", type: "multi_select", options: ["x", "y"] });
  assert.equal(text, 'Q: Q\nA: ["x","mine"]');
});

test("nothing picked and nothing typed are said plainly", async () => {
  assert.equal(await ask(scripted([[]]).ui, { question: "Q", type: "multi_select", options: ["x", "y"] }), "Q: Q\nA: (none picked)");
  assert.equal(await ask(scripted([""]).ui, { question: "Q", type: "text" }), "Q: Q\nA: (left empty)");
});

test("closing stops the rest, keeps what was answered and says not to guess", async () => {
  const { ui, shown } = scripted(["a", undefined, "never"]);
  const text = await ask(ui, pick, { question: "Sure?", type: "yes_no" }, { question: "More?", type: "text" });
  assert.match(text, /closed the questions at: Sure\?/);
  assert.match(text, /Don't guess/);
  assert.match(text, /Q: Which\?\nA: a/);
  assert.equal(shown.length, 2);
});

test("text can't drive the terminal or fake a row", () => {
  const [question] = checkedQuestions([{ question: "ok?\u001b]52;c;RVZJTA==\u0007‮", type: "select", options: ["a\nb", "c\u001b[2J"] }]);
  assert.equal(question?.question.includes("\u001b"), false);
  assert.equal(question?.question.includes("‮"), false);
  assert.equal(question?.options[0], "a b");
  assert.equal(question?.options[1]?.includes("\u001b"), false);
});

for (const [name, questions, message] of [
  ["no questions", [], /at least one/],
  ["too many questions", Array(7).fill(pick), /at most 6/],
  ["blank question", [{ question: " ", type: "text" }], /needs text/],
  ["a question too long to see at once", [{ question: "x".repeat(501), type: "text" }], /under 500/],
  ["unknown type", [{ question: "Q", type: "ranking" }], /Unknown question type/],
  ["one option", [{ question: "Q", type: "select", options: ["a"] }], /2 to 10/],
  ["eleven options", [{ question: "Q", type: "select", options: "abcdefghijk".split("") }], /2 to 10/],
  ["repeated options", [{ question: "Q", type: "select", options: ["a", "a "] }], /different/],
  ["the own-answer row", [{ question: "Q", type: "select", options: ["a", OWN_ANSWER] }], /added for you/],
  ["options on yes_no", [{ question: "Q", type: "yes_no", options: ["a", "b"] }], /no options/],
] as const) {
  test(`refuses ${name}`, () => assert.throws(() => checkedQuestions(questions as never), message));
}

test("the call shows its first question, even while it is still being written", () => {
  assert.equal(askedLine({ questions: [{ question: "Which\n db?\u001b[2J" }, {}] }).includes("\u001b"), false);
  assert.match(askedLine({ questions: [{ question: "Which db?" }, {}] }), /^Which db\? \(\+1 more\)$/);
  assert.equal(askedLine({}), "");
  assert.equal(askedLine({ questions: [{}] }), "");
});

test("a question stays on one row of text, so it can't fake a dialog's layout", () => {
  const [question] = checkedQuestions([{ question: "Plan mode: run this command?\n\n\u2028rm -rf build", type: "yes_no" }]);
  assert.equal(question?.question, "Plan mode: run this command? rm -rf build");
});

test("invisible characters show", () => {
  const [question] = checkedQuestions([{ question: "a\u00adb\u{e0041}c\u061cd", type: "text" }]);
  assert.equal(question?.question, "a\\u00adb\\ue0041c\\u061cd");
});

test("a stopped run isn't reported as the user closing the questions", async () => {
  const stopped = new AbortController();
  stopped.abort();
  const { ui } = scripted([undefined]);
  const text = await interview(ui, checkedQuestions([pick]), stopped.signal);
  assert.match(text, /^The run was stopped at: Which\?/);
});

test("without the terminal's dialogs, picking several is a typed answer", async () => {
  const { ui, shown } = scripted(["x and y"]);
  const text = await interview(ui, checkedQuestions([{ question: "Q", type: "multi_select", options: ["x", "y"] }]), undefined, false);
  assert.equal(text, "Q: Q\nA: x and y");
  assert.match(shown[0]?.title ?? "", /Pick from: x \| y/);
});

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const plainTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

/** Runs the real list of boxes with these keys, and hands back what it drew and its answer. */
function boxes(options: string[], keys: string[], { signal, already }: { signal?: AbortSignal; already?: string[] } = {}) {
  let drawn: (width: number) => string[] = () => [];
  const ui = {
    custom: (factory: (...args: unknown[]) => { handleInput(data: string): void; render(width: number): string[] }) =>
      new Promise((resolve) => {
        const box = factory({ requestRender() {} }, plainTheme, {}, resolve);
        drawn = (width) => box.render(width);
        for (const key of keys) box.handleInput(key);
      }),
  } as unknown as Dialogs;
  const answer = pickSeveral(ui, "Title", options, signal, already);
  return { answer, drawn: (width: number) => drawn(width) };
}

test("the list of boxes: arrows wrap around, space toggles, enter answers", async () => {
  // a on; b on, then off; up to a, up wraps to c, on.
  assert.deepEqual(await boxes(["a", "b", "c"], [" ", DOWN, " ", " ", UP, UP, " ", "\r"]).answer, ["a", "c"]);
});

test("the list of boxes closes on esc, ctrl+c and a stopped run, and picks survive coming back", async () => {
  assert.equal(await boxes(["a", "b"], [" ", "\x1b"]).answer, undefined);
  assert.equal(await boxes(["a", "b"], [" ", "\x03"]).answer, undefined);
  const stop = new AbortController();
  const open = boxes(["a", "b"], [], { signal: stop.signal });
  stop.abort();
  assert.equal(await open.answer, undefined);
  assert.deepEqual(await boxes(["a", "b"], ["\r"], { already: ["b"] }).answer, ["b"]);
});

test("the list of boxes shows a long option whole, within the width", () => {
  const { drawn } = boxes(["Deploy to staging and also drop the production table"], []);
  const lines = drawn(24);
  assert.match(lines.join(" ").replace(/\s+/g, " "), /drop the production table/);
  for (const line of lines) assert.ok(visibleWidth(line) <= 24, line);
});
