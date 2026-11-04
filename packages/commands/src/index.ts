import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { changesToReview, type GitRun, reviewPrompt } from "./security-review.ts";

const REVIEW_MESSAGE = "security-review";

export default function piCommands(pi: ExtensionAPI): void {
  pi.registerCommand("clear", {
    description: "Clear the conversation and start a new session",
    handler: async (_args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.abort();
        await ctx.waitForIdle();
      }
      await ctx.newSession();
    },
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
