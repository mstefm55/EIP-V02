# EIP Core V2 Connection Management UI Contract

Status: implementation guardrail for the V1 -> V2 Connections migration.

Read with:

- `docs/architecture/UI_ENGINE_OWNERSHIP.md`
- `docs/architecture/OPERATING_MODEL_CANON.md`
- `V1_V2_PARTITION.md`

## 1. Purpose

Migrate the useful capability of V1 Admin > Connections into a simpler, safer and more extensible V2 authoring flow without copying the V1 monolithic React implementation or its page-local business branching.

The target interaction is:

```text
Connection catalogue
        -> selected connection
        -> compact setup journey
        -> selected-step editor
        -> governed API contract
```

The left-side setup journey is presentation/navigation only. The selected step is transient UI selection state. Connection configuration, permissions, secret handling, validation, health and lifecycle authority remain server-side.

## 2. V2 ownership boundary

```text
UI metadata
  -> FlowStepNavigator
  -> generic selection target
  -> FlowStepPanel
  -> generic contract-backed editor
  -> governed API
  -> governed connection profile / secret boundary
```

React must not own:

- provider-specific security rules;
- allowed connection kinds;
- allowed auth/verification modes;
- production-vs-sandbox security policy;
- secret persistence;
- API-key lifecycle authority;
- connection health truth;
- tenant selection/authorization;
- routing/business workflow decisions.

Those values and rules must arrive through governed metadata and bounded server contracts.

## 3. Target UX

The default desktop surface should remain visually compact:

```text
Connections          Setup flow             Configuration

Connection A         Identity               [selected step editor]
Connection B         Endpoint
Connection C         Security
+ New connection     Reliability
                     Routing & Mapping
                     Test & Health
                     Audit
```

When the user selects a setup step, only the corresponding editor appears on the right. Advanced fields remain collapsed until explicitly requested. The UI should expose the smallest useful set of fields first while retaining the complete governed capability.

## 4. Canonical setup journey

The initial V2 presentation groups V1 capability into seven user-facing steps:

1. `identity`
   - connection name/code;
   - governed connection kind/purpose;
   - environment;
   - enabled state.

2. `endpoint`
   - governed direction;
   - inbound endpoint settings when applicable;
   - outbound base/path settings when applicable;
   - protocol/content-type settings exposed by the server profile.

3. `security`
   - governed inbound verification mode;
   - governed outbound auth mode;
   - secret/credential references and configured-state indicators;
   - origin/IP restrictions when exposed by the contract;
   - provider-specific requirements supplied by metadata/server validation, never hardcoded in the primitive.

4. `reliability`
   - idempotency settings;
   - rate limits;
   - timeout;
   - retry policy;
   - payload/body limits where exposed by the contract.

5. `routing`
   - channel/protocol;
   - supported message types;
   - schema version;
   - envelope profile;
   - mapping mode;
   - mapping definition through governed metadata/contracts.

6. `health`
   - connection test action;
   - last successful test;
   - health status;
   - provider availability;
   - bounded diagnostic summary.

7. `audit`
   - audit record type;
   - redaction policy;
   - log level;
   - governed evidence summary;
   - other bounded audit controls exposed by the server.

These step IDs are surface metadata, not React constants. The generic primitives must work with different step IDs and labels for unrelated modules.

## 5. V1 capability salvage map

Preserve capability intent from V1 while rewriting the presentation and ownership boundaries:

| V1 capability | V2 target | Rule |
| --- | --- | --- |
| Profile create/edit | Identity + step editors | Keep contract intent; do not copy V1 page-local model |
| Inbound configuration | Endpoint | Metadata/server-owned fields |
| Outbound configuration | Endpoint + Security | Metadata/server-owned fields |
| API key / HMAC / JWT verification | Security | Secret-safe server boundary |
| Outbound bearer/API-key/basic/OAuth auth | Security | Governed auth modes |
| Idempotency | Reliability | Preserve semantics |
| Rate limits | Reliability | Preserve semantics |
| Timeout/retry | Reliability | Preserve semantics |
| Routing/channel/protocol | Routing & Mapping | Governed metadata |
| Mapping rules | Routing & Mapping | No arbitrary executable code |
| Connection test | Test & Health | Server action |
| Health/provider availability | Test & Health | Server projection |
| API key create/rotate/revoke | Security or dedicated credential action | Server authority + step-up/permissions as required |
| Audit/redaction/log level | Audit | Server/governed metadata |
| Provider-specific setup | Metadata/profile pack | Never provider branching in generic React primitives |

## 6. Generic primitive composition

The connection surface should be expressible predominantly through generic UI primitives:

