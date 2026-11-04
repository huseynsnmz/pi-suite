/** Fetches public web pages, and refuses to be pointed at this machine or its network. */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { BlockList, type LookupFunction } from "node:net";
import { gunzipSync } from "node:zlib";

const MAX_BYTES = 5_000_000;
const DEADLINE_MS = 30_000;
const MAX_REDIRECTS = 5;

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) PRIVATE.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 96], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) PRIVATE.addSubnet(net, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  return !PRIVATE.check(address, address.includes(":") ? "ipv6" : "ipv4");
}

/** Checks the addresses the connection will really use, so a name can't resolve one way for a check and another for the request. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    if (!addresses.length || !addresses.every((entry) => isPublicAddress(entry.address))) {
      return callback(Object.assign(new Error(`${hostname} points to a private address`), { code: "EPRIVATE" }), "", 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

type Response = { status: number; location: string | null; contentType: string; encoding: string; body: Buffer };

function once(url: URL, signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        lookup: publicLookup,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(DEADLINE_MS)]) : AbortSignal.timeout(DEADLINE_MS),
        headers: {
          "user-agent": "pi-web/0.1",
          accept: "text/markdown, text/html;q=0.9, text/plain;q=0.8, application/json;q=0.7, */*;q=0.1",
          "accept-encoding": "gzip",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) return req.destroy(new Error(`The page is over ${MAX_BYTES / 1_000_000} MB`));
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            contentType: String(res.headers["content-type"] ?? ""),
            encoding: String(res.headers["content-encoding"] ?? ""),
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

export type Fetched =
  | { kind: "page"; url: string; contentType: string; body: Buffer }
  | { kind: "moved"; url: string; target: string };

/** Follows redirects on the same host. Another host gets reported, so it passes the same checks as any other URL. */
export async function fetchPublic(start: URL, signal?: AbortSignal): Promise<Fetched> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await once(url, signal);
    if (res.status >= 300 && res.status < 400 && res.location) {
      // Nothing from a server's headers goes in an error: errors reach the agent without passing the reader.
      let target: URL;
      try {
        target = new URL(res.location, url);
      } catch {
        throw new Error("It redirects to an address that isn't valid");
      }
      if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("It redirects to an unsupported kind of address");
      target.hash = "";
      target.protocol = "https:";
      if (target.host !== url.host) return { kind: "moved", url: url.href, target: target.href };
      url = target;
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`The server answered ${res.status}`);
    let body = res.body;
    if (res.encoding === "gzip") body = gunzipSync(body, { maxOutputLength: MAX_BYTES });
    else if (res.encoding && res.encoding !== "identity") throw new Error("The server sent an encoding this can't read");
    return { kind: "page", url: url.href, contentType: res.contentType, body };
  }
  throw new Error("Too many redirects");
}
