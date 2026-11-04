/** Asks a filtering DNS service whether a site is known for malware or adult content. Its list is its own, so this catches known sites only. */

import { isIP } from "node:net";

export type DnsFilter = "cloudflare-family" | "cloudflare-security" | "off";

const SERVERS: Record<Exclude<DnsFilter, "off">, string> = {
  // Blocks malware and adult content, which is 1.1.1.3.
  "cloudflare-family": "https://family.cloudflare-dns.com/dns-query",
  // Blocks malware only, which is 1.1.1.2.
  "cloudflare-security": "https://security.cloudflare-dns.com/dns-query",
};

const DEADLINE_MS = 5000;
const CACHE_MS = 5 * 60_000;
const CACHE_ENTRIES = 500;
const BLOCKED_ADDRESS = new Set(["0.0.0.0", "::"]);
// Extended DNS Errors: Blocked, Censored and Filtered.
const BLOCKED_COMMENT = /EDE\((?:15|16|17)\)/;

type DnsAnswer = { Status?: number; Answer?: { data?: string }[]; Comment?: string[] | string };

export function answerIsBlocked(answer: DnsAnswer): boolean {
  if ((answer.Answer ?? []).some((record) => BLOCKED_ADDRESS.has(record.data ?? ""))) return true;
  return [answer.Comment ?? []].flat().some((comment) => BLOCKED_COMMENT.test(comment));
}

export class BlockedSiteError extends Error {}

const checked = new Map<string, number>();

export function clearDnsCache(): void {
  checked.clear();
}

/** Throws if the site is blocked, or if the filter can't answer: a filter that's down mustn't quietly let everything through. */
export async function checkSite(host: string, filter: DnsFilter, signal?: AbortSignal, get: typeof fetch = fetch): Promise<void> {
  if (filter === "off") return;
  const key = `${filter}:${host}`;
  const at = checked.get(key);
  if (at !== undefined && Date.now() - at < CACHE_MS) return;
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  const merged = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const answers = await Promise.all(
    ["A", "AAAA"].map(async (type) => {
      const url = new URL(SERVERS[filter]);
      url.searchParams.set("name", host);
      url.searchParams.set("type", type);
      let res: Response;
      try {
        res = await get(url, { signal: merged, redirect: "error", headers: { accept: "application/dns-json" } });
      } catch {
        throw new Error(`The site filter couldn't be reached, so ${host} wasn't fetched. Set dnsFilter to "off" to do without it`);
      }
      if (!res.ok) throw new Error(`The site filter answered ${res.status}, so ${host} wasn't fetched`);
      return (await res.json()) as DnsAnswer;
    }),
  );
  // 0 is an answer and 3 means no such name. Anything else means the filter didn't really check.
  if (answers.some((answer) => answer.Status !== undefined && answer.Status !== 0 && answer.Status !== 3)) {
    throw new Error(`The site filter couldn't check ${host}, so it wasn't fetched`);
  }
  if (answers.some(answerIsBlocked)) throw new BlockedSiteError(`${host} is blocked by the site filter, as malware, phishing or adult content`);
  if (checked.size >= CACHE_ENTRIES) checked.delete(checked.keys().next().value as string);
  checked.set(key, Date.now());
}

const hostOf = (link: string): string | null => {
  try {
    return new URL(link).hostname;
  } catch {
    return null;
  }
};

const MAX_HOSTS_CHECKED = 30;

/**
 * Which of these links are on sites the filter blocks, so the agent is never pointed at them. Bare IPs count, as there's no name to judge.
 * If the filter can't answer, a link stays: this list is a courtesy, and fetching it still fails closed.
 * Only for links from the web, as looking up a name the agent wrote could send data out through DNS.
 */
export async function blockedLinks(links: string[], filter: DnsFilter, signal?: AbortSignal, get: typeof fetch = fetch): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (filter === "off") return blocked;
  const hosts = [...new Set(links.map(hostOf).filter((host): host is string => host !== null))].slice(0, MAX_HOSTS_CHECKED);
  const results = await Promise.allSettled(hosts.map((host) => (isIP(host.replace(/^\[|\]$/g, "")) ? Promise.reject(new BlockedSiteError()) : checkSite(host, filter, signal, get))));
  const blockedHosts = new Set(hosts.filter((_host, index) => {
    const result = results[index];
    return result.status === "rejected" && result.reason instanceof BlockedSiteError;
  }));
  for (const link of links) {
    const host = hostOf(link);
    if (host !== null && blockedHosts.has(host)) blocked.add(link);
  }
  return blocked;
}
