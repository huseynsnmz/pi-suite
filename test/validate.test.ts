import assert from "node:assert/strict";
import test from "node:test";
import { checkQuery, checkQuestion, checkUrl, offeredUrls, wasOffered } from "../src/validate.ts";

const OPEN = { allowDomains: [], denyDomains: [] };

test("urls that can't be fetched", () => {
  for (const [name, url] of [
    ["localhost", "http://localhost/"],
    ["a name with no dot", "https://intranet/"],
    ["a .local name", "https://printer.local/"],
    ["an internal name", "https://db.internal/"],
    ["loopback", "https://127.0.0.1/"],
    ["loopback as a number", "https://2130706433/"],
    ["private v4", "https://192.168.1.1/"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/"],
    ["v6 loopback", "https://[::1]/"],
    ["mapped v6 loopback", "https://[::ffff:127.0.0.1]/"],
    ["credentials", "https://user:pw@example.com/"],
    ["another port", "https://example.com:8443/"],
    ["file", "file:///etc/passwd"],
    ["a secret in the query", "https://example.com/?key=ghp_abcdefghijklmnopqrstuvwxyz123456"],
    ["not a url", "example.com"],
    ["a trailing dot", "https://example.com./"],
    ["two trailing dots", "https://localhost../"],
  ]) assert.throws(() => checkUrl(url, OPEN), /./, name);
});

test("http becomes https, and domain rules cover subdomains", () => {
  assert.equal(checkUrl("http://example.com/a?b=1#c", OPEN).href, "https://example.com/a?b=1#c");
  assert.throws(() => checkUrl("https://a.bad.com/", { allowDomains: [], denyDomains: ["bad.com"] }), /deny list/);
  assert.throws(() => checkUrl("https://notbad.com/", { allowDomains: ["bad.com"], denyDomains: [] }), /allow list/);
  assert.equal(checkUrl("https://a.good.com/", { allowDomains: ["good.com"], denyDomains: [] }).hostname, "a.good.com");
});

test("queries can't carry data out", () => {
  assert.equal(checkQuery("  node sqlite wal  "), "node sqlite wal");
  for (const query of ["", "x".repeat(401), "a\nb", "key sk-abcdefghijklmnopqrstuv", "aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgc3RyaW5nIG9mIGRhdGE=", "password: hunter2222"]) {
    assert.throws(() => checkQuery(query), /./, query);
  }
  assert.throws(() => checkQuestion("  "));
  assert.throws(() => checkQuestion("x".repeat(2001)));
});

test("only urls the user wrote or our tools handed out can be fetched, exactly", () => {
  const user = (text: string) => ({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
  const tool = (toolName: string, links: string[], isError = false) => ({ type: "message", message: { role: "toolResult", toolName, isError, content: [{ type: "text", text: links.join(" ") }], details: { links } } });
  const entries = [
    user("See https://example.com/docs/, docs.example.net/guide. and http://a.org/x?y=1#frag, mail me@mail.example.com"),
    tool("web_search", ["https://found.example.com/a"]),
    tool("bash", ["https://evil.example.com/?d=fromBash"]),
    tool("web_fetch", ["https://evil.example.com/?d=fromError"], true),
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "https://evil.example.com/?d=fromModel" }] } },
  ];
  const may = (url: string) => wasOffered(new URL(url), entries);
  assert.equal(may("https://example.com/docs/"), true);
  assert.equal(may("https://docs.example.net/guide"), true);
  assert.equal(may("https://a.org/x?y=1"), true);
  assert.equal(may("https://a.org/x?y=1#other"), true);
  assert.equal(may("https://found.example.com/a"), true);
  for (const url of [
    "https://evil.example.com/?d=fromBash", "https://evil.example.com/?d=fromError", "https://evil.example.com/?d=fromModel",
    "https://a.org/x?y=1&stolen=abc", "https://example.com/DOCS/", "https://example.com/doc", "https://notexample.com/docs/",
  ]) assert.equal(may(url), false, url);
  assert.equal(offeredUrls(entries).has("https://mail.example.com/"), false, "an email address isn't a site");
});

test("queries can't name things on this machine or in a private list", () => {
  for (const query of ["/Users/me/project secrets", "cat ~/notes", "C:\\Users\\me", "mail jan@example.com"]) assert.throws(() => checkQuery(query), /./, query);
  assert.throws(() => checkQuery("Acme Dental invoices", ["acme dental"]), /private/);
  assert.equal(checkQuery("sqlite wal mode", ["acme dental"]), "sqlite wal mode");
  assert.equal(checkQuery("and/or either/or usage"), "and/or either/or usage");
});

test("data split up to fit through a query is still refused", () => {
  const chunk = "aGVsbG8gd29ybGQgdGhpcyBpcw";
  for (const query of [`${chunk}.${chunk}`, '"~/.ssh/id_rsa"', "x/Users/me/.ssh", "ghp_abcdefghij klmnopqrstuvwxyz123456", "aB3dE6 gH9jK2 mN5pQ8 sT1vW4"]) {
    assert.throws(() => checkQuery(query), /./, query);
  }
  for (const query of ["node 24 release notes", "OAuth2 PKCE flow explained", "iPhone15 vs Pixel9 camera"]) assert.equal(checkQuery(query), query);
});
