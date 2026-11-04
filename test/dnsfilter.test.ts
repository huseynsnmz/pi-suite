import assert from "node:assert/strict";
import test from "node:test";
import { answerIsBlocked, blockedLinks, checkSite, clearDnsCache } from "../src/dnsfilter.ts";

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("blocked answers look like this, from Cloudflare's own test domains", () => {
  assert.equal(answerIsBlocked({ Answer: [{ data: "0.0.0.0" }], Comment: ["EDE(16): Censored"] }), true);
  assert.equal(answerIsBlocked({ Answer: [{ data: "0.0.0.0" }], Comment: ["EDE(17): Filtered"] }), true);
  assert.equal(answerIsBlocked({ Answer: [{ data: "::" }] }), true);
  assert.equal(answerIsBlocked({ Comment: "EDE(15): Blocked" }), true);
  assert.equal(answerIsBlocked({ Answer: [{ data: "104.20.23.154" }] }), false);
  assert.equal(answerIsBlocked({}), false);
});

test("a blocked site is refused, and a filter that's down refuses too", async () => {
  clearDnsCache();
  await assert.rejects(checkSite("bad.example.org", "cloudflare-family", undefined, reply({ Answer: [{ data: "0.0.0.0" }] })), /blocked by the site filter/);
  await assert.rejects(checkSite("a.example.org", "cloudflare-family", undefined, reply({}, 500)), /answered 500/);
  const down = (async () => { throw new Error("no network"); }) as unknown as typeof fetch;
  await assert.rejects(checkSite("b.example.org", "cloudflare-family", undefined, down), /couldn't be reached/);
});

test("a filter that couldn't really check refuses", async () => {
  clearDnsCache();
  await assert.rejects(checkSite("c.example.org", "cloudflare-family", undefined, reply({ Status: 2 })), /couldn't check/);
  await checkSite("nosuch.example.org", "cloudflare-family", undefined, reply({ Status: 3 }));
});

test("a clean site passes and is remembered, and off asks nobody", async () => {
  clearDnsCache();
  let calls = 0;
  const count = (async () => { calls++; return new Response(JSON.stringify({ Answer: [{ data: "1.1.1.1" }] })); }) as unknown as typeof fetch;
  await checkSite("ok.example.org", "cloudflare-family", undefined, count);
  await checkSite("ok.example.org", "cloudflare-family", undefined, count);
  assert.equal(calls, 2, "one question each for A and AAAA, and none the second time");
  await checkSite("other.example.org", "off", undefined, count);
  assert.equal(calls, 2);
});

test("links on blocked sites are picked out, and a filter that's down leaves them for the fetch to refuse", async () => {
  clearDnsCache();
  const answers = (async (url: URL) => new Response(JSON.stringify(url.searchParams.get("name") === "bad.example.org" ? { Answer: [{ data: "0.0.0.0" }] } : { Answer: [{ data: "1.1.1.1" }] }))) as unknown as typeof fetch;
  const links = ["https://bad.example.org/a", "https://bad.example.org/b", "https://good.example.org/", "https://93.184.216.34/x"];
  assert.deepEqual([...(await blockedLinks(links, "cloudflare-family", undefined, answers))], ["https://bad.example.org/a", "https://bad.example.org/b", "https://93.184.216.34/x"]);
  clearDnsCache();
  const down = (async () => { throw new Error("no network"); }) as unknown as typeof fetch;
  assert.equal((await blockedLinks(["https://down.example.org/"], "cloudflare-family", undefined, down)).size, 0);
  let asked = 0;
  await blockedLinks(links, "off", undefined, (async () => { asked++; return new Response("{}"); }) as unknown as typeof fetch);
  assert.equal(asked, 0);
});
