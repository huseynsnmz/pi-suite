/** `/board-model`: which model writes the board's titles, summaries and states. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readConfig, setHelperModel } from "../core/config.mjs";

const OFF = "Off: use built-in rules, no model calls";

export function registerBoardModelCommand(pi: ExtensionAPI): void {
	pi.registerCommand("board-model", {
		description: "Choose the model for the board's titles, summaries and states, or turn it off",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;
			const refs = ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`);
			const current = readConfig().model;
			const choice = await ctx.ui.select(`Board helper model (now: ${current ?? "off"})`, [OFF, ...refs]);
			if (choice === undefined) return;
			const model = choice === OFF ? null : choice;
			setHelperModel(model);
			ctx.ui.notify(model ? `The board's helper calls now use ${model}.` : "The board's helper model calls are off.", "info");
		},
	});
}
