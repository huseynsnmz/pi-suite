/**
 * Yolo with deny rules off. The permission system's rules can't be switched off for one
 * session and no extension can undo its block, so the agent gets separate tools the rules
 * don't name. They take `file` instead of `path`, because the permission system reads `path`
 * from any tool. They run only while the user has chosen this, and nothing else is covered.
 */
import { type AgentToolUpdateCallback, createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const FACTORIES = { bash: createBashToolDefinition, read: createReadToolDefinition, write: createWriteToolDefinition, edit: createEditToolDefinition };
type Original = keyof typeof FACTORIES;

export const ALIASES: Readonly<Record<Original, string>> = { bash: "yolo_bash", read: "yolo_read", write: "yolo_write", edit: "yolo_edit" };
const ORIGINALS = Object.keys(ALIASES) as Original[];
const ALIAS_NAMES = new Set(Object.values(ALIASES));

export const DENY_OFF_PROMPT = `Yolo mode with deny rules off. Use yolo_bash, yolo_read, yolo_write and yolo_edit in place of bash, read, write and edit. The file tools take \`file\` instead of \`path\`.`;

/** The active tools with the aliases taken out, and what they stood in for put back. */
export function withoutAliases(active: readonly string[], replaced: readonly string[]): string[] {
  return [...active.filter((name) => !ALIAS_NAMES.has(name)), ...replaced.filter((name) => !active.includes(name))];
}

/** Each active original swapped for its alias, and which ones were swapped. */
export function withAliases(active: readonly string[]): { active: string[]; replaced: string[] } {
  const replaced = ORIGINALS.filter((name) => active.includes(name));
  const kept = active.filter((name) => !replaced.includes(name as Original) && !ALIAS_NAMES.has(name));
  return { active: [...kept, ...replaced.map((name) => ALIASES[name])], replaced };
}

function renamePath<T>(schema: T): T {
  const object = schema as { properties: Record<string, unknown>; required?: string[] };
  const { path, ...rest } = object.properties;
  if (path === undefined) return schema;
  return {
    ...object,
    properties: { file: path, ...rest },
    required: (object.required ?? []).map((name) => (name === "path" ? "file" : name)),
  } as T;
}

function restorePath(params: Record<string, unknown>): Record<string, unknown> {
  if (!("file" in params)) return params;
  const { file, ...rest } = params;
  return { ...rest, path: file };
}

export function aliasDefinitions(isOn: () => boolean) {
  return ORIGINALS.map((original) => {
    const template = FACTORIES[original](process.cwd());
    return {
      name: ALIASES[original],
      label: `${template.label} (yolo)`,
      description: `${template.description} Only available in yolo with deny rules off.`,
      parameters: renamePath(template.parameters),
      async execute(id: string, params: unknown, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<unknown> | undefined, ctx: ExtensionContext) {
        if (!isOn()) throw new Error("Deny rules are on. Use the normal tools.");
        const tool = FACTORIES[original](ctx.cwd);
        return (tool.execute as (...args: unknown[]) => Promise<{ content: { type: "text"; text: string }[]; details: unknown }>)(id, restorePath(params as Record<string, unknown>), signal, onUpdate, ctx);
      },
    };
  });
}
