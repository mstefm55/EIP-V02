# Owner/Admin Console Operational Composition 0039

## Purpose

Complete the next bounded correction of the V2 Owner/Admin Console without reintroducing the synthetic `owner_admin.*` Service Object catalogue or hardcoded page authority.

## Binding ownership model

The correction preserves:

- code-owned generic renderer and shell behavior;
- `eip_core.ui_surface` as module composition/navigation metadata authority;
- server-owned tenant, permission and response boundaries;
- real kernel/auth DTOs as live operational data;
- no executable metadata and no direct UI business mutation.

## Navigation availability

`surface_nav.enabled` and `surface_nav.hint` are generic governed navigation metadata.

The surface catalogue projects them as:

- `is_enabled`
- `nav_hint`

The Owner/Admin shell renders disabled surfaces as visibly unavailable and does not navigate to them. Quick-navigation tabs exclude unavailable entries.

This is intentionally generic. React does not decide that `Tenant Requests`, `Connections`, `Reports`, or any other named module is enabled or disabled. The decision comes from surface metadata.

## Live Owner/Admin modules

The following remain enabled because V2 already has real bounded contracts:

- Dashboard — live kernel/auth metrics plus lifecycle activity;
- Tasks & Follow-up — live tenant tasks;
- Users & Roles — live identity projection; role mutation remains protected/deferred;
- Security — live active sessions and registered device posture;
- Audit — live Service Object and Task lifecycle evidence;
- Reports — live operational snapshot assembled from existing bounded metrics/activity DTOs, explicitly not a report execution engine;
- Settings — live governed tenant setting keys/status/timestamps, values remaining protected.

## Deferred capabilities

The following remain represented as governed surfaces but are disabled in active navigation until their real V2 contract exists:

- Tenant Requests — public intake currently does not persist a governed pre-tenant review queue;
- Connections — governed gateway connection profiles are not restored;
- Portfolios — no governed portfolio contract exists;
- Templates — no canonical template lifecycle contract exists for this Admin module;
- Data Explorer — no explicit DTO/permission/redaction boundary has been approved;
- Integrations — governed provider/integration profile lifecycle is not restored.

These capabilities are not replaced with fake CRUD or static sample records.

## Reports boundary

The Reports surface now uses:

- `GET /api/eip/owner-admin/overview`
- `GET /api/eip/owner-admin/activity?limit=50`

It presents a current operational snapshot only. Scheduled report definitions, execution history and export remain deferred until a governed reporting contract exists.

## Schema and security

- New tables: **NO**
- Historical migrations modified: **NO**
- New business mutation routes: **NO**
- Auth/session/CSRF changes: **NO**
- Tenant scope changes: **NO**
- Secret-bearing setting values exposed: **NO**

## Result

The Admin Console no longer treats unavailable modules as clickable working applications. Live surfaces remain materially differentiated and consume real V2 contracts; unavailable capabilities are governed and visibly disabled instead of simulated.
