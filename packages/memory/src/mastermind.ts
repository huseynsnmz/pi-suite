/**
 * /mastermind: a strong model reads past conversations and rewrites the playbook. It's called directly rather
 * than through a skill, so none of that text lands in the session for a weaker model to carry around.
 */
import { randomBytes } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { COMPACT_SYSTEM, compactPrompt, GLOBAL, parseProposals, PLAYBOOK_CHARS, readPlaybook, REVIEW_SYSTEM, reviewPrompt, writePlaybook } from "./playbook.ts";
import { nextBatch } from "./review.ts";
import { hasSecret } from "./secrets.ts";
import type { MemoryStore } from "./store.ts";

export const REVIEWED_KEY = "mastermind:";
const TIMEOUT_MS = 5 * 60_000;

export interface Mastermind {
  model: string;
  thinking?: string;
}

async function ask(ctx: ExtensionContext, chosen: Mastermind, systemPrompt: string, text: string): Promise<string> {
  const at = chosen.model.indexOf("/");
  const model = ctx.modelRegistry.find(chosen.model.slice(0, at), chosen.model.slice(at + 1));
  if (!model) throw new Error(`${chosen.model} isn't a known model. Choose another in /router`);
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(`No login for ${chosen.model}`);
  const reasoning = chosen.thinking === "off" ? undefined : chosen.thinking;
  const response = await ctx.modelRegistry.streamSimple(
    model,
    { systemPrompt, messages: [{ role: "user", content: [{ type: "text", text }], timestamp: Date.now() }] },
    { signal: AbortSignal.timeout(TIMEOUT_MS), maxTokens: reasoning === undefined ? 4000 : 16000, cacheRetention: "none", ...(reasoning === undefined ? {} : { reasoning: reasoning as never }) },
  ).result();
  // Not the provider's message, as some repeat part of the request, and that's your conversations.
  if (response.stopReason === "error" || response.stopReason === "aborted") throw new Error(`${chosen.model} failed (${response.stopReason})`);
  return response.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

/** The model has one chance to fit the limit. After that it's yours to trim in the editor. */
async function propose(ctx: ExtensionContext, chosen: Mastermind, system: string, text: string, allowed: ReadonlySet<string>): Promise<Map<string, string>> {
  const first = parseProposals(await ask(ctx, chosen, system, text), allowed);
  if (![...first.values()].some((doc) => doc.length > PLAYBOOK_CHARS)) return first;
  const again = `${text}\n\nYour last answer went over the limit of ${PLAYBOOK_CHARS} characters:\n\n${[...first].map(([scope, doc]) => `<playbook scope="${scope}">${doc}</playbook>`).join("\n")}\n\nAnswer again within the limit.`;
  const second = parseProposals(await ask(ctx, chosen, system, again), allowed);
  return second.size > 0 ? second : first;
}

function why(text: string): string | undefined {
  if (text.length > PLAYBOOK_CHARS) return `That's ${text.length} characters, and the limit is ${PLAYBOOK_CHARS}.`;
  if (hasSecret(text)) return "That looks like it has a secret in it.";
  return undefined;
}

/** A person reads every word before any model does, as this goes in every system prompt. Returns false if they stopped. */
async function approve(ctx: ExtensionContext, agentDir: string, proposals: Map<string, string>): Promise<boolean> {
  for (const [scope, proposed] of proposals) {
    let text: string | undefined = proposed;
    for (;;) {
      text = await ctx.ui.editor(`Playbook for ${scope}. Delete what you don't want, then save.`, text);
      if (text === undefined) return false;
      const problem = why(text.trim());
      if (problem === undefined) break;
      ctx.ui.notify(problem, "warning");
    }
    writePlaybook(agentDir, scope, text);
  }
  return true;
}

export async function compact(ctx: ExtensionContext, agentDir: string, chosen: Mastermind, scopes: string[]): Promise<void> {
  const current = new Map(scopes.flatMap((scope): [string, string][] => {
    const text = readPlaybook(agentDir, scope);
    return text === "" ? [] : [[scope, text]];
  }));
  if (current.size === 0) return ctx.ui.notify("There's no playbook here to shorten yet.", "info");
  ctx.ui.notify(`${chosen.model} is shortening the playbook…`, "info");
  const proposals = await propose(ctx, chosen, COMPACT_SYSTEM, compactPrompt(current), new Set(current.keys()));
  if (proposals.size === 0) return ctx.ui.notify("It can't get any shorter.", "info");
  if (await approve(ctx, agentDir, proposals)) ctx.ui.notify("Playbook saved. New sessions and the next message here will use it.", "info");
}

const OPEN = "Read and edit what it wrote";
const REJECT = "Reject it, and don't read these sessions again";
const STOP = "Stop for now";

export async function review(ctx: ExtensionContext, agentDir: string, chosen: Mastermind, store: MemoryStore, files: string[]): Promise<void> {
  const reviewed = (path: string) => store.reviewedBytes(REVIEWED_KEY + path);
  for (;;) {
    const batch = nextBatch(files, reviewed, { skip: ctx.sessionManager.getSessionFile() });
    if (batch.parts.length === 0) return ctx.ui.notify("Nothing new to review.", "info");
    const parts = batch.parts.filter((part) => part.text);
    let proposals = new Map<string, string>();
    if (parts.length > 0) {
      ctx.ui.notify(`${chosen.model} is reading ${parts.length} sessions…`, "info");
      const scopes = [GLOBAL, ...new Set(parts.flatMap((part) => (part.cwd === null ? [] : [part.cwd])))];
      const current = new Map(scopes.flatMap((scope): [string, string][] => {
        const text = readPlaybook(agentDir, scope);
        return text === "" ? [] : [[scope, text]];
      }));
      proposals = await propose(ctx, chosen, REVIEW_SYSTEM, reviewPrompt(parts, current, randomBytes(8).toString("hex")), new Set(scopes));
    }
    if (proposals.size > 0) {
      const choice = await ctx.ui.select(`It has rules for ${[...proposals.keys()].join(", ")}`, [OPEN, REJECT, STOP]);
      if (choice === undefined || choice === STOP) return;
      if (choice === OPEN && !(await approve(ctx, agentDir, proposals))) return;
    }
    for (const part of batch.parts) store.markReviewed(REVIEWED_KEY + part.path, part.endBytes);
    if (batch.remaining === 0) return ctx.ui.notify("All reviewed.", "info");
    const more = await ctx.ui.confirm("Keep going?", `${batch.remaining} sessions are left. The next batch costs up to about 15,000 tokens of input on ${chosen.model}.`);
    if (!more) return;
  }
}
