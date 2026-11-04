import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_CONTENT, MemoryStore } from "../src/store.ts";

const open = () => MemoryStore.open(":memory:");

test("an exact repeat in the same scope isn't added twice, and another scope is separate", async () => {
  const store = await open();
  const base = { category: "fact", content: "Uses wrangler" } as const;
  assert.equal(store.add(base).added, true);
  assert.equal(store.add(base).added, false);
  assert.equal(store.add({ ...base, project: "/a" }).added, true);
  assert.equal(store.list().length, 2);
});

for (const [name, content, message] of [
  ["refuses a secret", "the key is sk-abcdefghijklmnopqrstuvwx", /secret/],
  ["refuses an empty memory", " \n ", /empty/],
  ["refuses an essay", "x".repeat(MAX_CONTENT + 1), /characters/],
] as const) {
  test(`add ${name}`, async () => {
    const store = await open();
    assert.throws(() => store.add({ category: "fact", content }), message);
    assert.equal(store.list().length, 0);
  });
}

test("update also refuses a secret, and search follows a change", async () => {
  const store = await open();
  const { memory } = store.add({ category: "decision", content: "Deploy with wrangler" });
  assert.throws(() => store.update(memory.id, "password: hunter2hunter2"), /secret/);
  assert.equal(store.update(memory.id, "Deploy with alchemy"), true);
  assert.deepEqual(store.search("wrangler"), []);
  assert.equal(store.search("alch")[0]?.id, memory.id);
  assert.equal(store.delete(memory.id), true);
  assert.deepEqual(store.search("alchemy"), []);
  assert.equal(store.update(memory.id, "gone"), false);
});

test("control characters don't reach the store", async () => {
  const store = await open();
  assert.equal(store.add({ category: "fact", content: "a\x1b]0;evil\x07\n# b" }).memory.content, "a ]0;evil # b");
});

test("what's searched for can't be read as FTS syntax", async () => {
  const store = await open();
  store.add({ category: "fact", content: "NEAR the (end) of it" });
  for (const query of ['"', "NEAR(", "a OR", "content:x", "*"]) assert.doesNotThrow(() => store.search(query), query);
  assert.equal(store.search("(end)").length, 1);
  assert.equal(store.search("end").length, 1);
});

test("a project sees its own memories first, then global ones, and not another's", async () => {
  const store = await open();
  store.add({ category: "fact", content: "global" });
  store.add({ category: "fact", content: "mine", project: "/a" });
  store.add({ category: "fact", content: "theirs", project: "/b" });
  assert.deepEqual(store.list({ project: "/a" }).map((memory) => memory.content), ["mine", "global"]);
});

test("the file survives reopening, and only its owner can read it", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "sub/memory.db");
  const first = await MemoryStore.open(path);
  first.add({ category: "fact", content: "kept" });
  first.markReviewed("/s.jsonl", 42);
  first.close();
  const second = await MemoryStore.open(path);
  assert.equal(second.list()[0]?.content, "kept");
  assert.equal(second.reviewedBytes("/s.jsonl"), 42);
  second.close();
  assert.equal((statSync(path).mode & 0o777).toString(8), "600");
  assert.equal((statSync(join(dir, "sub")).mode & 0o777).toString(8), "700");
});
