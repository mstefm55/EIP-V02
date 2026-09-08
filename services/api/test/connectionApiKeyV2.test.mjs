import assert from "node:assert/strict";
import test from "node:test";

import { API_KEY_PREFIX, generateApiKeyValue } from "../src/services/connections/connectionApiKey.js";

test("generated connection API keys are random bounded one-time values", () => {
  const first = generateApiKeyValue();
  const second = generateApiKeyValue();

  assert.equal(first.startsWith(API_KEY_PREFIX), true);
  assert.equal(second.startsWith(API_KEY_PREFIX), true);
  assert.notEqual(first, second);
  assert.match(first, /^eip_[A-Za-z0-9_-]{40,60}$/);
  assert.match(second, /^eip_[A-Za-z0-9_-]{40,60}$/);
});
