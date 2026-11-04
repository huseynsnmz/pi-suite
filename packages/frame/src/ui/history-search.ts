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
