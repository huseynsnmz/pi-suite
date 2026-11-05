import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { changesToReview, type GitRun, reviewPrompt } from "./security-review.ts";

const REVIEW_MESSAGE = "security-review";

/** The model /clear hands to the session it starts. Pi's own new session would take the saved default. */
const KEPT = Symbol.for("pi-suite:clear-keeps");
interface Kept {
  provider: string;
  id: string;
  thinking: ReturnType<ExtensionAPI["getThinkingLevel"]>;
}

export default function piCommands(pi: ExtensionAPI): void {
  pi.registerCommand("clear", {
    description: "Clear the conversation and start a new session",
    handler: async (_args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.abort();
        await ctx.waitForIdle();
      }
      const store = globalThis as Record<symbol, Kept | undefined>;
      if (ctx.model) store[KEPT] = { provider: ctx.model.provider, id: ctx.model.id, thinking: pi.getThinkingLevel() };
      await ctx.newSession();
      delete store[KEPT]; // Still here only if it was cancelled.
    },
  });

  // Runs in the new session, where this extension is a new instance, so what /clear kept can't live in it.
  pi.on("session_start", async (event, ctx) => {
    const store = globalThis as Record<symbol, Kept | undefined>;
    const kept = store[KEPT];
    delete store[KEPT];
    if (event.reason !== "new" || kept === undefined) return;
    const model = ctx.modelRegistry.find(kept.provider, kept.id);
    if (model !== undefined) await pi.setModel(model);
    pi.setThinkingLevel(kept.thinking);
  });

  // The diff goes to the model, and only this one line goes on screen.
  pi.registerMessageRenderer<{ summary: string }>(REVIEW_MESSAGE, (message, _options, theme) =>
    new Text(theme.fg("muted", message.details?.summary ?? "Security review"), 1, 0),
  );

  pi.registerCommand("security-review", {
    description: "Review this branch's changes for security problems. Text after it is passed to the model.",
    handler: async (args, ctx) => {
      const say = (text: string, level: "info" | "error") => {
        if (ctx.hasUI) ctx.ui.notify(text, level);
        else console.error(text);
      };
      const run: GitRun = (gitArgs) => pi.exec("git", gitArgs, { cwd: ctx.cwd, timeout: 30_000 });
      const changes = await changesToReview(run);
      if (changes.problem !== undefined) return say(changes.problem, "error");
      if (changes.files === 0) return say(`No changes to review against ${changes.against}.`, "info");
      const summary = `Security review of ${changes.files} changed file${changes.files === 1 ? "" : "s"} against ${changes.against}`;
      pi.sendMessage(
        { customType: REVIEW_MESSAGE, content: reviewPrompt(changes, args.trim()), display: true, details: { summary } },
        { triggerTurn: true, deliverAs: "followUp" },
      );
    },
  });
}
