# Admin Console V1 -> V2 Parity Audit — 2026-09-12

Branch: `prep/admin-console-v1-v2-migration`
V1 source: `mstefm55/EIP-ecom-v1.0` / `main`
V2 base: `feature/route-temporal-gate-v1` after Process Studio preparation merge `2b5f1aa21bb6211d79bfeb894ed04d294aa3694b`

## 1. Purpose

This audit defines what should actually be migrated from the stable V1 Admin Console into EIP Core V2.

The migration rule is **not** “copy V1”. The rule is:

```text
stable V1 UX / useful operator behavior
    + current V2 kernel / auth / engine authority
    + metadata-driven V2 UI surfaces
    -> V2 Owner Admin Console
```

Healthy V2 engines and security boundaries are retained. V1 components are UX/reference sources only; V1 route contracts, cross-tenant assumptions, module tables, direct tenant UUID selection, and mock/fallback data do not become V2 authority automatically.

> **Closure update (2026-09-12):** Waves B-D described below have now been implemented for the accepted Owner Admin completion scope through migrations `v2_0066`-`v2_0070`: governed Users & Access, sessions/devices, tenant Settings, redacted Audit, metadata-only Data Catalogue, persisted pre-tenant Tenant Requests, bootstrap activation/recovery, and an explicit platform-vs-tenant authority boundary for the global onboarding queue. The historical decision text below is preserved as the migration rationale; where it says a V2 capability "is not restored" or "requires backend transfer", read that as the pre-implementation audit state rather than current repository truth.

## 2. Sources reviewed

V1 stable Admin UI:

- `apps/dashboard/src/components/admin/AdminShell.jsx`
- `AdminHeader.jsx`
- `AdminMetrics.jsx`
- `TenantRequestBoard.jsx`
- `AdminMonitoringDashboard.jsx`
- `AdminConnectionsPanelSafe.jsx`
- `AdminUsersPanel.jsx`
- `AdminPortfolioPanel.jsx`
- `AdminTemplateClonePanel.jsx`
- `AdminSecurityPanel.jsx`
- `AdminPasskeysPanel.jsx`
- `AdminAuditPanel.jsx`
- `AdminDbExplorer.jsx`
- `AdminModulesPanel.jsx`
- `AdminProcessBuilder.jsx`
- `apps/dashboard/src/engine/surfaces/admin.js`
- `docs/admin_dashboard_button_audit_v1.md`

V2 current authority/UI:

- `apps/workbench-ui/src/components/shell/OwnerAdminShell.jsx`
- `services/api/src/routes/owner_admin_console.js`
- V2 UI engine primitives and metadata-driven `ui_surface`
- `v2_0035_owner_admin_console_parity_reseed.sql`
- `v2_0039_owner_admin_console_operational_composition.sql`
- `v2_0040..v2_0062` Connections implementation
- current Auth, tenant, Process, Connections and security contracts
- `ORGANISATION_AGENT_WORKSTATION_INTEGRATION_V1.md`

## 3. V1 stable navigation

V1 exposes:

```text
Dashboard
Tenant Requests
Processes
Connections
Tasks & Follow-up
Users & Roles
Portfolios
Templates
Security
Audit
Data Explorer
Integrations
Reports
Settings
```

The V1 shell also includes a collapsible sidebar, top quick navigation, account/profile menu, editable user profile/avatar, step-up flow, language switching, idle logout and sign-out.

V2 already has a metadata-driven Owner Admin shell with governed surface discovery, collapsible navigation, quick header tabs, authenticated organisation display, account display, refresh and sign-out. V2 therefore needs selective UX parity, not a shell replacement.

## 4. Parity matrix

