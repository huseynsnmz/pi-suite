// One package, seven parts. A part that's off isn't even imported, so it adds no tools, prompts or start-up time.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type ExtensionAPI, type ExtensionCommandContext, getAgentDir } from "@earendil-works/pi-coding-agent";

import { checkSection, type Field, FIELDS, shownValue, typedValue } from "./settings-ui.ts";
import { isPart, loadSettings, moveOldSettings, type Part, PART_NAMES, PARTS, readSection, saveSettings, separateInstalls, writeSection } from "./settings.ts";

function loadPart(part: Part): Promise<{ default: (pi: ExtensionAPI) => void | Promise<void> }> {
  return import(new URL(`../packages/${part}/src/index.ts`, import.meta.url).href);
}

/** Skills are found through this event rather than the manifest, so a part that's off doesn't offer them. */
const SKILLS: Partial<Record<Part, string>> = { modes: "modes", memory: "memory" };

const MODES_OFF = "plan, read-only and auto aren't enforced, and Pi runs tools with no mode checks";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export default async function piSuite(pi: ExtensionAPI): Promise<void> {
  const agentDir = getAgentDir();
  const moveProblems = moveOldSettings(agentDir);
  const settings = loadSettings(agentDir);
  const notices: string[] = [...moveProblems, ...(settings.problem === undefined ? [] : [`pi-suite: ${settings.problem}`])];
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
    try {
      saveSettings(agentDir, off);
    } catch (error) {
      ctx.ui.notify(`Nothing changed: ${(error as Error).message}`, "error");
      return false;
    }
    if (!on && part === "router") await leaveModels(ctx, "pi-virtual");
    if (!on && part === "subscription") await leaveModels(ctx, "claude-agent-sdk");
    return true;
  }

  /** The session would otherwise stay on a model that's gone after the reload, and every prompt would fail. */
  async function leaveModels(ctx: ExtensionCommandContext, api: string): Promise<void> {
    if (ctx.model?.api !== api) return;
    const lastAnswer = ctx.sessionManager
      .getBranch()
      .flatMap((entry) => (entry.type === "message" && entry.message.role === "assistant" && entry.message.stopReason !== "error" && entry.message.stopReason !== "aborted" ? [entry.message] : []))
      .at(-1);
    const answered = lastAnswer && ctx.modelRegistry.find(lastAnswer.provider, lastAnswer.model);
    const next = (answered?.api === api ? undefined : answered) ?? ctx.modelRegistry.getAvailable().find((model) => model.api !== "pi-virtual" && model.api !== api);
    if (next === undefined) return;
    await pi.setModel(next);
    if (ctx.hasUI) ctx.ui.notify(`Now on ${next.provider}/${next.id}.`, "info");
  }

  async function finish(changed: boolean, ctx: ExtensionCommandContext): Promise<void> {
    if (!changed) return;
    if (ctx.hasUI && (await ctx.ui.confirm("Reload Pi now?", "Your changes apply after a reload."))) await ctx.reload();
    else if (ctx.hasUI) ctx.ui.notify("Saved. Run /reload to apply it.", "info");
  }

  /** Asks for a new value. True if one was saved. */
  async function editField(part: Part, field: Field, ctx: ExtensionCommandContext): Promise<boolean> {
    const section = readSection(agentDir, part);
    const current = section[field.key];
    let value: unknown;
    const prompt = `${part}: ${field.label}`;
    if (field.kind === "boolean" || field.kind === "choice" || field.kind === "model") {
      const options =
        field.kind === "boolean"
          ? ["on", "off"]
          : field.kind === "choice"
            ? [...field.options, "default"]
            : ["default", ...ctx.modelRegistry.getAvailable().filter((model) => model.api !== "pi-virtual").map((model) => `${model.provider}/${model.id}`)];
      const picked = await ctx.ui.select(prompt, options);
      if (picked === undefined) return false;
      value = field.kind === "boolean" ? (picked === "on" ? true : undefined) : picked === "default" ? undefined : picked;
    } else {
      const shown = Array.isArray(current) ? current.join(", ") : current === undefined ? "" : String(current);
      const typed = await ctx.ui.input(`${prompt}${field.kind === "list" ? " (separate with commas, empty clears)" : " (empty clears)"}`, shown);
      if (typed === undefined) return false;
      value = typedValue(field, typed);
    }
    const next = { ...section };
    if (value === undefined) delete next[field.key];
    else next[field.key] = value;
    checkSection(part, next);
    writeSection(agentDir, part, next);
    return true;
  }

  /** One part: on or off, then its settings. True if anything was saved. */
  async function partMenu(part: Part, ctx: ExtensionCommandContext): Promise<boolean> {
    let changed = false;
    const fields = FIELDS[part] ?? [];
    for (;;) {
      let section: Record<string, unknown> = {};
      try {
        section = readSection(agentDir, part);
      } catch (error) {
        ctx.ui.notify((error as Error).message, "error");
      }
      const off = currentOff();
      const toggle = off.has(part) ? "Turned off. Enter turns it on" : "Turned on. Enter turns it off";
      const extra = part === "router" ? ["Models and reasoning"] : part === "frame" ? ["Icons, frame style and more"] : [];
      const rows = [toggle, ...extra, ...fields.map((field) => `${field.label}: ${shownValue(part, field, section)}`)];
      const row = await ctx.ui.select(`${part}: ${PARTS[part]} (Esc to go back)`, rows);
      if (row === undefined) return changed;
      const index = rows.indexOf(row);
      if (index === 0) {
        if (await setPart(part, off.has(part), ctx)) changed = true;
        continue;
      }
      if (extra.includes(row)) {
        if (part === "frame") {
          ctx.ui.notify("Press Ctrl+S in the editor for the frame's settings, or use /harness with the frame off.", "info");
          continue;
        }
        const probe: { open?: (ctx: ExtensionCommandContext) => Promise<void> } = {};
        pi.events.emit("pi-suite:router-settings", probe);
        if (probe.open === undefined) ctx.ui.notify("Turn router on and reload first.", "warning");
        else {
          await probe.open(ctx);
        }
        continue;
      }
      const field = fields[index - 1 - extra.length] as Field;
      try {
        if (await editField(part, field, ctx)) changed = true;
      } catch (error) {
        ctx.ui.notify(`Not saved: ${(error as Error).message}`, "error");
      }
    }
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
    description: "Settings for pi-suite, and turning its parts on or off: /suite, /suite on web, /suite off board, /suite list",
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
        const row = await ctx.ui.select("pi-suite: pick a part (Esc when done)", rows);
        if (row === undefined) break;
        const part = PART_NAMES[rows.indexOf(row)] as Part;
        if (await partMenu(part, ctx)) changed = true;
      }
      await finish(changed, ctx);
    },
  });
}
