// The agent's checklist: the `todo` tool, a panel above the editor and `/todos`.
import { CUT, entryFrame, type FeatureScope } from "../kit/index.ts";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Text, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import {
	changedTodos,
	doneCount,
	hasOpenTodos,
	NO_TODOS,
	type Todo,
	TODO_ENTRY,
	type TodoChange,
	type TodoList,
	todosOnBranch,
	type TodoStatus,
	todoSummary,
	todoText,
	withTodoReminder,
} from "../data/todos.ts";
import type { IconSet } from "../render/glyphs.ts";

const WIDGET = "pi-frame:todos";
const MOST_ROWS = 6;

export function registerTodos(scope: FeatureScope, set: () => IconSet): void {
	let list = NO_TODOS;
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;

	const adopt = (next: TodoList) => {
		list = next;
		tui?.requestRender();
	};
	const save = (next: TodoList) => {
		if (next === list) return;
		scope.appendEntry<TodoList>(TODO_ENTRY, next);
		adopt(next);
	};

	scope.registerTool({
		name: "todo",
		label: "Todo",
		description:
			"Your checklist for work with several steps, which the user sees above the editor. Every call answers with the whole list. No arguments reads it.",
		promptSnippet: "Keep a checklist of multi-step work",
		promptGuidelines: [
			"Use `todo` for work of 3 or more steps, or when given several tasks. Skip it for one quick step or a question.",
			"Use `todo` in one call per step: {plan:[...], start:1} to begin, then {done:[1], start:2}. One item is active at a time.",
			"Mark a `todo` item done only when it is finished and checked. If tests fail or it's partial, leave it active and add what blocks it.",
		],
		parameters: Type.Object({
			plan: Type.Optional(Type.Array(Type.String(), { description: "Replace the whole list" })),
			add: Type.Optional(Type.Array(Type.String(), { description: "Add to the end" })),
			drop: Type.Optional(Type.Array(Type.Integer(), { description: "Remove these ids" })),
			done: Type.Optional(Type.Array(Type.Integer(), { description: "Mark these ids finished" })),
			start: Type.Optional(Type.Integer({ description: "Work on this id now" })),
		}),
		async execute(_id, params) {
			const reading = Object.values(params).every((value) => value === undefined);
			if (!reading) save(changedTodos(list, params as TodoChange));
			return {
				content: [{ type: "text", text: todoText(list) }],
				details: { summary: todoSummary(list) },
			};
		},
		renderResult(result, options, theme, context) {
			const block = result.content[0];
			const text = block?.type === "text" ? block.text : "";
			const summary = (result.details as { summary?: unknown } | undefined)?.summary;
			const shown = options.expanded || context.isError || typeof summary !== "string" ? text : summary;
			return new Text(theme.fg(context.isError ? "error" : "toolOutput", shown), 0, 0);
		},
	});

	scope.registerCommand("todos", {
		description: "Show the agent's todo list, or `/todos clear` to empty it",
		getArgumentCompletions: (prefix) => {
			const typed = prefix.trim().toLowerCase();
			return "clear".startsWith(typed) && typed !== "clear" ? [{ value: "clear", label: "clear" }] : null;
		},
		handler: async (args, command) => {
			const asked = args.trim().toLowerCase();
			if (asked === "clear") {
				if (list.items.length === 0) return;
				save(NO_TODOS);
				// Its last answer still shows the old list.
				scope.sendMessage(
					{ customType: TODO_ENTRY, content: "The user emptied your todo list.", display: false },
					{ deliverAs: command.isIdle() ? "nextTurn" : "steer" },
				);
				command.ui.notify("Todo list emptied.", "info");
			} else if (asked === "") {
				command.ui.notify(todoText(list), "info");
			} else {
				command.ui.notify(`Unknown argument "${asked}". Use /todos or /todos clear.`, "error");
			}
		},
	});

	// A new session or another branch has its own list.
	scope.onSessionStart((started) => {
		ctx = started;
		list = todosOnBranch(started.sessionManager.getBranch());
		if (started.mode !== "tui") return;
		started.ui.setWidget(
			WIDGET,
			(widgetTui, theme) => {
				tui = widgetTui;
				return {
					render: (width) =>
						todoPanel(list, width, {
							theme: ctx?.ui.theme ?? theme,
							set: set(),
							rows: panelRows(widgetTui.terminal.rows),
							all: ctx?.ui.getToolsExpanded() === true,
						}),
					invalidate: () => {},
				} satisfies Component;
			},
			{ placement: "aboveEditor" },
		);
	});
	scope.on("session_tree", (_event, tree) => adopt(todosOnBranch(tree.sessionManager.getBranch())));
	scope.onShutdown(() => {
		if (ctx?.mode === "tui") ctx.ui.setWidget(WIDGET, undefined);
		ctx = undefined;
		tui = undefined;
	});

	// Only your next prompt starts this: a retry mustn't take the list away. The next task starts clean.
	scope.on("before_agent_start", () => {
		if (list.items.length > 0 && !hasOpenTodos(list)) save(NO_TODOS);
	});

	scope.on("context", (event) => {
		const messages = withTodoReminder(
			event.messages as ({ role: string; toolName?: string; isError?: boolean } & (typeof event.messages)[number])[],
			list,
			(text) =>
				({
					role: "custom",
					customType: TODO_ENTRY,
					content: text,
					display: false,
					timestamp: 0,
				}) as never,
		);
		return messages === undefined ? undefined : { messages };
	});
}

