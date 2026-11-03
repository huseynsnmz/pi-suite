import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, Text, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { aliasDefinitions, DENY_OFF_PROMPT, withAliases, withoutAliases } from "./deny-off.ts";
import { clearGate, hasPermissionSystem, installJudgeGate, JUDGE_NAMES, judgeGated, registerYoloLink, setGateMode, YOLO_LINK } from "./judge-gate.ts";
import { decideToolCall, displayCommand, isMode, loadsAfterPermissionSystem, type Mode, MODES, modePrompt, nextMode, resumedMode, SUBMIT_PLAN_TOOL } from "./modes.ts";

const STATUS_KEY = "pi-modes";
const DENY_STATUS_KEY = "pi-modes-deny";
const ENTRY_TYPE = "pi-modes";
const CYCLE_KEY = "shift+tab";

const STATUS_COLOR = { normal: "dim", auto: "warning", plan: "accent", "read-only": "success", yolo: "error" } as const;

function chainNames(wanted: (name: unknown) => boolean): boolean {
  try {
    const path = join(getAgentDir(), "extensions", "pi-permission-system", "config.json");
    const chain: unknown = JSON.parse(readFileSync(path, "utf8")).authorizerChain;
    return Array.isArray(chain) && chain.some(wanted);
  } catch {
    return false;
  }
}

function chainNamesJudge(): boolean {
  return chainNames((name) => JUDGE_NAMES.has(name as string));
}

/**
 * Only Enter starts it, so no other key, like a stray y, can agree to it. Deny rules stay on
 * unless the user presses d. Undefined means cancelled.
 */
async function confirmYolo(ctx: ExtensionContext, canIgnoreDeny: boolean): Promise<{ denyOff: boolean } | undefined> {
  let denyOff = false;
  const agreed = await ctx.ui.custom<boolean>((tui, theme, _keys, done) => ({
    invalidate() {},
    handleInput(data: string) {
      if (matchesKey(data, "enter")) done(true);
      else if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done(false);
      else if (canIgnoreDeny && matchesKey(data, "d")) {
        denyOff = !denyOff;
        tui.requestRender();
      }
    },
    render(width: number) {
      const red = (text: string) => theme.fg("error", text);
      const rule = red("─".repeat(width));
      const body = [
        red(theme.bold("▲ YOLO")),
        "",
        "The agent stops asking. Anything it wants to run is approved, including commands that delete files or reach the network.",
        theme.fg("dim", "It lasts until you change mode or leave this session."),
        "",
        denyOff
          ? red(theme.bold("Deny rules: IGNORED for bash, read, write and edit. Secrets you protected can be read."))
          : `Deny rules: ${theme.bold("respected")}`,
        "",
        `${red(theme.bold("Enter"))} start   ${canIgnoreDeny ? `${theme.fg("dim", denyOff ? "d respect deny rules" : "d ignore deny rules")}   ` : ""}${theme.fg("dim", "Esc cancel")}`,
      ];
      return [rule, ...body.flatMap((line) => (line === "" ? [""] : wrapTextWithAnsi(line, width))), rule];
    },
  }));
  return agreed === true ? { denyOff } : undefined;
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
  return resumedMode(mode);
}

export default function piModes(pi: ExtensionAPI): void {
  installJudgeGate();

  let mode: Mode = "normal";
  let stopListening: (() => void) | undefined;
  let warnedUngated = false;
  let disposeYoloLink: (() => void) | undefined;
  let denyOff = false;
  let replacedTools: string[] = [];

  for (const tool of aliasDefinitions(() => mode === "yolo" && denyOff)) pi.registerTool(tool);

  pi.events.on("permissions:ready", (data) => {
    const sessionId = (data as { sessionId?: unknown } | undefined)?.sessionId;
    if (disposeYoloLink !== undefined || typeof sessionId !== "string") return;
    disposeYoloLink = registerYoloLink(sessionId);
  });

  function apply(next: Mode, ctx: ExtensionContext): void {
    mode = next;
    if (next !== "yolo") denyOff = false;
    setGateMode(ctx.sessionManager.getSessionId(), next);
    let others = withoutAliases(pi.getActiveTools().filter((name) => name !== SUBMIT_PLAN_TOOL), replacedTools);
    replacedTools = [];
    if (denyOff) ({ active: others, replaced: replacedTools } = withAliases(others));
    pi.setActiveTools(next === "plan" ? [...others, SUBMIT_PLAN_TOOL] : others);
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(STATUS_COLOR[next], `mode: ${next}`));
      ctx.ui.setStatus(DENY_STATUS_KEY, denyOff ? ctx.ui.theme.fg("error", "deny rules off") : undefined);
    }
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

  /** Every way into a mode a person can pick goes through here, so yolo can't skip its question. */
  async function pick(next: Mode, ctx: ExtensionContext): Promise<void> {
    if (next === "yolo" && next !== mode) {
      if (!ctx.hasUI) return;
      if (hasPermissionSystem(ctx.sessionManager.getSessionId()) && !chainNames((name) => name === YOLO_LINK)) {
        ctx.ui.notify(`Yolo needs "${YOLO_LINK}" in authorizerChain in pi-permission-system's config.json, then a restart. See the README.`, "error");
        return;
      }
      const agreed = await confirmYolo(ctx, hasPermissionSystem(ctx.sessionManager.getSessionId()));
      if (agreed === undefined) return;
      denyOff = agreed.denyOff;
    }
    change(next, ctx);
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
    disposeYoloLink?.();
    disposeYoloLink = undefined;
    clearGate(ctx.sessionManager.getSessionId());
  });

  // Runs after every before_agent_start handler, which is the judge's last chance to register.
  pi.on("agent_start", (_event, ctx) => warnIfJudgeUncontrolled(ctx));

  pi.on("before_agent_start", (event) => {
    const prompt = denyOff ? DENY_OFF_PROMPT : modePrompt(mode);
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
        if (isMode(picked)) await pick(picked, ctx);
        return;
      }
      if (!isMode(requested)) {
        ctx.ui.notify(`Unknown mode ${requested}. Use one of: ${MODES.join(", ")}.`, "error");
        return;
      }
      await pick(requested, ctx);
    },
  });
}
