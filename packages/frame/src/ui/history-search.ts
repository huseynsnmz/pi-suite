/** Ctrl+R over past prompts, newest first. It only knows the list; the editor does the keys. */
export interface HistorySearch {
	query: string;
	/** What the prompt held before, for when it's cancelled. */
	draft: string;
	entries: readonly string[];
	at: number;
}

export function startSearch(draft: string, entries: readonly string[]): HistorySearch {
	return { query: "", draft, entries: [...new Set(entries)], at: -1 };
}

/** The next match from `from`, or -1. */
export function findPrompt(search: HistorySearch, from: number): number {
	const wanted = search.query.toLowerCase();
	return search.entries.findIndex((entry, index) => index >= from && entry.toLowerCase().includes(wanted));
}

/** Empty query: the prompt goes back to the draft. No match: it keeps showing the last one. */
export function shownText(search: HistorySearch): string {
	return search.at < 0 ? search.draft : (search.entries[search.at] as string);
}

/** Up with text typed: older prompts that start with it, as in a shell. */
export interface PrefixSearch {
	typed: string;
	matches: readonly string[];
	at: number;
}

export function startPrefix(typed: string, entries: readonly string[]): PrefixSearch {
	const wanted = typed.toLowerCase();
	const matches = [...new Set(entries)].filter((entry) => entry !== typed && entry.toLowerCase().startsWith(wanted));
	return { typed, matches, at: -1 };
}

/** One step older (1) or newer (-1), ending back on what was typed. Undefined past either end. */
export function stepPrefix(search: PrefixSearch, step: 1 | -1): string | undefined {
	const next = search.at + step;
	if (next < -1 || next >= search.matches.length) return undefined;
	search.at = next;
	return next < 0 ? search.typed : search.matches[next];
}
