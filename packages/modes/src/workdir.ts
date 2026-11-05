/**
 * Bash keeps its folder, the way a shell would: a `cd` at the start of a command carries over to later commands while
 * it stays in the project. Pi starts a new shell for each command, so later ones get the prefix from here, before the
 * permission system reads them. It follows a literal cd, so paths are judged from the right folder, and this works
 * with whichever extension runs bash, such as pi-sandbox. Replacing the bash tool would turn that extension off.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyChoices, checkChoices } from "./review/apply.mjs";
import { ruleFor } from "./review/collect.mjs";

const LEADING_CD = /^\s*cd\s+(?:'([^']*)'|"([^"$`\\]*)"|([^\s;&|`$<>()'"\\]+))(?=\s*(?:&&|;|\n|$))/;
/** Bare when it can be, as a rule like `cd /work/app/*` only matches the path as written. */
const quoted = (text: string) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);

function folderAt(path: string): string | undefined {
  try {
    return statSync(path).isDirectory() ? realpathSync(path) : undefined;
  } catch {
    return undefined;
  }
}

/** Where a cd goes. A model often repeats a move it already made, so a path that isn't here is tried from the top and from one up. */
export function cdTarget(root: string, here: string | undefined, target: string): string | undefined {
  if (target === "-") return undefined;
  const path = target === "~" || target.startsWith("~/") ? join(homedir(), target.slice(1)) : target;
  const from = here ?? root;
  for (const base of [from, root, dirname(from)]) {
    const folder = folderAt(resolve(base, path));
    if (folder !== undefined) return folder;
  }
  return undefined;
}

/** The command to really run, and the folder it moves to if it starts with a cd. */
export function planCommand(root: string, here: string | undefined, command: string): { command: string; move?: string } {
  const match = LEADING_CD.exec(command);
  const move = match === null ? undefined : cdTarget(root, here, match[1] ?? match[2] ?? match[3] ?? "");
  if (match !== null && move !== undefined) return { command: `cd ${quoted(move)}${command.slice(match[0].length)}`, move };
  return { command: here === undefined ? command : `cd ${quoted(here)} && ${command}` };
}

export function isInside(root: string, folder: string): boolean {
  const inside = relative(root, folder);
  return inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

/** A cd inside the project, as typed or as its full path. Nothing shorter is safe: the permission system doesn't follow a new file's name into the folder a cd reached. */
export function cdRules(root: string): string[] {
  return [`cd ${root}`, `cd ${root}/*`];
}

/**
 * The permission system judges each part of a chain, so with "*" asking, every `cd x && go test` asks about the cd.
 * Moving inside the project does nothing by itself, so it's allowed for this project, once, with a backup. A cd
 * anywhere else still asks. Whoever removes the rules keeps them removed. Returns what to tell the user.
 */
export function addCdRules(agentDir: string, root: string): { handled: boolean; notice?: string } {
  const path = join(agentDir, "extensions", "pi-permission-system", "config.json");
  if (root === "/" || !existsSync(path)) return { handled: false };
  try {
    const bash = JSON.parse(readFileSync(path, "utf8")).permission?.bash;
    const asks = bash === undefined || (typeof bash === "object" && bash !== null && ruleFor(bash, `cd ${root}/x`) === "ask");
    if (!asks) return { handled: true };
    const rules = cdRules(root);
    if (checkChoices(agentDir, { bash: rules }).length > 0) return { handled: true }; // A path a rule can't hold.
    applyChoices(agentDir, { bash: rules });
    return { handled: true, notice: `pi-modes allowed cd inside this project in your bash rules, so you aren't asked about each one. The rest of each command, and a cd anywhere else, are still checked. Remove them from ${path} if you'd rather be asked.` };
  } catch {
    return { handled: false }; // Not ours to fix. It's tried again next start.
  }
}

export function registerWorkdir(pi: ExtensionAPI) {
  let here: string | undefined;
  const moves = new Map<string, string>();
  pi.on("session_start", () => {
    here = undefined;
    moves.clear();
  });
  pi.on("tool_result", (event, ctx) => {
    const move = moves.get(event.toolCallId);
    if (move === undefined) return undefined;
    moves.delete(event.toolCallId);
    if (event.isError) return undefined;
    const root = realpathSync(ctx.cwd);
    const stays = isInside(root, move);
    here = stays && move !== root ? move : undefined;
    // Told here rather than in the system prompt, which would cost every request and replace the subscription part's prompt.
    const note = stays ? `Bash stays in ${move} for later commands, so don't repeat the cd.` : `Shell cwd was reset to ${root}`;
    return { content: [...event.content, { type: "text" as const, text: `\n${note}` }] };
  });
  return {
    folder: () => here,
    /** Rewrites a bash call in place. */
    apply(toolCallId: string, input: { command: string }, cwd: string): void {
      const plan = planCommand(realpathSync(cwd), here, input.command);
      input.command = plan.command;
      if (plan.move !== undefined) moves.set(toolCallId, plan.move);
    },
  };
}
