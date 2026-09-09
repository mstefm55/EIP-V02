# Connections Owner Admin Provisioning Closure — 2026-09-09

## Scope

This record closes the code-side gap discovered during live V2 Connections acceptance after migration `v2_0053_connection_permission_authority_repair.sql` was applied successfully.

Production evidence showed authentication and surface discovery succeeding while Owner Admin account and Connections data contracts failed closed with `403`:

- `POST /api/eip/auth/login/otp` -> `200`
- `GET /api/eip/auth/whoami` -> `200`
- `GET /api/eip/ui/surfaces/owner_connections` -> `304`
- `GET /api/eip/owner-admin/account` -> `403`
- `GET /api/eip/owner-admin/connections` -> `403`
- `GET /api/eip/owner-admin/connections/taxonomy` -> `403`

The runtime re-reads `eip_auth.auth_identity.attrs` on each request, so the failure is not a stale-login permission snapshot. The Owner Admin account route requires `OWNER_ADMIN_CONSOLE_READ`; Connections routes require the dedicated Connection permissions.

## Root cause class

The missing production acceptance dependency is Owner Admin identity provisioning, not a Connections route or UI-surface defect.

The normal V2 bootstrap seed already defines the intended privileged permission profile. A production identity that was created or retained outside that bootstrap authority can authenticate successfully while still failing Owner Admin authorization.

No route-level bypass, blanket migration grant, tenant-specific hardcoding, or new table is permitted as a repair.

## Code-side closure

Branch: `repair/owner-admin-provisioning-closure`

Added:

- `services/api/scripts/bootstrapPermissionProfile.mjs`
  - reusable normalized Owner Admin/bootstrap permission profile for repair tooling;
- `services/api/scripts/repair_owner_admin_permissions.mjs`
  - requires explicit tenant code and login;
  - dry-run by default;
  - refuses missing, ambiguous, inactive, or locked targets;
  - preserves existing canonical permissions;
  - applies only when `OWNER_ADMIN_REPAIR_APPLY=true`;
  - does not reset passwords, TOTP, email, sessions, tenant state, or credentials;
- `services/api/test/ownerAdminPermissionRepair.test.mjs`
  - guards required Owner Admin + Connections authority;
  - guards normalization/deduplication;
  - guards dry-run-by-default behavior.

Added npm operator command:

```text
npm run repair:owner-admin-permissions
```

## Production operator sequence

Do not run against an assumed identity. First set the explicit target that was used for the production Owner Admin login.

For the current seed baseline the conventional values are:

```text
OWNER_ADMIN_REPAIR_TENANT_CODE=v2seed
OWNER_ADMIN_REPAIR_LOGIN=v2.admin
```

1. Run a dry-run with `OWNER_ADMIN_REPAIR_APPLY` unset/false.
2. Confirm the returned tenant name, login, identity id, and missing permissions match the intended Owner Admin identity.
3. Set `OWNER_ADMIN_REPAIR_APPLY=true` and run exactly once.
4. Sign out and sign back in.
5. Verify `/owner-admin/account`, Connections list, and Connections taxonomy no longer return `403`.
6. Complete live Connections acceptance:
   - create disabled draft;
   - edit/save profile;
   - rotate/configure required credential under step-up;
   - run governed connection test;
   - exercise inbound endpoint where applicable;
   - verify idempotency replay and conflict behavior;
   - verify rate limiting;
   - verify cross-tenant denial.

## Release boundary

This file does not claim production acceptance by itself.

Connections is production-complete only after:

- the targeted Owner Admin repair is applied to the intended production identity;
- the authenticated UI/data calls pass;
- the live create/edit/credential/test/inbound/tenant-isolation acceptance sequence passes;
- the living `docs/dev/DEVELOPER_MANUAL.md` progress record is synchronized as part of final accepted closure.

Until then, Process Studio remains paused behind Connections production acceptance.