function panelRows(terminalRows: number): number {
	return Math.max(2, Math.min(MOST_ROWS, Math.floor(terminalRows / 4)));
}

const STATUS_MARKS: Record<"plain" | "ascii", Record<TodoStatus, string>> = {
	plain: { open: "○", active: "▸", done: "✓" },
	ascii: { open: "-", active: ">", done: "x" },
};

/** What's still to do comes first, starting with the active item, then the latest finished. */
function shownItems(list: TodoList, rows: number): Set<Todo> {
	const active = list.items.filter((item) => item.status === "active");
	const open = list.items.filter((item) => item.status === "open");
	const done = list.items.filter((item) => item.status === "done");
	const kept = [...active, ...open].slice(0, rows);
	return new Set([...kept, ...done.slice(Math.max(0, done.length - (rows - kept.length)))]);
}

export interface TodoPanel {
	theme: Theme;
	set: IconSet;
	rows: number;
	all: boolean;
}

/** Empty draws nothing. The count is always over the whole list, whatever is cut from the rows. */
export function todoPanel(list: TodoList, width: number, panel: TodoPanel): string[] {
	if (list.items.length === 0) return [];
	const { theme } = panel;
	const marks = STATUS_MARKS[panel.set === "ascii" ? "ascii" : "plain"];
	const shown = panel.all ? new Set(list.items) : shownItems(list, panel.rows);
	const room = Math.max(1, width - 6);
	const rows = list.items
		.filter((item) => shown.has(item))
		.map((item) => {
			const text = truncateToWidth(item.text, room, CUT);
			if (item.status === "done") return theme.fg("dim", `${marks.done} ${text}`);
			if (item.status === "active")
				return theme.fg("accent", `${marks.active} ${theme.bold(text)}`);
			return `${theme.fg("muted", marks.open)} ${theme.fg("text", text)}`;
		});
	const hiddenDone = list.items.filter((item) => item.status === "done" && !shown.has(item)).length;
	const hiddenOpen = list.items.length - shown.size - hiddenDone;
	const hidden = [hiddenDone > 0 && `+${hiddenDone} done`, hiddenOpen > 0 && `+${hiddenOpen} more`]
		.filter(Boolean)
		.join(", ");
	return entryFrame(rows, width, theme, {
		top: theme.fg("dim", `todo ${doneCount(list)}/${list.items.length}`),
		...(hidden === "" ? {} : { bottom: theme.fg("dim", hidden) }),
		color: "borderMuted",
	});
}
