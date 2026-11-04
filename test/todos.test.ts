import { describe, expect, test } from "bun:test";

import { stripTerminalSequences } from "@earendil-works/pi-tui";

import {
	changedTodos,
	NO_TODOS,
	TODO_ENTRY,
	type TodoList,
	todosOnBranch,
	todoText,
	withTodoReminder,
} from "../src/data/todos.ts";
import { type TodoPanel, todoPanel } from "../src/ui/todos.ts";

const plain = { fg: (_c: string, text: string) => text, bold: (text: string) => text } as never;
const panel: TodoPanel = { theme: plain, set: "unicode", rows: 6, all: false };
const three = changedTodos(NO_TODOS, { plan: ["read", "write", "ship"], start: 1 });
const drawn = (list: TodoList, overrides: Partial<TodoPanel> = {}, width = 30) =>
	todoPanel(list, width, { ...panel, ...overrides }).map((line) => stripTerminalSequences(line));

describe("changing the list", () => {
	test("one call plans and starts, and one call moves on", () => {
		expect(todoText(three)).toBe("0/3 done\n[>] 1 read\n[ ] 2 write\n[ ] 3 ship");
		expect(todoText(changedTodos(three, { done: [1], start: 2 }))).toBe(
			"1/3 done\n[x] 1 read\n[>] 2 write\n[ ] 3 ship",
		);
	});

	test("starting an item puts the active one back, and can reopen a finished one", () => {
		const moved = changedTodos(three, { start: 3 });
		expect(moved.items.map((item) => item.status)).toEqual(["open", "open", "active"]);
		const finished = changedTodos(three, { done: [1] });
		expect(changedTodos(finished, { start: 1 }).items[0]?.status).toBe("active");
	});

	test("an id stays with its item when others leave or arrive", () => {
		const next = changedTodos(three, { drop: [2], add: ["test"] });
		expect(next.items.map((item) => [item.id, item.text])).toEqual([
			[1, "read"],
			[3, "ship"],
			[4, "test"],
		]);
	});

	test.each([
		["an unknown id", { done: [9] }, "No todo item 9"],
		["an unknown start", { done: [1], start: 9 }, "No todo item 9"],
		["a dropped id", { drop: [1], done: [1] }, "No todo item 1"],
		["blank text", { add: ["  \n "] }, "needs text"],
		["too many items", { add: Array(50).fill("x") }, "at most 50"],
	])("refuses %s and tells the model the list", (_name, change, message) => {
		expect(() => changedTodos(three, change)).toThrow(message);
		expect(() => changedTodos(three, change)).toThrow("[>] 1 read");
	});

	test("text can't drive the terminal or break the row", () => {
		const list = changedTodos(NO_TODOS, { plan: ["a\u001b]52;c;RVZJTA==\u0007b\u001b[2J\nc‮d"] });
		expect(list.items[0]?.text).toBe("ab cd");
		expect(() => changedTodos(NO_TODOS, { plan: ["\u200b\u{e0041}"] })).toThrow("needs text");
	});
});

describe("the session", () => {
	const saved = (data: unknown) => ({ type: "custom", customType: TODO_ENTRY, data });

	test("the branch's last list wins, and a bad entry doesn't replace it", () => {
		const entries = [
			saved(NO_TODOS),
			saved(three),
			saved({ items: [{ id: "x" }], nextId: 2 }),
			saved({ items: "no", nextId: 1 }),
			saved({ items: [{ id: 5, text: "a", status: "open" }, { id: 5, text: "b", status: "open" }], nextId: 6 }),
			saved({ items: [{ id: 5, text: "a", status: "open" }], nextId: 1 }),
			saved({ items: [{ id: 1, text: "\n", status: "open" }], nextId: 2 }),
			{ type: "custom", customType: "other", data: NO_TODOS },
		];
		expect(todosOnBranch(entries)).toEqual(three);
		expect(todosOnBranch([])).toEqual(NO_TODOS);
	});

	test("a saved list is cleaned again, since a session file can come from anyone", () => {
		const list = todosOnBranch([
			saved({ items: [{ id: 1, text: "a\u001b[2Jb", status: "open" }], nextId: 2 }),
		]);
		expect(list.items[0]?.text).toBe("ab");
	});
});

describe("the reminder after compaction", () => {
	const remind = (text: string) => ({ role: "custom", text });
	const summary = { role: "compactionSummary" };

	test("puts the list first once the tool's last answer has left the context", () => {
		const messages = withTodoReminder([summary], three, remind);
		expect(messages?.[0]?.role).toBe("custom");
		expect((messages?.[0] as { text?: string }).text).toContain("[>] 1 read");
		expect(messages?.[1]).toBe(summary);
	});

	test("a failed call doesn't count as the model seeing the list", () => {
		const failed = { role: "toolResult", toolName: "todo", isError: true };
		expect(withTodoReminder<{ role: string }>([failed], three, remind)?.[0]?.role).toBe("custom");
	});

	test.each([
		["the model can still see the answer", [{ role: "toolResult", toolName: "todo" }], three],
		["the list is empty", [summary], NO_TODOS],
		["everything is done", [summary], changedTodos(three, { done: [1, 2, 3] })],
	])("stays out when %s", (_name, messages, list) => {
		expect(withTodoReminder(messages, list, remind)).toBeUndefined();
	});
});

describe("the panel", () => {
	test("draws nothing for an empty list", () => {
		expect(todoPanel(NO_TODOS, 30, panel)).toEqual([]);
	});

	test("shows each item's state and how far it got", () => {
		const lines = drawn(changedTodos(three, { done: [1], start: 2 }));
		expect(lines[0]).toContain("todo 1/3");
		expect(lines.slice(1, 4).map((line) => line.slice(2, 10).trim())).toEqual(["✓ read", "▸ write", "○ ship"]);
	});

	test("uses plain marks in ascii", () => {
		expect(drawn(three, { set: "ascii" })[1]).toContain("> read");
	});

	const long = changedTodos(NO_TODOS, { plan: ["a", "b", "c", "d", "e", "f", "g", "h"] });

	test("cuts finished rows first, and the count still covers the whole list", () => {
		const lines = drawn(changedTodos(long, { done: [1, 2, 3, 4], start: 5 }), { rows: 5 });
		expect(lines[0]).toContain("todo 4/8");
		expect(lines.slice(1, -1).map((line) => line.slice(2, 5).trim())).toEqual(["✓ d", "▸ e", "○ f", "○ g", "○ h"]);
		expect(lines.at(-1)).toContain("+3 done");
	});

	test("keeps the active item when it is far down the list", () => {
		const lines = drawn(changedTodos(long, { start: 8 }), { rows: 3 });
		expect(lines.join("\n")).toContain("▸ h");
		expect(lines.at(-1)).toContain("+5 more");
	});

	test("shows everything when the tools are expanded", () => {
		expect(drawn(long, { rows: 2, all: true })).toHaveLength(10);
	});

	test("a long item is cut, not wrapped, at any width", () => {
		const list = changedTodos(NO_TODOS, { plan: ["word ".repeat(30)] });
		for (const width of [8, 20, 120]) {
			const lines = drawn(list, {}, width);
			expect(lines).toHaveLength(3);
			for (const line of lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});
