/** Settings live in the agent folder only: a project's own file could point searches at its author's server. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DnsFilter } from "./dnsfilter.ts";

export type SearchProvider = { name: "searxng"; url: string } | { name: "markdown.new" };

export type WebConfig = {
  /** Sending searches to a company is off unless this is true. */
  companySearch: boolean;
  searchProvider: SearchProvider | null;
  /** Why there's no search, for /web. */
  searchOff: string;
  readerModel: { provider: string; id: string } | null;
  allowDomains: string[];
  denyDomains: string[];
  dnsFilter: DnsFilter;
  /** Words a search must never hold, such as client or project names. */
  privateWords: string[];
  /** Ask before the first fetch from each site. */
  askNewDomains: boolean;
};

const DNS_FILTERS: DnsFilter[] = ["cloudflare-family", "cloudflare-security", "off"];

/** A wrong type is an error, not a default: an allow list that quietly became empty would allow everything. */
function strings(raw: Record<string, unknown>, key: string): string[] {
  const value = raw[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${key} in web.json must be a list of strings`);
  return value.map((item: string) => item.toLowerCase());
}

function flag(raw: Record<string, unknown>, key: string): boolean {
  const value = raw[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error(`${key} in web.json must be true or false`);
  return value;
}

export function parseConfig(raw: Record<string, unknown>): WebConfig {
  const companySearch = flag(raw, "companySearch");
  if (raw.provider !== undefined && typeof raw.provider !== "string") throw new Error("provider in web.json must be a name");
  const wanted = typeof raw.provider === "string" ? raw.provider : companySearch ? "markdown.new" : "searxng";
  if (raw.searxngUrl !== undefined && (typeof raw.searxngUrl !== "string" || !/^https?:\/\//.test(raw.searxngUrl))) throw new Error("searxngUrl in web.json must be an http or https URL");
  if (raw.dnsFilter !== undefined && !DNS_FILTERS.includes(raw.dnsFilter as DnsFilter)) throw new Error(`dnsFilter in web.json must be one of ${DNS_FILTERS.join(", ")}`);
  if (raw.readerModel !== undefined && (typeof raw.readerModel !== "string" || !raw.readerModel.includes("/"))) throw new Error("readerModel in web.json must be written provider/id");
  const url = typeof raw.searxngUrl === "string" ? raw.searxngUrl.replace(/\/+$/, "") : null;

  let searchProvider: SearchProvider | null = null;
  let searchOff = "";
  if (wanted === "searxng") {
    if (url) searchProvider = { name: "searxng", url };
    else searchOff = "set searxngUrl to your own SearXNG server";
  } else if (wanted === "markdown.new") {
    if (companySearch) searchProvider = { name: "markdown.new" };
    else searchOff = "markdown.new is a company's service, so it needs companySearch: true";
  } else {
    searchOff = `unknown provider ${wanted}`;
  }

  const [provider, ...id] = typeof raw.readerModel === "string" ? raw.readerModel.split("/") : [];
  return {
    companySearch,
    searchProvider,
    searchOff,
    readerModel: provider && id.length ? { provider, id: id.join("/") } : null,
    allowDomains: strings(raw, "allowDomains"),
    denyDomains: strings(raw, "denyDomains"),
    dnsFilter: (raw.dnsFilter as DnsFilter | undefined) ?? "cloudflare-family",
    privateWords: strings(raw, "privateWords"),
    askNewDomains: flag(raw, "askNewDomains"),
  };
}

export function loadConfig(agentDir: string): WebConfig {
  const path = join(agentDir, "web.json");
  if (!existsSync(path)) return parseConfig({});
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${path} must hold a JSON object`);
  return parseConfig(raw as Record<string, unknown>);
}
