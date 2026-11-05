// What /suite can change in each part's section of suite.json. Each part still checks its own values when it loads.
import { parseConfig as parseWeb } from "../packages/web/src/config.ts";
import type { Part } from "./settings.ts";

export type Field =
  | { key: string; label: string; kind: "boolean" | "text" | "list" | "model" }
  | { key: string; label: string; kind: "choice"; options: readonly string[] }
  | { key: string; label: string; kind: "number"; min: number; max: number };

const MODES_ALLOWED = ["normal", "auto", "plan", "read-only"];
/** Yolo has to be asked for each time, so it can't be a default. */
export const FIELDS: Partial<Record<Part, readonly Field[]>> = {
  modes: [{ key: "defaultMode", label: "Mode for new sessions", kind: "choice", options: MODES_ALLOWED }],
  web: [
    { key: "companySearch", label: "Allow searching through a company's service", kind: "boolean" },
    { key: "provider", label: "Search with", kind: "choice", options: ["searxng", "markdown.new"] },
    { key: "searxngUrl", label: "Your SearXNG server", kind: "text" },
    { key: "readerModel", label: "Model that reads pages", kind: "model" },
    { key: "allowDomains", label: "Only fetch from these sites", kind: "list" },
    { key: "denyDomains", label: "Never fetch from these sites", kind: "list" },
    { key: "trustedDomains", label: "Sites it can write its own addresses on", kind: "list" },
    { key: "privateWords", label: "Words a search can never hold", kind: "list" },
    { key: "askNewDomains", label: "Ask before the first fetch from each site", kind: "boolean" },
    { key: "strictUrls", label: "Ask about every address nobody gave it", kind: "boolean" },
    { key: "minConfidence", label: "Withhold answers the reader scores below", kind: "number", min: 1, max: 10 },
    { key: "dnsFilter", label: "Block sites using a DNS filter", kind: "choice", options: ["cloudflare-family", "cloudflare-security", "off"] },
  ],
  subscription: [
    { key: "promptMode", label: "System prompt", kind: "choice", options: ["claude", "pi"] },
    { key: "pathToClaudeCodeExecutable", label: "Claude Code program", kind: "text" },
    { key: "maxSessions", label: "Claude Code processes to keep", kind: "number", min: 1, max: 16 },
    { key: "idleMinutes", label: "Close an idle process after, in minutes", kind: "number", min: 1, max: 1440 },
  ],
};

/** The value /suite shows when nothing's been chosen. */
const UNSET_WEB: Readonly<Record<string, string>> = { minConfidence: "4", dnsFilter: "cloudflare-family", provider: "automatic" };

export function shownValue(part: Part, field: Field, section: Record<string, unknown>): string {
  const value = section[field.key];
  if (value === undefined) return part === "web" ? (UNSET_WEB[field.key] ?? (field.kind === "boolean" ? "off" : "not set")) : field.kind === "boolean" ? "off" : "default";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.length === 0 ? "not set" : value.join(", ");
  return String(value);
}

/** What was typed, as the value to save. Undefined clears the setting. Throws if it can't be used. */
export function typedValue(field: Field, typed: string): unknown {
  const text = typed.trim();
  if (text === "") return undefined;
  if (field.kind === "list") return text.split(",").map((item) => item.trim()).filter(Boolean);
  if (field.kind === "number") {
    const number = Number(text);
    if (!Number.isInteger(number) || number < field.min || number > field.max) throw new Error(`${field.label} must be a whole number from ${field.min} to ${field.max}`);
    return number;
  }
  return text;
}

/** Throws rather than save what the part would refuse when it loads. */
export function checkSection(part: Part, section: Record<string, unknown>): void {
  if (part === "web") parseWeb(section);
}
