import { homedir } from "node:os";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { claudeInstructions, isClaude, notLoaded } from "./instructions.ts";

/** Requests to Claude also get your Claude Code instructions. Pi's own AGENTS.md and APPEND_SYSTEM.md apply to every model as before. */
export default function piClaudeContext(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event, ctx) => {
    if (!isClaude(ctx.model)) return;
    const options = event.systemPromptOptions;
    // Read every turn, so an edit to the files applies from the next message.
    options.contextFiles.push(...notLoaded(options.contextFiles, claudeInstructions(homedir())));
  });
}
