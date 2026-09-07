# EIP Core V2 Connection Management UI Contract

Status: implemented release guardrail for the V1 -> V2 Connections migration.

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

The connection surface is expressed predominantly through generic UI primitives:

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
                      -> ContractFlowStepEditor
                 -> FlowStepPanel step_id = endpoint
                      -> ContractFlowStepEditor
                 -> FlowStepPanel step_id = security
                      -> ContractFlowStepEditor
                      -> ContractActionPanel
                 -> ...
```

`FlowStepNavigator`, `FlowStepPanel`, `ContractFlowStepEditor` and `ContractActionPanel` are generic primitives and must remain domain-neutral.

## 7. Selection rules

Canonical targets:

```text
connection
connection_setup_step
```

Selection is UI coordination state only.

Selecting a connection resets the setup-step selection to the metadata-defined default step. Selecting a step must not authorize a write. Server permissions and connection lifecycle rules remain authoritative.

## 8. Metadata example

The governed surface metadata includes the canonical setup journey in this form:

```json
{
  "type": "FlowStepNavigator",
  "props": {
    "selection_target": "connection_setup_step",
    "default_step_id": "identity",
    "reset_on_selection_target": "connection",
    "steps": [
      {"id": "identity", "label": "Identity", "icon": "identity"},
      {"id": "endpoint", "label": "Endpoint", "icon": "endpoint"},
      {"id": "security", "label": "Security", "icon": "security"},
      {"id": "reliability", "label": "Reliability", "icon": "reliability"},
      {"id": "routing", "label": "Routing & Mapping", "icon": "routing"},
      {"id": "health", "label": "Test & Health", "icon": "health"},
      {"id": "audit", "label": "Audit", "icon": "audit"}
    ]
  }
}
```

The production composition is seeded by `v2_0043_connection_management_surface_v1.sql` and is backed by the governed V2 connection contracts. Surface activation is a separate forward-only release action in `v2_0044_connection_management_surface_enable.sql`.

## 9. Progressive disclosure

Each step editor supports a simple default section and an optional Advanced disclosure.

The basic layer contains the fields necessary for the majority of configurations. Advanced fields may include cryptographic/provider parameters, declarative mapping structures, diagnostic tuning or low-frequency controls only when exposed by the governed server contract.

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

`New connection` is supported.

Creation opens an empty governed disabled draft/profile through the V2 contract, selects it into the generic `connection` selection target after creation, and focuses the metadata-defined first step.

The browser does not generate tenant identity. It also does not generate governed direction, auth mode, provider rules or other business/security defaults. Those remain server/metadata authority.

## 12. Security requirements

The V2 surface reuses existing EIP auth/session/CSRF transport and server-derived tenant scope.

Never expose stored secrets in read payloads. The UI may receive bounded indicators such as:

```text
configured: true
credential_status: configured
version: 3
fingerprint: <non-secret fingerprint>
```

but not stored secret material.

Credential rotate/revoke actions remain dedicated governed server actions with `OWNER_ADMIN_CONNECTION_SECRET_MANAGE` plus fresh OTP/TOTP step-up. Connection test uses `OWNER_ADMIN_CONNECTION_TEST`. Profile reads/writes use the dedicated connection read/write permissions. Tenant identity comes from the authenticated server session, never from browser payload authority.

## 13. Backend readiness gate

Migration `v2_0039` historically kept `owner_connections` disabled while the real control plane was absent. That guard was intentionally retained until all readiness requirements were implemented and tested.

The release sequence is now:

1. `v2_0040_connection_control_plane_foundation.sql`
   - tenant-scoped connection profile persistence reuses governed `tenant.tenant_settings`;
   - encrypted credential lifecycle is isolated in `tenant.connection_secret` with FORCE RLS;
   - governed connection taxonomy is seeded.
2. `v2_0041_connection_secret_actor_fk_hardening.sql`
   - secret lifecycle actor references are hardened against tenant/identity drift.
3. `v2_0042_connection_control_plane_permissions.sql`
   - dedicated read/write/secret/test permissions are granted to existing eligible Owner Admin identities.
4. API/service implementation
   - bounded list/detail/create/update/test contracts;
   - secret rotate/revoke lifecycle contracts;
   - DTO redaction and safe credential status projection;
   - server-derived tenant scope, CSRF, permission and step-up enforcement.
5. `v2_0043_connection_management_surface_v1.sql`
   - composes the real seven-step metadata-driven surface while keeping navigation disabled for validation.
6. Governance validation
   - API regression suite;
   - Workbench unit suite and production build;
   - dedicated Connections surface-governance tests;
   - Owner Admin, security, tenant-scope and process-governance gates.
7. `v2_0044_connection_management_surface_enable.sql`
   - verifies the required control-plane/taxonomy/surface composition and only then enables the `owner_connections` navigation entry.

The original readiness checklist is therefore satisfied:

1. V2 connection profile persistence authority is explicit;
2. DTO/redaction rules are explicit;
3. tenant/owner-admin target scope is explicit;
4. secret storage and response masking are explicit;
5. list/detail/create/update/test contracts exist;
6. credential lifecycle contracts exist;
7. permissions and step-up requirements are explicit;
8. tenant-isolation/security tests cover the routes and storage boundary;
9. UI surface metadata is backed by those contracts;
10. `owner_connections` is enabled through a separate forward migration after validation.

## 14. No-drift rule

When a V1 constant or branch is encountered, classify it before migration:

- presentation-only -> reusable UI metadata/primitives;
- governed reference value -> dropdown/profile metadata;
- validation/security policy -> server/profile policy;
- credential state -> secret-safe server projection;
- business workflow decision -> Process/Macro metadata;
- tenant/permission decision -> server authz boundary.

Do not move a V1 hardcoded constant into a different React helper and call the migration complete.

Provider-specific additions must arrive through governed metadata/profile packs and bounded server contracts. Do not add provider-specific branches to generic UI primitives.

## 15. Current implementation slice

Implemented and release-gated on the isolated Connections branch:

- tenant-scoped connection profile persistence authority;
- encrypted independent connection credential lifecycle with FORCE RLS;
- governed connection taxonomy;
- dedicated Connection Management permissions;
- server-derived tenant scope and CSRF enforcement;
- fresh OTP/TOTP step-up for credential mutations;
- secret-safe DTO/redaction boundary;
- list/detail/create/update/test contracts;
- credential rotate/revoke contracts;
- generic `FlowStepNavigator` and bounded flow-step model;
- generic selection-target integration and automatic default-step reset;
- generic `FlowStepPanel` conditional detail primitive;
- generic `ContractFlowStepEditor` including bounded list/JSON field handling;
- generic `ContractActionPanel` for governed server actions;
- catalogue refresh/reselection support for current health/lifecycle projection;
- metadata-driven seven-step `owner_connections` surface composition;
- separate forward-only release enablement migration;
- API, UI, build, security, tenant-scope, Owner Admin and process-governance regression coverage.

There is no remaining backend-readiness blocker for the V2 Connections surface. Future provider-specific setup remains a metadata/profile-pack concern and must preserve the same ownership and security boundaries.
