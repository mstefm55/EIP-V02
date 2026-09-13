# Owner Admin Control Closure V1

Status: **production baseline accepted**

Date: 2026-09-13

Production-tracked branch: `feature/route-temporal-gate-v1`

Accepted runtime merge: `a184529fd09ed412e72bb0b2d219df14a25aea62`

Railway API deployment: `5c8d4a65-ad53-4801-8829-b166d3c0bc41` (`SUCCESS`)

## Purpose

This record freezes the completed EIP Core V2 Owner Admin / Admin Control authority boundary. It is not a new authority model. It records the production behavior that must not be weakened by later UI, Process Studio, onboarding, or tenant-management work.

## Authority split

- Ordinary Owner Admin authority is **session-tenant authority only**.
- Cross-tenant/platform control is separate and explicit through `PLATFORM_*` permission codes.
- Tenant Users & Access is never a platform-permission provisioning channel.
- A tenant administrator cannot delegate permissions they do not currently hold.
- `PLATFORM_*` permissions and retired global Tenant Request permission names cannot be assigned through tenant Users & Access.
- Identities carrying explicit `PLATFORM_*` authority are platform-managed and cannot be mutated by another tenant administrator through Users & Access.

## Tenant Requests / onboarding

- Public access-request submission remains a legitimate pre-tenant control-plane operation.
- Global Tenant Request review/approval/rejection/resend is platform authority, not ordinary tenant Owner Admin authority.
- Admin surface discovery and direct surface loading consume governed `surface_nav.requires_any_permission` metadata; unauthorized sessions do not discover the platform-only Tenant Requests surface.
- `v2_0071_owner_admin_provisioning_identity_guard.sql` makes the provisioned request linkage immutable: once `tenant_id` and `admin_identity_id` are assigned, the request cannot be reassigned to a second tenant/admin identity.
- The provisioning identity is a complete pair; partially provisioned request linkage is rejected.

## Users & Access

Tenant user administration remains tenant-scoped and requires the existing permission + CSRF + recent strong-assurance path for writes.

The following boundaries are frozen:

- no self access mutation through the tenant Users & Access route;
- no platform permission delegation;
- no delegation beyond the acting administrator's own effective permissions;
- no mutation of another platform-managed identity;
- disable/lock actions revoke the affected tenant user's active sessions;
- agent links remain tenant-scoped.

## Security

- Session and device mutations remain tenant-scoped.
- Current-session revocation is protected.
- Device revocation revokes sessions bound to that device.
- Before revoking a session or changing device trust, the target security object and target identity are locked transactionally.
- A tenant security administrator cannot target another platform-managed identity.
- A platform operator may still manage their own older sessions/devices.

## Settings

- Settings are tenant-scoped through `withTenantTransaction`.
- Settings remain governed JSON configuration, not a credential/secret store.
- Secret credentials remain behind their dedicated governed control paths.

## Audit

- `security.audit_event` is the redacted privileged control-plane evidence store with optional tenant attribution.
- Tenant Admin Audit reads require `OWNER_ADMIN_AUDIT_READ` and filter by the authenticated session tenant.
- Secret values and raw credentials must never be written to audit attrs.

## Data Catalogue / Data Browser

**Data Catalogue is the Admin Data Browser.**

Its production boundary is intentionally metadata-only:

- reads schema/table/column structure from `information_schema`;
- uses the explicit schema allowlist (`kernel`, `tenant`, `security`, `eip_core`, `eip_auth`);
- does not provide raw SQL execution;
- does not browse arbitrary table rows;
- returns `row_data_exposed: false`.

Any future row-level data browser is a separate capability and requires an explicit authority, redaction, tenant-isolation, query-safety, and audit design before implementation.

## Metadata-driven UI boundary

- Navigation/surface composition remains metadata-driven.
- Permission-aware Admin surface visibility is enforced server-side, not only hidden in JSX.
- Direct surface fetch uses the same governed permission metadata as catalogue discovery.
- Browser-supplied tenant UUIDs do not become authority.

## Release evidence

The accepted closure passed the V2 Security Governance Gates on PR #26:

- full API unit regression suite;
- Workbench UI tests;
- Workbench production build;
- Effect Primitive V1 validation;
- Owner Admin Console governance validation;
- security-control validation;
- tenant-scope validation;
- process-governance validation.

Railway production then deployed merge `a184529f...` successfully, including the ordered/checksummed migration pre-deploy path that applies `v2_0071`.

## Frozen adjacent systems

- Connections remains the accepted single integration control plane and is not reopened by this closure.
- Process Studio remains governed by the existing integration/canon contracts and is not granted new Admin authority by this closure.
- No new role engine or competing permission store was introduced.
- No new table was introduced by the final closure migration.

## Reopen conditions

Reopen Owner Admin Control only for a confirmed regression or a new explicitly approved requirement. Any change that weakens tenant scoping, platform separation, strong-assurance writes, metadata-driven permission visibility, Data Browser metadata-only behavior, or onboarding provisioning immutability is a security/governance change and must pass the no-merge gates before release.
