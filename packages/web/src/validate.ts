/** Checks on what the model asks for, before anything leaves this machine. */
import { isIP } from "node:net";
import { isPublicAddress } from "./net.ts";
import { hasSecret } from "./secrets.ts";

const MAX_QUERY = 400;
const MAX_QUESTION = 2000;
const MAX_URL = 2048;
const INTERNAL_SUFFIXES = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".test", ".invalid", ".onion"];
// How data gets packed into a search: file contents, keys, encoded blobs, even when split up.
const ENCODED_RUN = /[A-Za-z0-9+/_=-]{20,}/g;
const MAX_ENCODED_CHARS = 39;
const MIXED_TOKEN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)\S{6,}$/;
const MAX_MIXED_TOKENS = 2;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const LOCAL_PATH = /\/Users\/|\/home\/|\/root\/|~\/|\.ssh\b|\.env\b|\b[A-Za-z]:\\/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export function checkQuery(query: string, privateWords: string[] = []): string {
  const out = query.trim();
  if (!out) throw new Error("The query is empty");
  if (out.length > MAX_QUERY) throw new Error(`A query can be ${MAX_QUERY} characters at most, so write it as a few words`);
  if (CONTROL.test(out)) throw new Error("A query can't hold control characters or line breaks");
  if (hasSecret(out) || hasSecret(out.replace(/[\s.]+/g, ""))) throw new Error("This query looks like it holds a secret, and it would leave this machine");
  const encoded = (out.match(ENCODED_RUN) ?? []).join("").length;
  const mixed = out.split(/[\s.,;:]+/).filter((token) => MIXED_TOKEN.test(token)).length;
  if (encoded > MAX_ENCODED_CHARS || mixed > MAX_MIXED_TOKENS) throw new Error("This query holds encoded text. Search in words, as data shouldn't leave in a query");
  if (LOCAL_PATH.test(out)) throw new Error("This query holds a path on this machine, and it would leave this machine");
  if (EMAIL.test(out)) throw new Error("This query holds an email address, and it would leave this machine");
  const lower = out.toLowerCase();
  if (privateWords.some((word) => word && lower.includes(word))) throw new Error("This query holds a word set as private in /suite, and it would leave this machine");
  return out;
}

export function checkQuestion(question: string): string {
  const out = question.trim();
  if (!out) throw new Error("Say what to find out from the page");
  if (out.length > MAX_QUESTION) throw new Error(`A question can be ${MAX_QUESTION} characters at most`);
  return out;
}


export function checkUrl(raw: string, rules: { allowDomains: string[]; denyDomains: string[] }): URL {
  const text = raw.trim();
  if (text.length > MAX_URL) throw new Error(`A URL can be ${MAX_URL} characters at most`);
  if (CONTROL.test(text)) throw new Error("A URL can't hold control characters");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("That isn't a full URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https URLs can be fetched");
  url.protocol = "https:";
  if (url.username || url.password) throw new Error("A URL can't hold a username or password");
  if (url.port && url.port !== "443" && url.port !== "80") throw new Error("Only the standard web ports can be fetched");
  url.port = "";
  if (hasSecret(url.href)) throw new Error("This URL looks like it holds a secret, and it would leave this machine");

  const host = url.hostname.toLowerCase();
  // The same site written another way would get past the lists.
  if (host.endsWith(".")) throw new Error("A hostname can't end in a dot");
  const bracketless = host.replace(/^\[|\]$/g, "");
  if (isIP(bracketless)) {
    if (!isPublicAddress(bracketless)) throw new Error("Private and local addresses can't be fetched");
  } else if (!host.includes(".") || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new Error("Local and internal hostnames can't be fetched");
  }
  if (rules.denyDomains.some((domain) => onSite(host, domain))) throw new Error(`${host} is on the deny list`);
  if (rules.allowDomains.length && !rules.allowDomains.some((domain) => onSite(host, domain))) {
    throw new Error(`${host} isn't on the allow list`);
  }
  return url;
}

