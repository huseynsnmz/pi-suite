// pi-permission-classifier calls its model directly, which can't work with a virtual model, and it
// has no way to ask another extension. So its own setting holds the judge's model.
import { fchmodSync, closeSync, fsyncSync, openSync, readFileSync, realpathSync, renameSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";

import { parseRef } from "./config.ts";

function judgeConfigPath(agentDir: string): string {
  return join(agentDir, "extensions", "pi-permission-classifier", "config.json");
}

function readObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed as Record<string, unknown>;
}

/** Undefined when the judge isn't set up here, so there's nothing to wire. */
export function judgeModel(agentDir: string): string | null | undefined {
  let config: Record<string, unknown>;
  try {
    config = readObject(judgeConfigPath(agentDir));
  } catch {
    return undefined;
  }
  return typeof config.provider === "string" && typeof config.model === "string" ? `${config.provider}/${config.model}` : null;
}

/** Changes only these two settings. Throws, touching nothing, if the file is absent or broken. */
export function setJudgeModel(agentDir: string, ref: string | undefined): void {
  const target = realpathSync(judgeConfigPath(agentDir));
  const config = readObject(target);
  delete config.provider;
  delete config.model;
  if (ref !== undefined) {
    const { provider, id } = parseRef(ref);
    config.provider = provider;
    config.model = id;
  }
  const mode = statSync(target).mode & 0o777;
  const temp = `${target}.${process.pid}.tmp`;
  const file = openSync(temp, "w", mode);
  try {
    writeSync(file, `${JSON.stringify(config, null, 2)}\n`);
    fchmodSync(file, mode);
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  renameSync(temp, target);
}
