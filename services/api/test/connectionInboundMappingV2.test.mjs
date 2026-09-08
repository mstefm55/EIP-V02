import assert from "node:assert/strict";
import test from "node:test";

import {
  projectInboundServiceObject,
  validateInboundMappingConfig,
} from "../src/services/connections/connectionInboundMapping.js";

function mappedProfile(mapping) {
  return {
    identity: { direction: "inbound" },
    routing: {
      mapping_mode: "mapped",
      mapping,
    },
  };
}

test("mapped inbound projection keeps process selection out of the connection profile", () => {
  const profile = mappedProfile({
    service_object: {
      object_type: "ORDER",
      code: "$body.order.id",
      title: "$body.order.reference",
      attrs: {
        external_id: "$body.order.id",
        quantity: "$body.order.quantity",
        source: "partner_api",
      },
    },
  });

  assert.deepEqual(validateInboundMappingConfig(profile), []);
  const projection = projectInboundServiceObject(
    profile,
    Buffer.from(JSON.stringify({
      order: { id: "ORD-100", reference: "Web order 100", quantity: 5 },
      ignored: { secret: "not-projected" },
    }))
  );

  assert.deepEqual(projection, {
    service_object: {
      object_type: "ORDER",
      code: "ORD-100",
      title: "Web order 100",
      attrs: {
        external_id: "ORD-100",
        quantity: 5,
        source: "partner_api",
      },
    },
    task_type: null,
  });
  assert.equal(JSON.stringify(projection).includes("not-projected"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(profile.routing.mapping, "process_def_id"), false);
});

test("external payload cannot choose object type status or binding task type", () => {
  for (const mapping of [
    { service_object: { object_type: "$body.object_type" } },
    { service_object: { object_type: "ORDER", status: "$body.status" } },
    { service_object: { object_type: "ORDER" }, task_type: "$body.task_type" },
  ]) {
    const errors = validateInboundMappingConfig(mappedProfile(mapping));
    assert.ok(errors.length > 0);
  }
});

test("mapped source references fail closed when the requested payload path is missing", () => {
  const profile = mappedProfile({
    service_object: {
      object_type: "ORDER",
      attrs: { external_id: "$body.order.id" },
    },
  });

  assert.throws(
    () => projectInboundServiceObject(profile, Buffer.from('{"order":{}}')),
    (error) => error?.code === "CONNECTION_MAPPING_SOURCE_MISSING" && error?.status === 400
  );
});

test("mapping rejects arbitrary executable or unsupported authority fields", () => {
  const errors = validateInboundMappingConfig(mappedProfile({
    process_def_id: "11111111-1111-4111-8111-111111111111",
    service_object: {
      object_type: "ORDER",
      owner_agent_id: "$body.owner",
      attrs: { value: "$body.value" },
    },
  }));

  assert.ok(errors.some((error) => error.path === "routing.mapping.process_def_id"));
  assert.ok(errors.some((error) => error.path === "routing.mapping.service_object.owner_agent_id"));
});

test("passthrough mode remains transport-only and does not require mapped business metadata", () => {
  const profile = {
    identity: { direction: "inbound" },
    routing: { mapping_mode: "passthrough", mapping: {} },
  };
  assert.deepEqual(validateInboundMappingConfig(profile), []);
});