```text
SurfaceRoot
  -> PanelHeader
  -> SplitLayout
       -> ContractTablePanel
            selection target = connection
       -> SplitLayout
            -> FlowStepNavigator
                 selection target = connection_setup_step
            -> step content stack
                 -> FlowStepPanel step_id = identity
                      -> generic contract-backed editor
                 -> FlowStepPanel step_id = endpoint
                      -> generic contract-backed editor
                 -> FlowStepPanel step_id = security
                      -> generic contract-backed editor
                 -> ...
```

`FlowStepNavigator` and `FlowStepPanel` are generic primitives and must remain domain-neutral.

## 7. Selection rules

Suggested targets:

```text
connection
connection_setup_step
```

Selection is UI coordination state only.

Selecting a connection may reset the setup-step selection to the metadata-defined default step. Selecting a step must not authorize a write. Server permissions and connection lifecycle rules remain authoritative.

## 8. Metadata example

The eventual governed surface metadata may resemble:

```json
{
  "type": "FlowStepNavigator",
  "props": {
    "selection_target": "connection_setup_step",
    "default_step_id": "identity",
    "steps": [
      {"id": "identity", "label": "Identity", "icon": "identity"},
      {"id": "endpoint", "label": "Endpoint", "icon": "network"},
      {"id": "security", "label": "Security", "icon": "security"},
      {"id": "reliability", "label": "Reliability", "icon": "reliability"},
      {"id": "routing", "label": "Routing & Mapping", "icon": "routing"},
      {"id": "health", "label": "Test & Health", "icon": "health"},
      {"id": "audit", "label": "Audit", "icon": "audit"}
    ]
  }
}
```

This example documents intended surface composition only. It is not a substitute for the missing governed V2 connection-profile contract and must not be activated in production until that backend boundary is restored.

## 9. Progressive disclosure

Each step editor should support a simple default section and an optional Advanced disclosure.

The basic layer should contain the fields necessary for the majority of configurations. Advanced fields may include cryptographic/provider parameters, raw mapping structures, diagnostic tuning or low-frequency controls only when exposed by the governed server contract.

Do not hide required security information merely to simplify the screen. Simplicity comes from grouping and progressive disclosure, not from removing governed requirements.

## 10. Status projection

`FlowStepNavigator` supports bounded presentation statuses:

```text
pending
current
complete
warning
error
skipped
disabled
```

Step status may be supplied by surface metadata or a bounded server/read projection. Frontend code must not recreate connection validation policy to calculate authoritative readiness.

Examples:

```text
✓ Identity
✓ Endpoint
● Security
○ Reliability
! Routing
○ Test & Health
○ Audit
```

## 11. Add-new flow

`New connection` remains supported.

Creation should open an empty governed draft/profile through the eventual V2 contract, select it into the generic `connection` selection target, and focus the metadata-defined first step.

Do not generate tenant identity in the browser. Do not generate provider/business defaults that belong to governed metadata.

## 12. Security requirements

The V2 surface must reuse existing EIP auth/session/CSRF transport and server-derived tenant scope.

Never expose stored secrets in read payloads. The UI may receive bounded indicators such as:

```text
secret_set: true
credential_status: configured
```

but not stored secret material.

Credential create/rotate/revoke/test actions must remain dedicated governed server actions and should retain step-up/permission requirements where the final V2 contract requires them.

## 13. Backend readiness gate

Migration `v2_0039` intentionally keeps `owner_connections` disabled until governed gateway connection profiles are restored.

Do not enable the production surface until all of the following are true:

1. V2 connection profile persistence authority is explicit;
2. DTO/redaction rules are explicit;
3. tenant/owner-admin target scope is explicit;
4. secret storage and response masking are explicit;
5. list/detail/create/update/test contracts exist;
6. credential lifecycle contracts exist where required;
7. permissions and step-up requirements are explicit;
8. tenant-isolation tests cover the new routes;
9. UI surface metadata is backed by those contracts;
10. `owner_connections` can be enabled truthfully through a forward migration.

## 14. No-drift rule

When a V1 constant or branch is encountered, classify it before migration:

- presentation-only -> reusable UI metadata/primitives;
- governed reference value -> dropdown/profile metadata;
- validation/security policy -> server/profile policy;
- credential state -> secret-safe server projection;
- business workflow decision -> Process/Macro metadata;
- tenant/permission decision -> server authz boundary.

Do not move a V1 hardcoded constant into a different React helper and call the migration complete.

## 15. Current implementation slice

Implemented on the isolated UI branch:

- generic `FlowStepNavigator` primitive;
- bounded flow-step model;
- generic selection-target integration;
- automatic default-step selection;
- generic `FlowStepPanel` conditional detail primitive;
- responsive visual treatment;
- unit/governance tests.

Still blocked by backend readiness:

- actual V2 connection profile contracts;
- connection-specific surface metadata;
- credential lifecycle wiring;
- enabling `owner_connections`.
