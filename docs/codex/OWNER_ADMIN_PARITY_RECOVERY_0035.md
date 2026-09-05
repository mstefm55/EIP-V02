# Owner Admin Parity Recovery 0035

## Purpose

Recover the V2 Owner/Admin Console from the over-generic `v2_0031` state without reverting to hardcoded V1 pages or changing kernel/process authority.

## Confirmed drift

The prior runtime flattened Owner/Admin surfaces into the same `ContractRecordEditor` pattern and routed them through one hardcoded JS module catalogue backed by synthetic `owner_admin.*` Service Objects. This made Dashboard, Security, Tenant Requests, Settings, Reports and other surfaces appear structurally identical and made the route catalogue a duplicate source of UI/module authority.

## Recovery approach

- Keep the UI engine, renderer, registry and generic selection model.
- Keep `ui_surface` as composition authority.
- Remove the active generic `/owner-admin/modules/:module/records` runtime.
- Add read-only server DTO projections for live V2 kernel/auth state.
- Add only domain-neutral UI primitives:
  - `ContractMetricGrid`
  - `NoticePanel`
- Apply a forward-only surface migration: `v2_0035_owner_admin_console_parity_reseed.sql`.
- Do not modify applied migrations.
- Do not create any table.
- Do not delete existing kernel/process/auth/business state.

## Live surfaces restored in this wave

- Dashboard
  - live kernel/auth metrics
  - recent Service Object / Task lifecycle events
- Tasks & Follow-up
  - live V2 tasks
- Users & Roles
  - live auth identities, read-only
- Security
  - active sessions
  - registered browser devices
- Audit
  - real kernel lifecycle status events, explicitly labelled as partial audit evidence
- Settings
  - tenant setting keys/status/timestamps, read-only

## Truthful deferred surfaces

The following surfaces no longer expose synthetic generic CRUD. They render an explicit recovery-status notice until a real governed V2 contract is restored:

- Tenant Requests
- Connections
- Portfolios
- Templates
- Data Explorer
- Integrations
- Reports

Tenant Requests is specifically deferred because the public V2 intake currently sends/logs requests but does not persist a governed pre-tenant review queue. This wave does not invent a new table to hide that gap.

## Security boundary

Owner/Admin read projections use dedicated permission codes:

- `OWNER_ADMIN_CONSOLE_READ`
- `OWNER_ADMIN_ACCESS_READ`
- `OWNER_ADMIN_SECURITY_READ`
- `OWNER_ADMIN_SETTINGS_READ`

The bootstrap auth seed grants these to the bootstrap owner-admin identity. The seed no longer creates synthetic `owner_admin.*` Service Objects.

Read APIs are tenant-scoped and return bounded DTOs only. Credential hashes, OTP hashes, CSRF hashes and device-token hashes are not serialized.

## Deployment note

After this change is deployed, an existing bootstrap identity created before this wave must be reseeded once with the same approved bootstrap credentials so the dedicated Owner/Admin read permissions are added to its identity metadata.

## Drift check

Checked:

- kernel-first alignment: no kernel model change
- process authority: no lifecycle mutation moved into UI/routes
- UI-engine ownership: composition remains DB metadata-driven
- primitive gate: new primitives are domain-neutral and allowlisted
- tenant scope: all live projections use authenticated session tenant scope
- response boundary: explicit DTOs only
- secret boundary: no auth secret material exposed
- schema discipline: no new table
- migration discipline: forward-only `v2_0035`

Corrected:

- hardcoded owner-admin JS module catalogue removed from active runtime
- identical generic record-editor surface composition removed
- synthetic owner-admin bootstrap business records removed from future seed runs
- shell account presentation now resolves real login/organisation data
- Planning `CalendarClock` icon is supported by the shell allowlist

Intentionally deferred:

- persisted Tenant Request review/approval model
- connection-management contracts
- role/permission mutation UI
- security session/device mutation controls
- full security audit stream
- data explorer/export controls
- portfolio/template/integration/report write flows

Final alignment decision: **YES for this parity-recovery foundation.** Deferred capabilities are visibly and truthfully marked rather than simulated.
