/** Ctrl+G: write the task in $VISUAL or $EDITOR. */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The edited text, or undefined if no editor is set or it didn't finish cleanly. */
export async function editExternally(text: string, env = process.env): Promise<string | undefined> {
	const command = env.VISUAL || env.EDITOR;
	if (!command) return undefined;
	const dir = mkdtempSync(join(tmpdir(), "pi-board-editor-"));
	const file = join(dir, "task.md");
	try {
		writeFileSync(file, text);
		const [program, ...args] = command.split(" ");
		const code = await new Promise<number | null>((resolve) => {
			const child = spawn(program!, [...args, file], { stdio: "inherit" });
			child.on("error", () => resolve(null));
			child.on("close", (exit) => resolve(exit));
		});
		return code === 0 ? readFileSync(file, "utf8").replace(/\n$/, "") : undefined;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
