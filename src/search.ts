/** Search backends. Each returns web text for the reader, and links that have been checked. */
import type { SearchProvider } from "./config.ts";
import { clean } from "./sanitize.ts";

const DEADLINE_MS = 45_000;
const MAX_RESPONSE_CHARS = 2_000_000;
const MAX_LINKS = 10;

export type SearchResults = { text: string; links: string[] };

async function json(res: Response, name: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(res.status === 429 ? `${name} is rate limiting this machine` : `${name} answered ${res.status}`);
  const body = await res.text();
  if (body.length > MAX_RESPONSE_CHARS) throw new Error(`${name} sent too much back`);
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error(`${name} didn't answer in JSON. A SearXNG server needs json under search.formats in its settings`);
  }
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : []);

function publicLinks(urls: string[]): string[] {
  const out = new Set<string>();
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      url.hash = "";
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && raw.length <= 2048) out.add(clean(url.href));
    } catch {
      /* Not a link, so the agent doesn't get it. */
    }
  }
  return [...out].slice(0, MAX_LINKS);
}

export function parseSearxng(data: Record<string, unknown>): SearchResults {
  const results = list(data.results).slice(0, MAX_LINKS);
  return {
    text: results.map((r) => `${str(r.title)}\n${str(r.url)}\n${str(r.content)}`).join("\n\n"),
    links: publicLinks(results.map((r) => str(r.url))),
  };
}

export function parseMarkdownNew(data: Record<string, unknown>): SearchResults {
  const results = list(data.results).slice(0, MAX_LINKS);
  const pages = list(data.extracted);
  return {
    text: [
      ...results.map((r) => `${str(r.title)}\n${str(r.link)}\n${str(r.snippet)}`),
      ...pages.map((p) => `Full page: ${str(p.url)}\n${str(p.markdown)}`),
    ].join("\n\n"),
    links: publicLinks(results.map((r) => str(r.link))),
  };
}

export async function search(provider: SearchProvider, query: string, signal?: AbortSignal): Promise<SearchResults> {
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  const merged = signal ? AbortSignal.any([signal, deadline]) : deadline;
  if (provider.name === "searxng") {
    const url = new URL(`${provider.url}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    return parseSearxng(await json(await fetch(url, { signal: merged, redirect: "error", headers: { accept: "application/json" } }), "SearXNG"));
  }
  const res = await fetch("https://markdown.new/search", {
    method: "POST",
    signal: merged,
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: query, n: 3, format: "json" }),
  });
  return parseMarkdownNew(await json(res, "markdown.new"));
}
