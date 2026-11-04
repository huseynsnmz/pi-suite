// ~/.pi/agent/router.json. Global only: a repository must not choose where your code gets sent.
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The judge's model lives only in the judge's own config, so there's one answer to which model judges. */
export const ROLES = ["plan", "build", "reader", "subagent", "fallback"] as const;
export type Role = (typeof ROLES)[number];

export interface RouterConfig {
  plan: string;
  build: string;
  reader?: string;
  subagent?: string;
  fallback?: string;
}

export type SavedConfig = Partial<Record<Role, string>>;

export const VIRTUAL_PROVIDER = "router";
export const VIRTUAL_ID = "auto";

export function configPath(agentDir: string): string {
  return join(agentDir, "router.json");
}

export function parseRef(ref: string): { provider: string; id: string } {
  const at = ref.indexOf("/");
  return { provider: ref.slice(0, at), id: ref.slice(at + 1) };
}

/** Throws on anything it doesn't understand, so a typo can't quietly send work to the wrong model. */
export function parseConfig(raw: unknown): SavedConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("router.json must be an object");
  for (const [role, ref] of Object.entries(raw)) {
    if (!(ROLES as readonly string[]).includes(role)) throw new Error(`router.json: unknown role "${role}". Use ${ROLES.join(", ")}`);
    if (typeof ref !== "string" || !/^[^/\s]+\/\S+$/.test(ref)) throw new Error(`router.json: ${role} must look like "provider/model"`);
    if (ref.startsWith(`${VIRTUAL_PROVIDER}/`)) throw new Error(`router.json: ${role} can't be a virtual model`);
  }
  return raw as SavedConfig;
}

export function isComplete(saved: SavedConfig): saved is RouterConfig {
  return saved.plan !== undefined && saved.build !== undefined;
}

/** An absent file is a router nobody has set up yet. A broken one throws. */
export function loadConfig(agentDir: string): SavedConfig {
  let text: string;
  try {
    text = readFileSync(configPath(agentDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return parseConfig(JSON.parse(text));
}

export function saveConfig(agentDir: string, saved: SavedConfig): void {
  // A linked file, as in a dotfiles setup, stays linked.
  const named = configPath(agentDir);
  const path = existsSync(named) ? realpathSync(named) : named;
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(saved, null, 2)}\n`);
  renameSync(temp, path);
}
