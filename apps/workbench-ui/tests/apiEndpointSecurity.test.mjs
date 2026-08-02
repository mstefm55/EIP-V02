import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  ApiEndpointValidationError,
  normalizeEipContractPath,
  normalizeInternalApiPath,
} from "../src/services/apiEndpointSecurity.js";
import { apiFetchWithMeta, buildUrl } from "../src/services/apiClient.js";
import { resolveContract } from "../src/engine/contracts.js";

function assertRejected(value, normalizer = normalizeEipContractPath) {
  assert.throws(() => normalizer(value), ApiEndpointValidationError);
}

afterEach(() => {
  delete globalThis.fetch;
  delete globalThis.document;
});

describe("API endpoint security boundary", () => {
  it("accepts normalized EIP API paths", () => {
    assert.equal(normalizeEipContractPath("/api/eip/auth/whoami"), "/api/eip/auth/whoami");
    assert.equal(
      normalizeEipContractPath("/api/eip/core/process-definitions?limit=10&status=active"),
      "/api/eip/core/process-definitions?limit=10&status=active"
    );
  });

  it("accepts existing internal public API paths only through the API client boundary", () => {
    assert.equal(normalizeInternalApiPath("/api/public/tenant-requests"), "/api/public/tenant-requests");
    assert.equal(buildUrl("/api/public/tenant-requests"), "/api/public/tenant-requests");
    assertRejected("/api/public/tenant-requests");
  });

  it("rejects absolute and protocol-relative endpoints", () => {
    assertRejected("http://evil.example/api/eip/auth/whoami");
    assertRejected("https://evil.example/api/eip/auth/whoami");
    assertRejected("//evil.example/api/eip/auth/whoami");
  });

  it("rejects non-EIP metadata contract paths", () => {
    assertRejected("/api/public/tenant-requests");
    assertRejected("/api/edi/orders");
    assertRejected("/not-api/eip/auth/whoami");
  });

  it("rejects whitespace, scheme, encoded host, and backslash tricks", () => {
    assertRejected(" https://evil.example/api/eip/auth/whoami");
    assertRejected("\thttps://evil.example/api/eip/auth/whoami");
    assertRejected("\nhttps://evil.example/api/eip/auth/whoami");
    assertRejected("https://evil.example/api/eip/auth/whoami ");
    assertRejected("%68%74%74%70%3A%2F%2Fevil.example/api/eip/auth/whoami");
    assertRejected("%2F%2Fevil.example/api/eip/auth/whoami");
    assertRejected("/api/eip/\\evil");
    assertRejected("/api/eip/%5Cevil");
  });

  it("rejects malformed and non-normalized paths", () => {
    assertRejected("/api/eip/../public/tenant-requests");
    assertRejected("/api/eip/%2e%2e/public/tenant-requests");
    assertRejected("/api/eip/%252e%252e/public/tenant-requests");
    assertRejected("/api/eip/auth/whoami#fragment");
  });

  it("rejects adversarial path and value edge cases", () => {
    const rejected = [
      "/api/eip",
      "/api/eip-valid",
      "/API/EIP/test",
      "/api/eip/%252e%252e/public/login",
      "/api/eip/%2F%2Fevil.example",
      "/api/eip/%5C%5Cevil.example",
      null,
      42,
      {},
      [],
      "",
      "   ",
    ];

    assert.equal(normalizeEipContractPath("/api/eip/"), "/api/eip/");
    for (const value of rejected) {
      assertRejected(value);
    }
  });

  it("validates governed contract endpoints before they reach fetch", () => {
    const resolved = resolveContract(
      {
        endpoint: "/api/eip/core/process-definitions/:id",
        method: "GET",
        query: { include: "graph" },
      },
      { selection: { definition: { id: "abc 123" } } }
    );

    assert.equal(resolved.endpoint, "/api/eip/core/process-definitions/abc%20123");
    assert.equal(resolved.pathWithQuery, "/api/eip/core/process-definitions/abc%20123?include=graph");
    assert.throws(
      () => resolveContract({ endpoint: "https://evil.example/api/eip/core/process-definitions" }, {}),
      ApiEndpointValidationError
    );
  });

  it("does not fetch or read CSRF cookies after validation fails", async () => {
    let fetchCalls = 0;
    let cookieRead = false;

    globalThis.fetch = async () => {
      fetchCalls += 1;
      return { ok: true, status: 200, headers: new Map(), text: async () => "{}" };
    };
    globalThis.document = {};
    Object.defineProperty(globalThis.document, "cookie", {
      configurable: true,
      get() {
        cookieRead = true;
        throw new Error("cookie should not be read");
      },
    });

    await assert.rejects(
      () => apiFetchWithMeta("https://evil.example/api/eip/auth/logout", { method: "POST", body: {} }),
      ApiEndpointValidationError
    );
    assert.equal(fetchCalls, 0);
    assert.equal(cookieRead, false);
  });

  it("does not fetch or read CSRF cookies for every rejected adversarial value", async () => {
    const rejected = [
      " https://evil.example",
      "\thttps://evil.example",
      "\nhttps://evil.example",
      "//evil.example/path",
      "\\\\evil.example\\path",
      "/\\evil.example/path",
      "/api/eip/../public/login",
      "/api/eip/%2e%2e/public/login",
      "/api/eip/%252e%252e/public/login",
      "/api/eip/%2F%2Fevil.example",
      "/api/eip/%5C%5Cevil.example",
      "/api/eip/test#https://evil.example",
      "javascript:alert(1)",
      "%68%74%74%70%73://evil.example",
      "/api/eip",
      "/api/eip-valid",
      "/API/EIP/test",
      null,
      42,
      {},
      [],
      "",
      "   ",
    ];

    for (const value of rejected) {
      let fetchCalls = 0;
      let cookieRead = false;

      globalThis.fetch = async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, headers: new Map(), text: async () => "{}" };
      };
      globalThis.document = {};
      Object.defineProperty(globalThis.document, "cookie", {
        configurable: true,
        get() {
          cookieRead = true;
          throw new Error("cookie should not be read");
        },
      });

      await assert.rejects(
        () => apiFetchWithMeta(value, { method: "POST", body: {} }),
        ApiEndpointValidationError
      );
      assert.equal(fetchCalls, 0, `fetch called for ${JSON.stringify(value)}`);
      assert.equal(cookieRead, false, `csrf cookie read for ${JSON.stringify(value)}`);
    }
  });

  it("preserves credentials and CSRF behaviour for existing valid EIP requests", async () => {
    let observedUrl = "";
    let observedOptions = null;

    globalThis.document = { cookie: "csrf=abc123" };
    globalThis.fetch = async (url, options) => {
      observedUrl = url;
      observedOptions = options;
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ ok: true }),
      };
    };

    const result = await apiFetchWithMeta("/api/eip/auth/logout", { method: "POST", body: { reason: "test" } });

    assert.deepEqual(result.data, { ok: true });
    assert.equal(observedUrl, "/api/eip/auth/logout");
    assert.equal(observedOptions.credentials, "include");
    assert.equal(observedOptions.headers["x-csrf"], "abc123");
    assert.equal(observedOptions.headers["Content-Type"], "application/json");
  });
});