const MENTIONED = /(?<![\w@/.-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?][^\s<>"'`)\]]*)?/gi;

function normal(raw: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    url.protocol = "https:";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

type Entry = { type?: string; message?: { role?: string; content?: unknown; toolName?: string; isError?: boolean; details?: unknown } };

function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as { type?: string; text?: string }[]).map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("\n");
}

/**
 * The URLs the agent may fetch: those the user wrote, and those our own tools handed out after checking them.
 * Not other tool output: any tool that echoes text would let the agent approve a URL it wrote, with data in it.
 */
export function offeredUrls(entries: readonly Entry[]): Set<string> {
  const urls = new Set<string>();
  const add = (raw: string) => {
    const url = normal(raw.replace(/[.,;:!?]+$/, ""));
    if (url) urls.add(url);
  };
  for (const entry of entries) {
    const message = entry.message;
    if (entry.type !== "message" || !message) continue;
    if (message.role === "user") {
      for (const match of userText(message.content).matchAll(MENTIONED)) add(match[0]);
    } else if (message.role === "toolResult" && !message.isError && (message.toolName === "web_fetch" || message.toolName === "web_search")) {
      const links = (message.details as { links?: unknown } | undefined)?.links;
      if (Array.isArray(links)) for (const link of links) if (typeof link === "string") add(link);
    }
  }
  return urls;
}

/** An exact match, with case kept: anything looser would let the agent signal data through which variant it picks. */
export function wasOffered(url: URL, entries: readonly Entry[]): boolean {
  const wanted = normal(url.href);
  return wanted !== null && offeredUrls(entries).has(wanted);
}

const MAX_UNGIVEN_PATH = 200;
const MAX_UNGIVEN_HOST = 80;
const MAX_UNGIVEN_SEGMENTS = 12;
const MAX_HOST_LABEL = 30;
const LONG_TOKEN = 24;
const LONG_NUMBER = 16;
const MAX_ENCODED_LOOKING_CHARS = 24;
const NON_ASCII = /[^\u0000-\u007f]/;

/**
 * Why a URL nobody gave the agent looks like it holds data, or null if it reads like an ordinary page.
 * This can't be airtight, as data can be made to look like anything. What really limits a leak is that a new site needs a person: see approveUrl.
 */
export function urlConcern(url: URL, privateWords: string[] = []): string | null {
  if (url.search) return "has a query string, which could carry data";
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return "has broken encoding";
  }
  if (NON_ASCII.test(path) || url.hostname.includes("xn--")) return "holds characters that can pack in a lot of data";
  // The name counts too: just looking up <data>.evil.com sends the data to whoever runs evil.com.
  if (path.length > MAX_UNGIVEN_PATH || url.hostname.length > MAX_UNGIVEN_HOST) return "is unusually long";
  if (path.split("/").length > MAX_UNGIVEN_SEGMENTS) return "has an unusual number of parts";
  if (url.hostname.split(".").some((label) => label.length > MAX_HOST_LABEL)) return "has an unusually long hostname";
  const tokens = `${url.hostname}/${path}`.split(/[/\-_.~+=,:;@\s]+/).filter(Boolean);
  if (tokens.some((token) => token.length >= LONG_TOKEN || (/^\d+$/.test(token) && token.length >= LONG_NUMBER))) return "holds a long encoded-looking string";
  const encodedLooking = tokens.filter((token) => /\d/.test(token) && /[a-zA-Z]/.test(token) && token.length >= 6).join("").length;
  if (encodedLooking > MAX_ENCODED_LOOKING_CHARS) return "holds encoded-looking text";
  const lowerPath = path.toLowerCase();
  if (new RegExp(LOCAL_PATH.source, "i").test(path) || EMAIL.test(path)) return "holds a local path or email address";
  const lower = `${url.hostname}${lowerPath}`;
  if (privateWords.some((word) => word && lower.includes(word))) return "holds a word set as private in /suite";
  return null;
}

/**
 * The sites the agent can write its own addresses on: those you named, and those a search returned.
 * Not sites linked from a page, or a poisoned page could vouch for wherever it wants data sent.
 */
export function givenSites(entries: readonly Entry[]): Set<string> {
  const sites = new Set<string>();
  for (const entry of entries) {
    const message = entry.message;
    if (entry.type !== "message" || !message) continue;
    if (message.role === "user") {
      for (const match of userText(message.content).matchAll(MENTIONED)) {
        const url = normal(match[0].replace(/[.,;:!?]+$/, ""));
        if (url) sites.add(new URL(url).hostname);
      }
    } else if (message.role === "toolResult" && !message.isError && message.toolName === "web_search") {
      const given = (message.details as { sites?: unknown } | undefined)?.sites;
      if (Array.isArray(given)) for (const site of given) if (typeof site === "string") sites.add(site);
    }
  }
  return sites;
}

export const onSite = (host: string, site: string): boolean => host === site || host.endsWith(`.${site}`);
