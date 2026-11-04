import assert from "node:assert/strict";

import test from "node:test";
import { fetchPublic, isPublicAddress, publicLookup } from "../src/net.ts";

test("private addresses are told apart from public ones", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "64:ff9b::7f00:1", "64:ff9b:1::1", "2001::1", "fec0::1", "2002:7f00:1::"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
});

test("a name that resolves to a private address is refused when connecting", async () => {
  const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => publicLookup("localhost", { all: true }, (e) => resolve(e)));
  assert.equal(err?.code, "EPRIVATE");
  await assert.rejects(fetchPublic(new URL("https://localhost/")), /private address/);
});