| V1 area | V1 status | Current V2 | Decision | Integration note |
| --- | --- | --- | --- | --- |
| Admin shell/navigation | Stable functional shell | Metadata-driven `OwnerAdminShell`, safer organisation/session authority | **KEEP V2 + UPGRADE UX** | Preserve V2 surface discovery and organisation authority; selectively restore profile/step-up conveniences only through V2 auth contracts. Do not restore browser tenant switching. |
| Dashboard | Rich monitoring UI; can fall back to hardcoded demo metrics/log rows | Live bounded overview + lifecycle activity | **REVAMP** | Reuse V1 visual hierarchy only with real V2 metrics. Never carry V1 hardcoded fallback transaction data into production. |
| Tenant Requests | Full list/filter/paging/approve/reject/resend bootstrap workflow | Public request intake exists, but governed persisted admin review queue is not restored | **MIGRATE AFTER BACKEND TRANSFER** | High-value V1 UX. Requires audited pre-tenant persistence/lifecycle transfer before enabling controls. |
| Processes | Functional legacy Process Builder | V2 Process Engine + separate new Process Studio / future Business Analysis integration | **RETIRE FROM ADMIN AS EDITOR** | Do not migrate V1 builder. Admin may provide a navigation link/status entry to Business Analysis, not a competing editor. |
| Connections | Large functional V1 gateway editor | V2 governed Connections is substantially newer and production-capable | **KEEP V2** | Do not copy V1 Connections code. Current V2 seven-step metadata-driven surface is authority. |
| Tasks & Follow-up | Placeholder only | Live V2 kernel task table | **KEEP V2 / LATER REPOSITION** | V2 is ahead. When Operational Workbench lands, Admin should retain only genuinely administrative work/exception views rather than duplicate My Work. |
| Users & Roles | Full tenant search, identity creation, role/permission mutation, profile/avatar, passkey admin | V2 currently lists real identities read-only | **MIGRATE / REVAMP HIGH PRIORITY** | Rebuild against V2 auth + Agent model. Identity != Agent. Avoid importing V1 role semantics blindly; permission/membership authority must be frozen first. |
| Portfolios | Functional cross-tenant admin portfolio + tenant assignment | Not restored | **REVIEW / REVAMP, NOT DIRECT COPY** | V1 concept controls admin scope across tenants. V2 is session/tenant scoped. Must be reconciled with platform-owner control plane before any migration. |
| Templates | Functional template-tenant clone UI | Not restored | **DEFER / REDEFINE** | V1 clones modules/processes/UI/schema/dropdowns/role bundles. In V2, versioned engines and metadata ownership make blind tenant cloning unsafe. Define governed provisioning/template semantics first. |
| Security | Devices + recovery request approval/reject + Passkeys | V2 has live sessions/devices and OTP/TOTP/device hardening; V1 recovery/passkey administration is not present | **KEEP V2 + SELECTIVE RESTORE** | Sessions/devices stay V2. Restore only security capabilities supported by current V2 Auth; never port deprecated credential storage. |
| Audit | Rich security ops metrics, filters, event details, redaction and connection health | V2 shows kernel lifecycle events only | **MIGRATE CONCEPT / NEW V2 SECURITY AUDIT PROJECTION** | V1 UX is useful. Backend must expose governed redacted security/audit DTOs; browser-side redaction alone is not sufficient. |
| Data Explorer | Functional schema/table browsing, exports and sensitive-token flow | Explicitly withheld | **REVAMP UNDER STRICT GOVERNANCE** | Do not expose raw database explorer by default. Prefer schema/metadata explorer plus explicitly permitted/redacted bounded row inspection. |
| Integrations | Placeholder | Connections now owns governed external transport/auth/reliability | **RETIRE DUPLICATE NAV** | Fold into Connections. Do not recreate a second integration surface. |
| Reports | Placeholder | V2 has truthful live operational snapshot | **KEEP V2** | Later BI/report engine can replace/extend it. V1 contributes no working report engine. |
| Settings | V1 tenant module catalogue/toggles + translation billing | V2 shows governed tenant setting keys read-only | **REVAMP** | Do not reintroduce legacy module catalogue as application architecture. Move toward governed capabilities/surfaces/configuration and dedicated commercial settings where appropriate. |

