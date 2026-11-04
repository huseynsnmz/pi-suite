// The start screen says what changed since the last session in a folder, so it remembers when that was.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isObject } from "@adeildo/pi-kit";

import type { LastVisit } from "./start-notes.ts";

type Visits = Record<string, LastVisit>;

/** Records this visit too. */
export function visit(
	file: string,
	cwd: string,
	version: string,
	now: number,
): LastVisit | undefined {
	const visits = read(file);
	const last = visits[cwd];
	visits[cwd] = { at: now, version };
	// Two sessions starting together must not read each other's half-written file. It lists your folders.
	const temporary = `${file}.${process.pid}.tmp`;
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(temporary, JSON.stringify(visits), { mode: 0o600 });
		renameSync(temporary, file);
	} catch {
		// A start screen that cannot remember only loses "since when".
		rmSync(temporary, { force: true });
	}
	return isVisit(last) ? last : undefined;
}

function isVisit(value: unknown): value is LastVisit {
	return isObject(value) && Number.isFinite(value.at) && typeof value.version === "string";
}

function read(file: string): Visits {
	try {
		const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
		return isObject(value) ? (value as Visits) : {};
	} catch {
		return {};
	}
}
