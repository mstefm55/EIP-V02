import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAllowedUrlShape,
  createPinnedLookup,
  isBlockedIp,
  joinBaseAndPath,
  resolveSafeOutboundUrl,
} from "../src/security/outboundHttpPolicy.js";

test("blocks localhost, embedded credentials and unsupported protocols", () => {
  assert.throws(
    () => assertAllowedUrlShape("http://localhost:8080/health"),
    (error) => error.code === "OUTBOUND_HOST_FORBIDDEN"
  );
  assert.throws(
    () => assertAllowedUrlShape("https://user:pass@example.com/"),
    (error) => error.code === "OUTBOUND_URL_CREDENTIALS_FORBIDDEN"
  );
  assert.throws(
    () => assertAllowedUrlShape("file:///etc/passwd"),
    (error) => error.code === "OUTBOUND_PROTOCOL_FORBIDDEN"
  );
});

test("blocks private, loopback, link-local and reserved IPv4 ranges", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
  ]) {
    assert.equal(isBlockedIp(address), true, address);
  }
  assert.equal(isBlockedIp("8.8.8.8"), false);
});

test("blocks local and private IPv6 ranges", () => {
  for (const address of ["::1", "::", "fc00::1", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1"]) {
    assert.equal(isBlockedIp(address), true, address);
  }
  assert.equal(isBlockedIp("2606:4700:4700::1111"), false);
});

test("DNS resolution fails closed if any resolved address is forbidden", async () => {
  await assert.rejects(
    () => resolveSafeOutboundUrl("https://example.com/health", {
      lookupFn: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    }),
    (error) => error.code === "OUTBOUND_ADDRESS_FORBIDDEN"
  );
});

test("safe resolution returns a pinned public address set", async () => {
  const result = await resolveSafeOutboundUrl("https://example.com/health", {
    lookupFn: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ],
  });
  assert.equal(result.url.hostname, "example.com");
  assert.equal(result.addresses.length, 2);
});

test("pinned lookup never performs a second DNS resolution", async () => {
  const lookup = createPinnedLookup([{ address: "93.184.216.34", family: 4 }]);
  const resolved = await new Promise((resolve, reject) => {
    lookup("attacker.example", { family: 4 }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(resolved, { address: "93.184.216.34", family: 4 });
});

test("health path is constrained to configured base URL", () => {
  assert.equal(
    joinBaseAndPath("https://api.example.com/v1", "/health"),
    "https://api.example.com/health"
  );
  assert.throws(
    () => joinBaseAndPath("https://api.example.com", "https://evil.example.com"),
    (error) => error.code === "OUTBOUND_HEALTH_PATH_INVALID"
  );
});
