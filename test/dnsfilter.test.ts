import assert from "node:assert/strict";
import test from "node:test";
import { answerIsBlocked, checkSite, clearDnsCache } from "../src/dnsfilter.ts";

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