## 5. Shell migration decision

Do **not** replace `OwnerAdminShell` with V1 `AdminShell`.

Keep V2 strengths:

- metadata-driven surface discovery;
- server-owned organisation/session context;
- no browser tenant selector in the shell;
- navigation enable/disable state from governed metadata;
- generic UI-engine composition;
- current account/organisation projection;
- current V2 auth transport and CSRF handling.

Selective V1 UX candidates:

- richer account/profile dialog;
- avatar presentation if V2 profile contract is restored;
- visible step-up interaction when a server action requires recent MFA;
- compact user-friendly header treatment;
- language switcher only if the V2 internationalisation contract is adopted;
- idle/session UX only if it delegates to V2 session authority.

The V1 UI-version toggle is not migrated.

## 6. Dashboard decision

V1 `AdminMonitoringDashboard` has a useful dense-but-readable structure:

```text
KPI strip
-> transaction/activity volume
-> log/list
-> selected detail
-> trace/inspection
```

However, it contains hardcoded default KPIs, transaction rows and example payloads when no endpoint result exists. Those defaults are suitable as prototype fallback only and must not be migrated as production truth.

V2 currently has truthful metrics:

```text
Service Objects
Open Tasks
Active Process Definitions
Active Process Instances
Active Identities
Active Sessions
```

and lifecycle activity.

Upgrade target:

```text
Platform posture strip
+ operational trend/volume only when backed by real telemetry
+ attention / failures projection
+ recent governed activity
+ drill-down
```

No fake metric or synthetic transaction row is permitted.

## 7. Tenant Requests decision

V1 provides the desired operator workflow:

- status chips;
- search;
- paging;
- counts;
- approve;
- reject with reason;
- resend bootstrap;
- one-time bootstrap copy/display;
- clear terminal-state action rules.

V2 intentionally removed the fictional replacement because it does not currently persist a governed pre-tenant admin queue.

Therefore the **UI is approved as a UX reference**, but the V1 persistence/lifecycle must be audited separately before the page can be re-enabled.

This is one of the few areas where a relational transfer may prove necessary because onboarding review exists before normal tenant-owned kernel context. Any table transfer/addition still requires the normal V2 schema justification gate.

## 8. Process administration decision

The V1 `AdminProcessBuilder` is not migrated.

The project now has one Process/Business Analysis direction:

```text
Business Analysis / Process Studio
    defines the business/process

Process Engine
    executes the definition

Operational Workbench
    presents human work
```

The Admin Console must not host another Process editor.

A future Admin Console entry may expose:

- Process Studio availability/health;
- link/open action;
- release/governance summary if required;

but editing remains in the accepted Process Studio/Business Analysis UI.

## 9. Connections decision

V2 Connections has already replaced the V1 implementation with:

- tenant-scoped governed profiles;
- encrypted credential lifecycle;
- readiness/activation truth;
- inbound/outbound execution;
- idempotency and rate limits;
- provider verification;
- tenant isolation;
- seven-step metadata-driven operator UI.

The V1 `AdminConnectionsPanelSafe` is historical UX/reference only. No code transplant is required.

`Integrations` becomes redundant and should eventually disappear as a separate Admin destination unless a genuinely distinct integration-control responsibility emerges.

## 10. Users, Roles, Agent and organisation alignment

This area needs deliberate V2 redesign rather than direct V1 copy.

V1 mixes:

```text
login identity
profile
roles
permissions
passkeys
selected tenant
```

V2 has an explicit separation:

```text
Auth Identity
  -> optional eip_auth.auth_identity_agent link
      -> EIP Agent
          -> organisation hierarchy
```

The Admin Console therefore must distinguish:

- login/security identity;
- business/person Agent;
- organisation placement;
- access permissions/membership;
- security credentials/devices.

The V1 tenant-selector-in-page pattern is not copied into the normal tenant Admin Console because V2 server/session tenant scope is authoritative.

