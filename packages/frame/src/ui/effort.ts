// `/effort`: the thinking level by name, for when Shift+Tab belongs to another extension.
import type { FeatureScope } from "../kit/index.ts";

import { EFFORT_LEVELS } from "../render/paint.ts";

const EFFORTS = ["off", ...EFFORT_LEVELS] as const;
type Effort = (typeof EFFORTS)[number];

function isEffort(value: string): value is Effort {
	return (EFFORTS as readonly string[]).includes(value);
}

export function registerEffort(scope: FeatureScope): void {
	scope.registerCommand("effort", {
		description: "Change how hard the model thinks",
		getArgumentCompletions: (prefix) => {
			const found = EFFORTS.filter((level) => level.startsWith(prefix.trim().toLowerCase()));
			return found.length === 0 ? null : found.map((level) => ({ value: level, label: level }));
		},
		handler: async (args, ctx) => {
			const asked =
				args.trim().toLowerCase() ||
				(await ctx.ui.select(`Effort (now ${scope.getThinkingLevel()})`, [...EFFORTS]));
			if (asked === undefined) return;
			if (!isEffort(asked)) {
				ctx.ui.notify(`Unknown effort "${asked}". Use one of: ${EFFORTS.join(", ")}`, "error");
				return;
			}
			scope.setThinkingLevel(asked);
			// Pi clamps it to what the model can do.
			const level = scope.getThinkingLevel();
			if (level === asked) ctx.ui.notify(`Effort: ${level}`, "info");
			else ctx.ui.notify(`This model can't use ${asked}, so effort is ${level}`, "warning");
		},
	});
}
