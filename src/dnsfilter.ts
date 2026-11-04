/** Asks a filtering DNS service whether a site is known for malware or adult content. Its list is its own, so this catches known sites only. */

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
  if (answers.some(answerIsBlocked)) throw new Error(`${host} is blocked by the site filter, as malware, phishing or adult content`);
  if (checked.size >= CACHE_ENTRIES) checked.delete(checked.keys().next().value as string);
  checked.set(key, Date.now());
}
