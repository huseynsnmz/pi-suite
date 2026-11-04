import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

import { isComplete, loadConfig, parseConfig, parseRef, type Role, ROLES, type SavedConfig, saveConfig, VIRTUAL_ID, VIRTUAL_PROVIDER } from "./config.ts";
import { judgeModel, setJudgeModel } from "./judge.ts";
import { chooseModel, type RouterState } from "./route.ts";

/** Other extensions emit these with an object, and whoever knows fills it in, whatever the load order. */
const READER_PROBE = "pi-router:reader-model";
const MODE_PROBE = "pi-modes:mode";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const VIRTUAL_API = "pi-virtual";

const JUDGE = "judge";
const JUDGE_HELP = "decides permission asks for pi-permission-classifier";
const ROLE_HELP: Record<Role, string> = {
  plan: "reads and plans, until the first edit, and all of plan mode",
  build: "the rest of the work, and compaction summaries",
  reader: "reads web pages for pi-web",
  subagent: "runs subagents that use this virtual model",
  fallback: "takes over when a provider is overloaded",
};

/** What a role shows, and offers to go back to, with no model of its own. */
const UNSET: Partial<Record<Role, string>> = {
  reader: "same as build",
  subagent: "same as build",
  fallback: "none",
};

function refOf(model: { provider: string; id: string } | undefined): string | undefined {
  return model === undefined ? undefined : `${model.provider}/${model.id}`;
}

export default function piRouter(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  let saved: SavedConfig = {};
  let problem: string | undefined;
  try {
    saved = loadConfig(agentDir);
  } catch (error) {
    problem = `pi-router is off: ${(error as Error).message}`;
  }
  let registered = false;
  let warnedJudge = false;

  pi.events.on(READER_PROBE, (data) => {
    if (!isComplete(saved)) return;
    (data as { model?: string }).model = saved.reader ?? saved.build;
  });

  function currentMode(): string | undefined {
    const probe: { mode?: string } = {};
    pi.events.emit(MODE_PROBE, probe);
    return probe.mode;
  }

  function register(): void {
    // A broken file still registers, so router/auto stops with the reason rather than Pi picking another model.
    if (registered || (!isComplete(saved) && problem === undefined)) return;
    registered = true;
    pi.registerVirtualModel<RouterState>({
      provider: VIRTUAL_PROVIDER,
      id: VIRTUAL_ID,
      name: "Auto",
      thinkingLevels: [...THINKING_LEVELS],
      route(request, ctx) {
        if (problem !== undefined) throw new Error(problem);
        if (!isComplete(saved)) throw new Error("pi-router has no plan and build models. Run /router");
        const choice = chooseModel(saved, {
          reason: request.reason,
          mode: currentMode(),
          subagent: process.env.PI_SUBAGENT_CHILD === "1",
          state: request.state,
          previous: refOf(request.previous?.model),
          failed: request.failed && { model: refOf(request.failed.model) as string, errorMessage: request.failed.message.errorMessage },
          messages: request.messages,
        });
        const { provider, id } = parseRef(choice.model);
        const model = ctx.modelRegistry.find(provider, id);
        if (model === undefined) throw new Error(`pi-router: ${choice.model} isn't a known model. Run /router`);
        if (!ctx.modelRegistry.hasConfiguredAuth(model)) throw new Error(`pi-router: no login for ${choice.model}. Run /login or /router`);
        return { model, thinkingLevel: request.thinkingLevel, state: choice.state };
      },
    });
  }
  register();

  /** With a virtual model selected and no model of its own, the judge fails and every ask comes to you. */
  function warnAboutJudge(ctx: ExtensionContext): void {
    if (warnedJudge || !ctx.hasUI || refOf(ctx.model) !== `${VIRTUAL_PROVIDER}/${VIRTUAL_ID}`) return;
    if (judgeModel(agentDir) !== null) return;
    warnedJudge = true;
    ctx.ui.notify("The permission judge has no model of its own, so with router/auto it can't judge and every ask comes to you. Set judge in /router.", "warning");
  }

  pi.on("session_start", (_event, ctx) => {
    register();
    if (problem !== undefined && ctx.hasUI) ctx.ui.notify(problem, "error");
    warnAboutJudge(ctx);
  });
  // Pi keeps virtual models across a reload, so one left here would outlive this extension being turned off.
  pi.on("session_shutdown", () => {
    if (!registered) return;
    registered = false;
    pi.unregisterVirtualModel(VIRTUAL_PROVIDER, VIRTUAL_ID);
  });
  pi.on("model_select", (_event, ctx) => warnAboutJudge(ctx));

  function setRole(role: Role, ref: string | undefined): void {
    // Another session may have changed it since this one read it.
    const next: SavedConfig = { ...loadConfig(agentDir) };
    if (ref === undefined) delete next[role];
    else next[role] = ref;
    saved = parseConfig(next);
    saveConfig(agentDir, saved);
    register();
  }

  async function chooseJudge(ctx: ExtensionContext, models: readonly string[]): Promise<void> {
    const picked = await ctx.ui.select(`${JUDGE} ${JUDGE_HELP}`, ["not set", ...models]);
    if (picked === undefined) return;
    try {
      setJudgeModel(agentDir, picked === "not set" ? undefined : picked);
      ctx.ui.notify("Judge model set. Run /reload for the judge to use it.", "info");
    } catch (error) {
      ctx.ui.notify(`Couldn't set the judge, so nothing changed. Is pi-permission-classifier set up? ${(error as Error).message}`, "error");
    }
  }

  async function chooseRoles(ctx: ExtensionContext): Promise<void> {
    if (problem !== undefined) {
      // Saving over it would throw away whatever the file held.
      ctx.ui.notify(`${problem}. Fix or delete ~/.pi/agent/router.json, then /reload.`, "error");
      return;
    }
    const models = ctx.modelRegistry.getAvailable().filter((model) => model.api !== VIRTUAL_API).map((model) => `${model.provider}/${model.id}`);
    if (models.length === 0) {
      ctx.ui.notify("No models to choose from. Run /login first.", "warning");
      return;
    }
    for (;;) {
      const judge = judgeModel(agentDir);
      const rows = [...ROLES.map((role) => `${role}: ${saved[role] ?? UNSET[role] ?? "not set"}`), `${JUDGE}: ${judge ?? (judge === null ? "not set" : "not installed")}`];
      const row = await ctx.ui.select("Router: which role? (Esc when done)", rows);
      if (row === undefined) break;
      const role = ROLES[rows.indexOf(row)];
      if (role === undefined) {
        await chooseJudge(ctx, models);
        continue;
      }
      const unset = UNSET[role];
      const picked = await ctx.ui.select(`${role} ${ROLE_HELP[role]}`, [...(unset === undefined ? [] : [unset]), ...models]);
      if (picked === undefined) continue;
      try {
        setRole(role, picked === unset ? undefined : picked);
      } catch (error) {
        ctx.ui.notify((error as Error).message, "error");
      }
    }
    if (isComplete(saved)) ctx.ui.notify(`Choose ${VIRTUAL_PROVIDER}/${VIRTUAL_ID} in /model to use these.`, "info");
    else ctx.ui.notify("The router needs both plan and build before router/auto appears.", "warning");
  }

  pi.registerCommand("router", {
    description: "Choose which model does what for router/auto",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      await chooseRoles(ctx);
    },
  });
}
