import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { clearGate, installJudgeGate, JUDGE_NAMES, judgeGated, setGateMode } from "./judge-gate.ts";
import { decideToolCall, displayCommand, isMode, loadsAfterPermissionSystem, type Mode, MODES, modePrompt, nextMode, SUBMIT_PLAN_TOOL } from "./modes.ts";

const STATUS_KEY = "pi-modes";
const ENTRY_TYPE = "pi-modes";
const CYCLE_KEY = "shift+tab";

const STATUS_COLOR = { normal: "dim", auto: "warning", plan: "accent", "read-only": "success" } as const;

function chainNamesJudge(): boolean {
  try {
    const path = join(getAgentDir(), "extensions", "pi-permission-system", "config.json");
    const chain: unknown = JSON.parse(readFileSync(path, "utf8")).authorizerChain;
    return Array.isArray(chain) && chain.some((name) => JUDGE_NAMES.has(name));
  } catch {
    return false;
  }
}

function loadOrderIsLate(): boolean {
  try {
    return loadsAfterPermissionSystem(JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf8")).packages);
  } catch {
    return false;
  }
}

function restoredMode(ctx: ExtensionContext): Mode {
  let mode: Mode = "normal";
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
    const saved: unknown = (entry.data as { mode?: unknown } | undefined)?.mode;
    if (isMode(saved)) mode = saved;
  }
  return mode;
}

export default function piModes(pi: ExtensionAPI): void {
  installJudgeGate();

  let mode: Mode = "normal";
  let stopListening: (() => void) | undefined;
  let warnedUngated = false;

  function apply(next: Mode, ctx: ExtensionContext): void {
    mode = next;
    setGateMode(ctx.sessionManager.getSessionId(), next);
    const others = pi.getActiveTools().filter((name) => name !== SUBMIT_PLAN_TOOL);
    pi.setActiveTools(next === "plan" ? [...others, SUBMIT_PLAN_TOOL] : others);
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(STATUS_COLOR[next], `mode: ${next}`));
  }

  function warnIfJudgeUncontrolled(ctx: ExtensionContext): void {
    if (warnedUngated || !ctx.hasUI || judgeGated(ctx.sessionManager.getSessionId()) || !chainNamesJudge()) return;
    warnedUngated = true;
    ctx.ui.notify(
      "pi-modes could not take control of the permission judge. It may still auto-approve outside auto mode. See the README.",
      "warning",
    );
  }

  function change(next: Mode, ctx: ExtensionContext): void {
    if (next === mode) return;
    apply(next, ctx);
    pi.appendEntry(ENTRY_TYPE, { mode: next });
    if (!ctx.hasUI) return;
    // A judge named in the chain may not have registered yet: some load orders
    // only register it during the first prompt. agent_start checks that case.
    if (next === "auto" && !judgeGated(ctx.sessionManager.getSessionId()) && !chainNamesJudge()) {
      ctx.ui.notify(
        "Auto has no permission judge, so it behaves like normal. Set up pi-permission-classifier to use it.",
        "warning",
      );
    }
  }

  pi.on("session_start", (_event, ctx) => {
    apply(restoredMode(ctx), ctx);
    if (ctx.mode === "tui") {
      if (loadOrderIsLate()) {
        ctx.ui.notify(
          "pi-modes loads after pi-permission-system, so you may be asked to approve actions that are then blocked. Move it first in packages in settings.json.",
          "warning",
        );
      }
      stopListening = ctx.ui.onTerminalInput((data) => {
        if (!matchesKey(data, CYCLE_KEY)) return undefined;
        if (!isKeyRelease(data)) change(nextMode(mode), ctx);
        return { consume: true };
      });
    }
  });

  pi.on("session_tree", (_event, ctx) => apply(restoredMode(ctx), ctx));

  pi.on("session_shutdown", (_event, ctx) => {
    stopListening?.();
    stopListening = undefined;
    clearGate(ctx.sessionManager.getSessionId());
  });

  // Runs after every before_agent_start handler, which is the judge's last chance to register.
  pi.on("agent_start", (_event, ctx) => warnIfJudgeUncontrolled(ctx));

  pi.on("before_agent_start", (event) => {
    const prompt = modePrompt(mode);
    return prompt ? { systemPrompt: `${event.systemPrompt}\n\n${prompt}` } : undefined;
  });

  pi.on("tool_call", async (event, ctx) => {
    const decision = decideToolCall(mode, event.toolName, event.input);
    if (decision.action === "allow") return undefined;
    if (decision.action === "block") return { block: true, reason: decision.reason };

    const denied = `Plan mode blocked this command: ${decision.reason}.`;
    if (!ctx.hasUI) return { block: true, reason: denied };
    const command = (event.input as { command: string }).command;
    const approved = await ctx.ui.confirm("Plan mode: run this command?", `${decision.reason}\n\n${displayCommand(command)}`);
    return approved ? undefined : { block: true, reason: denied };
  });

  pi.registerTool({
    name: SUBMIT_PLAN_TOOL,
    label: "Submit plan",
    description: "Show the finished plan to the user for approval. Only available in plan mode.",
    parameters: Type.Object({
      plan: Type.String({ description: "The complete plan, as markdown" }),
    }),
    renderCall: (args, theme) => new Text(`${theme.bold("Plan")}\n${args.plan ?? ""}`, 0, 0),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const reply = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });
      if (mode !== "plan") return reply("Plan mode is off, so there is nothing to approve.");
      if (!ctx.hasUI) return reply("Nobody can approve a plan here. Stay in plan mode.");

      const NORMAL = "Approve, and ask before risky actions (normal)";
      const AUTO = "Approve, and let the judge approve actions (auto)";
      const KEEP = "Keep planning";
      const choice = await ctx.ui.select("Approve this plan?", [NORMAL, AUTO, KEEP]);

      if (choice === NORMAL || choice === AUTO) {
        const next: Mode = choice === AUTO ? "auto" : "normal";
        change(next, ctx);
        return reply(`The user approved the plan and switched to ${next} mode. Implement it now.`);
      }
      const feedback = await ctx.ui.input("What should change?", "");
      return reply(`The user did not approve the plan. Stay in plan mode. ${feedback ? `Feedback: ${feedback}` : "Ask what to change."}`);
    },
  });

  pi.registerCommand("mode", {
    description: `Show or set the mode: ${MODES.join(", ")}`,
    getArgumentCompletions: (prefix) => {
      const items = MODES.filter((name) => name.startsWith(prefix.trim())).map((value) => ({ value, label: value }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const requested = args.trim();
      if (requested === "") {
        const picked = ctx.hasUI ? await ctx.ui.select(`Mode (now ${mode})`, [...MODES]) : undefined;
        if (isMode(picked)) change(picked, ctx);
        return;
      }
      if (!isMode(requested)) {
        ctx.ui.notify(`Unknown mode ${requested}. Use one of: ${MODES.join(", ")}.`, "error");
        return;
      }
      change(requested, ctx);
    },
  });
}
