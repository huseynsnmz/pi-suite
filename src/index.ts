// One package, seven parts. A part that's off isn't even imported, so it adds no tools, prompts or start-up time.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type ExtensionAPI, type ExtensionCommandContext, getAgentDir } from "@earendil-works/pi-coding-agent";

import { isPart, loadSettings, type Part, PART_NAMES, PARTS, saveSettings, separateInstalls } from "./settings.ts";

function loadPart(part: Part): Promise<{ default: (pi: ExtensionAPI) => void | Promise<void> }> {
  return import(new URL(`../packages/${part}/src/index.ts`, import.meta.url).href);
}

/** Skills are found through this event rather than the manifest, so a part that's off doesn't offer them. */
const SKILLS: Partial<Record<Part, string>> = { modes: "modes", memory: "memory" };

const MODES_OFF = "plan, read-only and auto aren't enforced, and Pi runs tools with no mode checks";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export default async function piSuite(pi: ExtensionAPI): Promise<void> {
  const agentDir = getAgentDir();
  const settings = loadSettings(agentDir);
  const notices: string[] = settings.problem === undefined ? [] : [`pi-suite: ${settings.problem}`];
  const loaded = new Set<Part>();
  const failed = new Set<Part>();
  if (settings.off.has("modes")) notices.push(`pi-suite: modes is off, so ${MODES_OFF}`);

  for (const part of PART_NAMES) {
    if (settings.off.has(part)) continue;
    try {
      await (await loadPart(part)).default(pi);
      loaded.add(part);
    } catch (error) {
      // Modes enforces plan and read-only, so Pi must not go on without it. Pi's own loader then reports this and stops.
      if (part === "modes") throw error;
      failed.add(part);
      notices.push(`pi-suite: ${part} failed to load, and may be partly working: ${(error as Error).message}`);
    }
  }

  pi.on("resources_discover", () => ({
    skillPaths: PART_NAMES.filter((part) => loaded.has(part) && SKILLS[part] !== undefined).map((part) => join(ROOT, "packages", SKILLS[part] as string, "skills")),
  }));

  pi.on("session_start", (_event, ctx) => {
    for (const notice of notices.splice(0)) {
      if (ctx.hasUI) ctx.ui.notify(notice, "error");
      else console.error(notice);
    }
    if (!ctx.hasUI) return;
    let packages: unknown;
    try {
      packages = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages;
    } catch {
      return;
    }
    const twice = separateInstalls(packages);
    if (twice.length > 0) ctx.ui.notify(`pi-suite already includes these, so remove them with pi remove: ${twice.join(", ")}`, "warning");
  });

  /** What's saved can differ from what's running, until the next /reload. */
  function currentOff(): Set<Part> {
    return new Set(loadSettings(agentDir).off);
  }

  async function setPart(part: Part, on: boolean, ctx: ExtensionCommandContext): Promise<boolean> {
    const off = currentOff();
    if (off.has(part) === !on) return false;
    if (!on && part === "modes") {
      // Nobody can agree to it here, and a script could be passing on someone else's text.
      if (!ctx.hasUI) {
        console.error("pi-suite: /suite off modes needs someone to confirm it, so nothing changed.");
        return false;
      }
      if (!(await ctx.ui.confirm("Turn off modes?", `With it off, ${MODES_OFF}.`))) return false;
    }
    if (on) off.delete(part);
    else off.add(part);
    saveSettings(agentDir, off);
    if (!on && part === "router") await leaveRouter(ctx);
    return true;
  }

  /** The session would otherwise stay on a model that's gone after the reload, and every prompt would fail. */
  async function leaveRouter(ctx: ExtensionCommandContext): Promise<void> {
    if (ctx.model?.api !== "pi-virtual") return;
    const lastAnswer = ctx.sessionManager
      .getBranch()
      .flatMap((entry) => (entry.type === "message" && entry.message.role === "assistant" && entry.message.stopReason !== "error" && entry.message.stopReason !== "aborted" ? [entry.message] : []))
      .at(-1);
    const answered = lastAnswer && ctx.modelRegistry.find(lastAnswer.provider, lastAnswer.model);
    const next = answered ?? ctx.modelRegistry.getAvailable().find((model) => model.api !== "pi-virtual");
    if (next === undefined) return;
    await pi.setModel(next);
    if (ctx.hasUI) ctx.ui.notify(`Now on ${next.provider}/${next.id}.`, "info");
  }

  async function finish(changed: boolean, ctx: ExtensionCommandContext): Promise<void> {
    if (!changed) return;
    if (ctx.hasUI && (await ctx.ui.confirm("Reload Pi now?", "Your changes apply after a reload."))) await ctx.reload();
    else if (ctx.hasUI) ctx.ui.notify("Saved. Run /reload to apply it.", "info");
  }

  function status(): string {
    const off = currentOff();
    return PART_NAMES.map((part) => {
      if (failed.has(part)) return `${part}: failed to load  ${PARTS[part]}`;
      const now = loaded.has(part);
      const next = !off.has(part);
      const pending = now === next ? "" : ` (${next ? "on" : "off"} after /reload)`;
      return `${part}: ${now ? "on" : "off"}${pending}  ${PARTS[part]}`;
    }).join("\n");
  }

  pi.registerCommand("suite", {
    description: "Turn parts of pi-suite on or off: /suite, /suite on web, /suite off board, /suite list",
    getArgumentCompletions: (prefix) => {
      const typed = prefix.trimStart().toLowerCase();
      const options = ["list", ...PART_NAMES.flatMap((part) => [`on ${part}`, `off ${part}`])];
      const found = options.filter((option) => option.startsWith(typed) && option !== typed);
      return found.length === 0 ? null : found.map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const [verb, name, ...rest] = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (verb === "list") {
        if (ctx.hasUI) ctx.ui.notify(status(), "info");
        else console.log(status());
        return;
      }
      if (verb === "on" || verb === "off") {
        if (name === undefined || !isPart(name) || rest.length > 0) {
          ctx.ui.notify(`Use /suite ${verb} with one of: ${PART_NAMES.join(", ")}`, "error");
          return;
        }
        await finish(await setPart(name, verb === "on", ctx), ctx);
        return;
      }
      if (verb !== undefined) {
        ctx.ui.notify("Use /suite, /suite list, /suite on <part> or /suite off <part>", "error");
        return;
      }
      if (!ctx.hasUI) return;
      let changed = false;
      for (;;) {
        const off = currentOff();
        const rows = PART_NAMES.map((part) => `${off.has(part) ? "[ ]" : "[x]"} ${part}  ${PARTS[part]}`);
        const row = await ctx.ui.select("pi-suite: Enter turns a part on or off (Esc when done)", rows);
        if (row === undefined) break;
        const part = PART_NAMES[rows.indexOf(row)] as Part;
        if (await setPart(part, off.has(part), ctx)) changed = true;
      }
      await finish(changed, ctx);
    },
  });
}
