// The agent's checklist. Pure: the tool, the panel and the session all go through these.
import { plainText } from "../render/safe.ts";

export const TODO_ENTRY = "pi-frame:todo";
const MAX_ITEMS = 50;
const MAX_TEXT = 200;

const INVISIBLE = /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u2060-\u206f\u3164\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu;

export type TodoStatus = "open" | "active" | "done";

export interface Todo {
	id: number;
	text: string;
	status: TodoStatus;
}

export interface TodoList {
	items: readonly Todo[];
	nextId: number;
}

export interface TodoChange {
	plan?: readonly string[];
	add?: readonly string[];
	drop?: readonly number[];
	done?: readonly number[];
	start?: number;
}

export const NO_TODOS: TodoList = { items: [], nextId: 1 };

/** Model text, drawn on one row, so it can't drive the terminal or the layout. */
function cleanText(text: string): string {
	const clean = plainText(text).replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
	return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 3)}...` : clean;
}

function added(texts: readonly string[], from: number): Todo[] {
	return texts.map((text, index) => {
		const clean = cleanText(text);
		if (clean === "") throw new Error("A todo item needs text.");
		return { id: from + index, text: clean, status: "open" };
	});
}

function checkedIds(list: TodoList, ids: readonly number[]): void {
	const known = new Set(list.items.map((item) => item.id));
	const missing = ids.filter((id) => !known.has(id));
	if (missing.length > 0) throw new Error(`No todo item ${missing.join(", ")}.`);
}

/** All or nothing: a bad id or text throws, with the list, which stays as it was. No arguments just reads it. */
export function changedTodos(list: TodoList, change: TodoChange): TodoList {
	try {
		return applied(list, change);
	} catch (error) {
		throw new Error(`${(error as Error).message} The list has not changed.\n${todoText(list)}`);
	}
}

function applied(list: TodoList, change: TodoChange): TodoList {
	let items: readonly Todo[] = list.items;
	let nextId = list.nextId;
	if (change.plan !== undefined) {
		items = added(change.plan, 1);
		nextId = items.length + 1;
	}
	if (change.add !== undefined) {
		items = [...items, ...added(change.add, nextId)];
		nextId += change.add.length;
	}
	if (items.length > MAX_ITEMS) throw new Error(`A todo list holds at most ${MAX_ITEMS} items.`);

	const next = (): TodoList => ({ items, nextId });
	checkedIds(next(), change.drop ?? []);
	items = items.filter((item) => !change.drop?.includes(item.id));
	checkedIds(next(), change.done ?? []);
	items = items.map((item) => (change.done?.includes(item.id) ? { ...item, status: "done" } : item));

	const start = change.start;
	if (start !== undefined) {
		checkedIds(next(), [start]);
		// Only one at a time, so starting one puts back whichever was active.
		items = items.map((item) => {
			if (item.id === start) return { ...item, status: "active" };
			return item.status === "active" ? { ...item, status: "open" } : item;
		});
	}
	return next();
}

export function hasOpenTodos(list: TodoList): boolean {
	return list.items.some((item) => item.status !== "done");
}

export function doneCount(list: TodoList): number {
	return list.items.filter((item) => item.status === "done").length;
}

const MARKS: Record<TodoStatus, string> = { open: "[ ]", active: "[>]", done: "[x]" };

/** What the model reads. */
export function todoText(list: TodoList): string {
	if (list.items.length === 0) return "The todo list is empty.";
	const rows = list.items.map((item) => `${MARKS[item.status]} ${item.id} ${item.text}`);
	return [`${doneCount(list)}/${list.items.length} done`, ...rows].join("\n");
}

/** The transcript's one line: what's being worked on, or how far it got. */
export function todoSummary(list: TodoList): string {
	if (list.items.length === 0) return "list empty";
	const active = list.items.find((item) => item.status === "active");
	const count = `${doneCount(list)}/${list.items.length} done`;
	return active === undefined ? count : `${count}, now: ${active.text}`;
}

function decoded(data: unknown): TodoList | undefined {
	const list = data as { items?: unknown; nextId?: unknown } | null;
	if (!Array.isArray(list?.items) || !Number.isSafeInteger(list.nextId)) return undefined;
	if (list.items.length > MAX_ITEMS) return undefined;
	const items: Todo[] = [];
	const nextId = list.nextId as number;
	const seen = new Set<number>();
	for (const raw of list.items as Partial<Todo>[]) {
		if (!Number.isSafeInteger(raw?.id) || typeof raw?.text !== "string") return undefined;
		if (raw.status !== "open" && raw.status !== "active" && raw.status !== "done") return undefined;
		const id = raw.id as number;
		const text = cleanText(raw.text);
		if (text === "" || id >= nextId || seen.has(id)) return undefined;
		seen.add(id);
		items.push({ id, text, status: raw.status });
	}
	return { items, nextId };
}

/** The last list saved on this branch. A session can come from anyone, so a bad entry is skipped. */
export function todosOnBranch(entries: Iterable<unknown>): TodoList {
	let list = NO_TODOS;
	for (const entry of entries) {
		const custom = entry as { type?: string; customType?: string; data?: unknown };
		if (custom.type !== "custom" || custom.customType !== TODO_ENTRY) continue;
		list = decoded(custom.data) ?? list;
	}
	return list;
}

/**
 * Compaction can take the tool's last answer out of the model's context while the list goes on.
 * Then the list comes first, where it doesn't move between calls, which keeps most of the prompt cache.
 * A failed call may not show the list, so only an answer that worked counts.
 */
export function withTodoReminder<M extends { role: string; toolName?: string; isError?: boolean }>(
	messages: readonly M[],
	list: TodoList,
	reminder: (text: string) => M,
): M[] | undefined {
	if (!hasOpenTodos(list)) return undefined;
	const seen = (message: M) => message.role === "toolResult" && message.toolName === "todo" && message.isError !== true;
	if (messages.some(seen)) return undefined;
	return [reminder(`Your todo list, kept from earlier in this session:\n${todoText(list)}`), ...messages];
}
