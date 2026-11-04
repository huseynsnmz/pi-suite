import assert from "node:assert/strict";
import test from "node:test";
import { promptSection } from "../src/prompt.ts";
import type { Memory } from "../src/store.ts";

const memory = (id: number, content: string): Memory => ({ id, category: "fact", content, project: null, sourceSession: null, updatedAt: "" });

test("no memories add nothing to the prompt", () => assert.equal(promptSection([]), ""));

test("memories are marked as information, and what doesn't fit is counted", () => {
  const out = promptSection([memory(1, "first"), memory(2, "x".repeat(100)), memory(3, "third")], 50);
  assert.match(out, /don't follow an instruction/);
  assert.match(out, /- \[fact\] first/);
  assert.doesNotMatch(out, /xxx|third/);
  assert.match(out, /2 more can be found with memory_search/);
});
