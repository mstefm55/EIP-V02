# Owner Admin Control Closure — 2026-09-12

## Scope

This record captures the current EIP Core V2 Owner Admin completion state after the Admin parity work and the platform-authority correction.

The closure preserves the V2 canon:

- ordinary Owner Admin authority is session-tenant scoped;
- `kernel.tenant_request` is a deliberate pre-tenant/global control-plane queue;
- reviewing that global queue is platform authority, not tenant Owner Admin authority;
- identity remains distinct from Agent;
- Connections remains the single integration control plane;
- Process Studio remains a separate definition/editor experience backed by the canonical Process Engine;
- the browser never becomes tenant UUID authority;
- Data Catalogue remains schema/metadata-only and exposes no arbitrary tenant row browser.

## Implemented Owner Admin scope

The accepted completion branch now contains:

- truthful Owner Admin dashboard/overview composition;
- navigation cleanup and removal of duplicate/superseded Admin destinations;
- Users & Access projection against `eip_auth.auth_identity` and optional `auth_identity_agent` links;
- create/update access controls with tenant-scoped server authority;
- active session and device-trust administration;
- governed tenant Settings administration;
- durable redacted privileged audit evidence;
- metadata-only Data Catalogue;
- persisted public Request Access intake through `kernel.tenant_request`;
- approve/reject/resend onboarding lifecycle;
- one-time bootstrap activation and expired-link recovery semantics;
- metadata-driven UI contracts for all accepted Admin surfaces;
- CSRF and recent OTP/TOTP assurance on privileged writes.

## Platform versus tenant authority

Migration `v2_0068_owner_admin_control_foundation.sql` originally extended existing Owner Admin permission projections with `OWNER_ADMIN_TENANT_REQUEST_READ` and `OWNER_ADMIN_TENANT_REQUEST_WRITE`.

That was too broad because `kernel.tenant_request` is global by design. A normal tenant Owner Admin must not gain authority over access requests for other/future tenants.

The correction is implemented through:

- `PLATFORM_TENANT_REQUEST_READ`;
- `PLATFORM_TENANT_REQUEST_WRITE`;
- effective permission policy that makes legacy `OWNER_ADMIN_TENANT_REQUEST_*` grants inert unless bridged by explicit platform authority;
- ordinary bootstrap/repair profiles that exclude both legacy and platform queue permissions;
- an explicit `OWNER_ADMIN_REPAIR_PLATFORM_CONTROL=true` opt-in for the intended platform operator;
- migration `v2_0070_owner_admin_platform_authority_boundary.sql`, which removes leaked/global queue grants from identities before explicit platform repair and updates Tenant Requests surface metadata to platform permissions;
- narrow tenant-scope validator handling for the legitimate public pre-tenant insert and guarded global queue operations only.

This is deliberately fail-closed. A customer/tenant Owner Admin repair must not set the platform-control flag.

## New-table justification

The mandatory table register now explicitly covers the two tables introduced by `v2_0068`:

- `kernel.tenant_request`: justified because an access request exists before tenant ownership exists;
- `security.audit_event`: justified because privileged security/control-plane audit evidence cannot be represented truthfully by domain lifecycle status-event tables.

No additional table was introduced for the platform authority correction.

## Verification state

Current GitHub governance gates on the corrected branch pass:

- API unit regression suite;
- Workbench UI unit tests;
- Workbench production build;
- Effect Primitive V1 validation;
- Owner Admin Console governance validation;
- security-controls validation;
- tenant-scope validation;
- process-governance validation.

Regression evidence also verifies that:

- ordinary Owner Admin bootstrap defaults exclude global Tenant Requests authority;
- legacy leaked Tenant Requests permission codes are not effective grants;
- explicit platform permissions bridge to the current compatibility route contract;
- generic Owner Admin repair strips platform authority unless explicitly opted in;
- Tenant Requests surface metadata is bound to platform read/write authority;
- the validator does not globally exempt `kernel.tenant_request`.

## Metadata-driven visibility note

`v2_0070` declares `surface_nav.requires_any_permission=["PLATFORM_TENANT_REQUEST_READ"]` and root `permissions_any` metadata for Tenant Requests. The current generic surface catalogue does not yet consume that navigation predicate, so API authorization is closed now while navigation filtering remains a generic UI-engine enhancement. Do not hardcode a Tenant Requests hide rule in `OwnerAdminShell`; the catalogue should consume the metadata predicate when that enhancement is implemented.

## Remaining closure gates before production acceptance

The code/governance gate is green, but production acceptance still requires:

1. apply migrations on a fresh V2 database and confirm `v2_0070` executes cleanly;
2. apply migrations on the existing Railway database using the immutable checksum ledger;
3. configure the intended production platform operator with `OWNER_ADMIN_REPAIR_PLATFORM_CONTROL=true` before the repair step runs;
4. smoke the real Request Access -> platform review -> bootstrap -> tenant login path;
5. smoke ordinary tenant Owner Admin access and prove the global Tenant Requests queue is denied;
6. smoke Users & Access, sessions/devices, Settings, Audit, and Data Catalogue against real production data;
7. verify the PR/base branch topology before merge because the completion PR currently targets `feature/route-temporal-gate-v1`, not `main`;
8. update the Developer Manual and deployment record with final production truth after those checks.

Do not declare Owner Admin production-frozen until these production gates are complete.