If a future platform-owner console must manage multiple tenants, that is a distinct explicitly authorised control-plane scope, not ordinary tenant UI authority.

## 11. Security and Audit decision

V2 sessions/devices remain the baseline.

V1 gives good UX references for:

- recovery review queue;
- passkey administration;
- security event summary;
- time-window filters;
- severity/outcome filters;
- event detail drawer/modal;
- connection/security health summaries.

But the V1 audit component also performs client-side sensitive-key redaction. V2 must redact at the DTO/API boundary first; client redaction can remain defence-in-depth only.

No V1 credential table or auth implementation is transferred without a V2 security review.

## 12. Data Explorer decision

The V1 explorer is operationally useful but too powerful to copy directly into a multi-tenant kernel UI.

V2 target should be split conceptually:

```text
Schema / Metadata Explorer
    safe by default

Governed Data Inspection
    explicit permission
    tenant scope
    bounded rows
    redacted DTO
    audit event
    optional recent step-up for sensitive inspection/export
```

Raw arbitrary SQL is not introduced.

## 13. Settings / Modules decision

The V1 Settings page is actually a legacy module/subscription manager with a special translation-billing section.

Do not migrate it as-is.

V2 direction:

```text
Tenant Settings
Capabilities / enabled surfaces
commercial/service configuration where applicable
shell/profile configuration through its own lifecycle
```

A domain-specific billing setting should live under its governed commercial/service owner, not force the whole Admin Settings model to depend on the old module catalogue.

## 14. Recommended migration waves

### Wave A — Stable shell and truthful live pages

Keep V2 architecture and improve presentation/parity for:

- Owner Admin shell;
- Dashboard;
- Connections;
- Tasks;
- Security sessions/devices;
- Reports snapshot;
- Settings visibility.

Also remove/reclassify duplicate or superseded navigation such as legacy Integrations and the old Process-editor expectation.

### Wave B — Access administration

Restore governed V2 mutation capability for:

- identities;
- access/membership/permission assignment;
- profile/Agent link visibility;
- organisation placement projection where appropriate.

Do not implement until the access vocabulary/authority matrix is explicit.

### Wave C — Tenant onboarding

Transfer the real pre-tenant review/bootstrap lifecycle and then apply the V1 Tenant Request Board UX on top of that governed contract.

### Wave D — Security audit and controlled inspection

Add server-redacted audit/security event projections and then restore the strong V1 Audit UX. Reintroduce Data Explorer only as a governed metadata/data-inspection capability.

### Wave E — Platform-owner administration

Reassess V1 Portfolios and Template Cloning as platform-owner capabilities. Do not mix them into ordinary tenant Owner Admin until cross-tenant authority is explicitly modelled.

## 15. Immediate implementation guardrails

1. No V1 React component is copied wholesale into V2.
2. No V1 endpoint path becomes canonical merely because a component calls it.
3. `OwnerAdminShell` remains metadata-driven.
4. No raw browser tenant UUID becomes authority.
5. No second Process Studio or Connections engine/surface is created.
6. No fake dashboard metrics or mock production rows.
7. Sensitive data is redacted server-side.
8. Identity remains distinct from Agent.
9. Organisation tree is a projection of the canonical Agent model and is not authorization proof.
10. New tables require explicit V2 justification; do not recreate V1 storage by habit.
11. Stable V1 UX may be reproduced using generic V2 primitives when possible.
12. Every writable Admin surface must have input validation, permission checks, CSRF protection, tenant isolation and regression evidence before it is enabled.

## 16. First migration target

The safest first implementation target is **Wave A**, because it improves/reconciles already-real V2 surfaces without transferring obsolete persistence.

The first code change should therefore be an Admin Console navigation/surface cleanup and dashboard/shell UX upgrade using existing V2 endpoints and generic primitives.

Users & Roles and Tenant Requests follow only after their V2 backend authority contracts are explicitly closed.
