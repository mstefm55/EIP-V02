import test from "node:test";
import assert from "node:assert/strict";

import { advanceInstance } from "../src/core/core_process_engine.js";

function compactSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

function createClient() {
  const state = {
    projectionQueries: 0,
    serviceObjectPatch: null,
    processInstanceUpdated: false,
    queries: []
  };

  return {
    state,
    async query(sql, params = []) {
      const compact = compactSql(sql);
      state.queries.push({ compact, params });

      if (compact.includes("FROM eip_core.process_instance") && compact.includes("FOR UPDATE")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "pi-1",
              service_object_id: "so-1",
              process_def_id: "pd-1",
              status: "active",
              ended_at: null,
              cursor_json: { node: "START", history: [] }
            }
          ]
        };
      }

      if (compact.includes("FROM eip_core.process_def") && compact.includes("WHERE tenant_id=$1 AND id=$2")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "pd-1",
              attrs: {},
              graph: {
                initial_node: "START",
                nodes: {
                  START: {},
                  DONE: { terminal: true }
                },
                transitions: [
                  { from: "START", action: "plan", to: "DONE", macro_code: "PLAN" }
                ],
                macros: {
                  PLAN: {
                    reasoning: [
                      {
                        as: "planned_quantity",
                        expression: {
                          op: "MULTIPLY",
                          args: [{ ref: "$parent.attrs.quantity" }, 2]
                        }
                      }
                    ],
                    effects: [
                      {
                        type: "SO_UPDATE",
                        attrs: { planned_quantity: "$calc.planned_quantity" }
                      }
                    ]
                  }
                }
              }
            }
          ]
        };
      }

      if (
        compact.includes("FROM eip_core.service_object") &&
        compact.includes("FOR UPDATE") &&
        !compact.includes("attrs #>")
      ) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "so-1",
              object_type: "ORDER",
              status: "new",
              owner_agent_id: null
            }
          ]
        };
      }

      if (compact.includes("FROM eip_auth.auth_identity_agent")) {
        return { rowCount: 0, rows: [] };
      }

      if (compact.includes("attrs #>") && compact.includes("FROM eip_core.service_object")) {
        state.projectionQueries += 1;
        return {
          rowCount: 1,
          rows: [{ present_0: true, value_0: 100 }]
        };
      }

      if (compact.includes("FROM eip_core.dropdown_list dl") && compact.includes("JOIN eip_core.dropdown_value dv")) {
        return {
          rowCount: 1,
          rows: [{ code: "SO_UPDATE", is_active: true, attrs: {} }]
        };
      }

      if (compact.startsWith("UPDATE eip_core.service_object SET title")) {
        state.serviceObjectPatch = JSON.parse(params[3]);
        return { rowCount: 1, rows: [] };
      }

      if (compact.startsWith("UPDATE eip_core.process_instance SET cursor_json")) {
        state.processInstanceUpdated = true;
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`UNEXPECTED_TEST_QUERY:${compact}`);
    }
  };
}

test("Process Engine executes bounded Macro reasoning and Effects consume $calc without persisting raw calc", async () => {
  const client = createClient();

  const result = await advanceInstance(client, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    instanceId: "pi-1",
    action: "plan",
    payload: {},
    idempotencyKey: "idem-1"
  });

  assert.equal(result.ok, true);
  assert.equal(client.state.projectionQueries, 1);
  assert.deepEqual(client.state.serviceObjectPatch, { planned_quantity: 200 });
  assert.equal(client.state.processInstanceUpdated, true);

  assert.equal(result.entry.calculation.parent_attr_paths[0], "quantity");
  assert.equal(result.entry.calculation.projection_queries, 1);
  assert.equal(typeof result.entry.calculation.calc_digest, "string");
  assert.equal(result.entry.calculation.calc_digest.length, 64);
  assert.equal(Array.isArray(result.entry.calculation.audit), true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.entry.calculation, "calc"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.entry, "calc"), false);
  assert.equal(result.entry.effects_applied[0].type, "SO_UPDATE");
});
