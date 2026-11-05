/**
 * Bash keeps its folder, the way a shell would: a `cd` at the start of a command carries over to later commands while
 * it stays in the project. Pi starts a new shell for each command, so later ones get the prefix from here, before the
 * permission system reads them. It follows a literal cd, so paths are judged from the right folder, and this works
 * with whichever extension runs bash, such as pi-sandbox. Replacing the bash tool would turn that extension off.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyChoices, checkChoices } from "./review/apply.mjs";
import { ruleFor } from "./review/collect.mjs";

const LEADING_CD = /^\s*cd\s+(?:'([^']*)'|"([^"$`\\]*)"|([^\s;&|`$<>()'"\\]+))(?=\s*(?:&&|;|\n|$))/;
/** A cd anywhere in a chain, with a path that's plain text. */
const ANY_CD = /(^|&&|\|\||[;|\n({]|\b(?:then|do|else)\b)(\s*cd\s+)(?:'([^']*)'|"([^"$`\\]*)"|([^\s;&|`$<>()'"\\]+))(?=\s*(?:&&|\|\||[;|\n)}]|$))/g;
const WORKDIR_ENTRY = "pi-modes-workdir";
const PLAIN = /^[\w@%+=:,./-]+$/;
/** Bare when it can be, as a rule like `cd /work/app/*` only matches the path as written. */
const quoted = (text: string) => (PLAIN.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);

function folderAt(path: string): string | undefined {
  try {
    return statSync(path).isDirectory() ? realpathSync(path) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where a cd goes. A model often repeats a move it already made, so a path that isn't here counts if it's how the
 * current folder ends. Nothing else is guessed: `cd build && rm -rf *` has to fail if there's no build folder here.
 */
export function cdTarget(root: string, here: string | undefined, target: string): string | undefined {
  if (target === "-") return undefined;
  const path = target === "~" || target.startsWith("~/") ? join(homedir(), target.slice(1)) : target;
  const from = here ?? root;
  const folder = folderAt(resolve(from, path));
  if (folder !== undefined) return folder;
  const repeat = normalize(`${path}/`).slice(0, -1);
  const below = relative(root, from);
  return below === repeat || below.endsWith(`${sep}${repeat}`) ? from : undefined;
}

/**
 * A cd rule for the project also matches `cd <root>/link` and `cd <root>/../x`, which leave it. Written as where they
 * really go, the rule no longer matches, and the permission system asks.
 */
export function realCds(root: string, command: string): string {
  return command.replace(ANY_CD, (all, before: string, cd: string, single?: string, double?: string, bare?: string) => {
    const path = single ?? double ?? bare ?? "";
    if (!path.startsWith(`${root}/`)) return all;
    const real = folderAt(path) ?? resolve(path);
    return real === path ? all : `${before}${cd}${quoted(real)}`;
  });
}

/** The command to really run, and the folder it moves to if it starts with a cd. */
export function planCommand(root: string, here: string | undefined, command: string): { command: string; move?: string } {
  const match = LEADING_CD.exec(command);
  const move = match === null ? undefined : cdTarget(root, here, match[1] ?? match[2] ?? match[3] ?? "");
  if (match !== null && move !== undefined) return { command: realCds(root, `cd ${quoted(move)}${command.slice(match[0].length)}`), move };
  const rest = realCds(root, command);
  return { command: here === undefined ? rest : `cd ${quoted(here)} && ${rest}` };
}

export function isInside(root: string, folder: string): boolean {
  const inside = relative(root, folder);
  return inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

/** A cd inside the project, as typed or as its full path. Nothing shorter is safe: the permission system doesn't follow a new file's name into the folder a cd reached. */
export function cdRules(root: string): string[] {
  return [`cd ${word(root)}`, `cd ${word(root, "/*")}`];
}

/** What the rules above match but can't vouch for: a way out of the project, or text the shell turns into a path. */
export function cdGuards(root: string): string[] {
  return ["..", "$", "`", "\\"].map((risky) => `cd ${word(root, `/*${risky}*`)}`);
}

/** The folder as bash gets it, as a rule only matches what's written. */
function word(root: string, tail = ""): string {
  return PLAIN.test(root) ? `${root}${tail}` : `'${`${root}${tail}`.replaceAll("'", "'\\''")}'`;
}

/** Rules added before the guards existed get them. Nothing else changes, and removed rules stay removed. */
export function addCdGuards(agentDir: string, root: string): void {
  const path = join(agentDir, "extensions", "pi-permission-system", "config.json");
  try {
    const bash = JSON.parse(readFileSync(path, "utf8")).permission?.bash;
    const rules = cdRules(root);
    if (typeof bash !== "object" || bash === null || bash[rules[1] as string] !== "allow" || cdGuards(root).every((guard) => guard in bash)) return;
    applyChoices(agentDir, { bash: rules, guards: cdGuards(root) });
  } catch {
    // Not ours to fix. It's tried again next start.
  }
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
    const permission = JSON.parse(readFileSync(path, "utf8")).permission ?? {};
    const { bash } = permission;
    // With no bash rules, bash follows the catch-all, which is ask when that isn't set either.
    const asks = bash === undefined ? (permission["*"] ?? "ask") === "ask" : typeof bash === "object" && bash !== null && ruleFor(bash, `cd ${root}/x`) === "ask";
    if (!asks) return { handled: true };
    const rules = cdRules(root);
    if (checkChoices(agentDir, { bash: rules }).length > 0) return { handled: true }; // A path a rule can't hold.
    applyChoices(agentDir, { bash: rules, guards: cdGuards(root) });
    return { handled: true, notice: `pi-modes allowed cd inside this project in your bash rules, so you aren't asked about each one. The rest of each command, and a cd anywhere else, are still checked. Remove them from ${path} if you'd rather be asked.` };
  } catch {
    return { handled: false }; // Not ours to fix. It's tried again next start.
  }
}

/** The folder this point of the session was in, so what the model was told stays true after a reload, a resume or a move in the tree. */
export function savedFolder(root: string, entries: readonly { type: string; customType?: string; data?: unknown }[]): string | undefined {
  let saved: unknown;
  for (const entry of entries) if (entry.type === "custom" && entry.customType === WORKDIR_ENTRY) saved = (entry.data as { folder?: unknown } | undefined)?.folder;
  if (typeof saved !== "string" || saved === root || !isInside(root, saved)) return undefined;
  return folderAt(saved) === saved ? saved : undefined;
}

export function registerWorkdir(pi: ExtensionAPI) {
  let here: string | undefined;
  const moves = new Map<string, string>();
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    here = savedFolder(realpathSync(ctx.cwd), ctx.sessionManager.getBranch());
    moves.clear();
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("tool_result", (event, ctx) => {
    const move = moves.get(event.toolCallId);
    if (move === undefined) return undefined;
    moves.delete(event.toolCallId);
    if (event.isError) return undefined;
    const root = realpathSync(ctx.cwd);
    const stays = isInside(root, move);
    const next = stays && move !== root ? move : undefined;
    if (next !== here) pi.appendEntry(WORKDIR_ENTRY, { folder: next ?? null });
    here = next;
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
