import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const migration = fs.readFileSync(
  path.resolve(repoRoot, "db/migrations/v2_0050_connection_inbound_idempotency_governance.sql"),
  "utf8"
);

function jsonPayloadText(source) {
  return Array.from(source.matchAll(/\$json\$\s*([\s\S]*?)\s*\$json\$/g))
    .map((match) => match[1])
    .join("\n");
}

const payload = jsonPayloadText(migration);

test("Reliability uses governed idempotency location and scope metadata", () => {
  assert.match(migration, /CONNECTION_EVENT_ID_LOCATION/);
  assert.match(migration, /CONNECTION_IDEMPOTENCY_SCOPE/);
  assert.match(payload, /taxonomy\.CONNECTION_EVENT_ID_LOCATION/);
  assert.match(payload, /taxonomy\.CONNECTION_IDEMPOTENCY_SCOPE/);
  assert.match(payload, /idempotency\.event_id_key/);
});

test("idempotency receipt reuses kernel info_record without creating a feature table", () => {
  assert.match(migration, /eip_core\.info_record/);
  assert.match(migration, /connection_inbound_receipt/);
  assert.match(migration, /info_record_connection_inbound_idempotency_uk/);
  assert.doesNotMatch(migration, /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:tenant\.)?connection_(?:receipt|event)/i);
});

test("idempotency surface metadata does not introduce browser tenant authority", () => {
  assert.doesNotMatch(payload, /"path"\s*:\s*"tenant_id"|"key"\s*:\s*"tenant_id"/i);
});
