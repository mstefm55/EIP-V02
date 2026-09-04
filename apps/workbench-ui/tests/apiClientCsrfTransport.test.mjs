import test from "node:test";
import assert from "node:assert/strict";

import {
  apiFetch,
  resetCsrfToken,
} from "../src/services/apiClient.js";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("mutating requests obtain CSRF through the API-origin transport endpoint", async () => {
  resetCsrfToken();
  globalThis.document = { cookie: "" };
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/api/eip/auth/csrf")) {
      return jsonResponse(200, { ok: true, csrf: "csrf-from-api" });
    }
    return jsonResponse(200, { ok: true });
  };

  try {
    const result = await apiFetch("/api/eip/core/example", {
      method: "POST",
      body: { value: 1 },
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/api\/eip\/auth\/csrf$/);
    assert.equal(calls[0].options.credentials, "include");
    assert.match(calls[1].url, /\/api\/eip\/core\/example$/);
    assert.equal(calls[1].options.headers["x-csrf"], "csrf-from-api");
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.document;
    resetCsrfToken();
  }
});

test("CSRF mismatch refreshes once and retries the original request", async () => {
  resetCsrfToken();
  globalThis.document = { cookie: "" };
  const calls = [];
  const originalFetch = globalThis.fetch;
  let csrfFetches = 0;
  let protectedFetches = 0;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/api/eip/auth/csrf")) {
      csrfFetches += 1;
      return jsonResponse(200, { ok: true, csrf: csrfFetches === 1 ? "old-token" : "new-token" });
    }
    protectedFetches += 1;
    if (protectedFetches === 1) {
      return jsonResponse(403, { ok: false, error: "CSRF_INVALID" });
    }
    return jsonResponse(200, { ok: true, retried: true });
  };

  try {
    const result = await apiFetch("/api/eip/core/example", {
      method: "POST",
      body: { value: 1 },
    });
    assert.deepEqual(result, { ok: true, retried: true });
    assert.equal(csrfFetches, 2);
    assert.equal(protectedFetches, 2);
    const protectedCalls = calls.filter((call) => call.url.endsWith("/api/eip/core/example"));
    assert.equal(protectedCalls[0].options.headers["x-csrf"], "old-token");
    assert.equal(protectedCalls[1].options.headers["x-csrf"], "new-token");
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.document;
    resetCsrfToken();
  }
});
