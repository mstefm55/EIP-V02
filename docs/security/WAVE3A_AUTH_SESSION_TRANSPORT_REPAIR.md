# Wave 3A - Auth Session Transport Repair

Date: 2026-09-04

Status: narrow production repair within the existing V2 auth shell. No schema change.

## Canon basis

This repair is subordinate to:

- `docs/security/V2_SECURITY_TRANSFER_PLAN.md`
- `docs/security/V1_V2_SECURITY_TRANSFER_MATRIX.md`
- `docs/architecture/UI_ENGINE_OWNERSHIP.md`

V1 is behavioural evidence only. V2 remains authoritative.

## Production defect

The Railway frontend and API are deployed as separate browser origins. Login can succeed at the API while the browser fails to return the API session cookie on the immediate `GET /api/eip/auth/whoami`, leaving the UI unauthenticated. Separately, the frontend cannot reliably read an API-origin CSRF cookie with `document.cookie` when the frontend and API are different origins.

The defect is transport-level. It must not be fixed by moving session authority into React, exposing raw session rows, storing bearer credentials in local storage, or weakening CSRF/origin checks.

## V1 evidence retained

V1 proved a useful cross-origin CSRF pattern:

1. keep the session cookie HttpOnly;
2. keep the CSRF cookie bound to the server-side session hash;
3. expose a narrow authenticated `GET /api/eip/auth/csrf` transport endpoint;
4. return only the CSRF token as a bounded DTO;
5. mark the response `Cache-Control: no-store`;
6. let the frontend cache the token in memory and retry once on CSRF mismatch/expiry.

This behaviour is retained.

## V2 controls retained because they are stronger

The V2 auth shell remains authoritative for:

- tenant + realm bound sessions;
- server-side `sid_hash` verification using the session pepper;
- server-side CSRF hash binding using the CSRF pepper;
- absolute and idle session expiry;
- session revocation;
- user-agent binding;
- hashed device-token binding and revoked-device checks;
- minimal `whoami` projection;
- centralized `requireSession`, `requirePermission`, and `requireCsrf` helpers;
- origin allowlisting through configured CORS origins.

No V1 route-local session implementation replaces these controls.

## V2 upgrade for cross-site preview transport

V2 adds optional partitioned auth cookies for deployments where frontend and API are on different sites.

Runtime switch:

```text
AUTH_COOKIE_PARTITIONED=true
```

Fail-closed prerequisites:

```text
AUTH_COOKIE_SECURE=true
AUTH_COOKIE_SAMESITE=none
AUTH_COOKIE_DOMAIN=<empty>
```

If partitioned mode is enabled with weaker cookie settings, the API must fail startup rather than silently downgrade the cookie posture.

Partitioning applies only to the existing auth cookie transport. Session authority remains in `eip_auth.auth_session` and the existing V2 auth shell.

For the final production domain layout, frontend and API hostnames under one controlled registrable domain remain preferred. Partitioned preview-cookie support is a compatibility hardening layer, not a replacement for controlled production DNS.

## CSRF transport contract

Endpoint:

```text
GET /api/eip/auth/csrf
```

Requirements:

- valid EIP session;
- trusted configured origin when an Origin/Referer is present;
- API-origin CSRF cookie present;
- CSRF cookie hash must match the current session's server-side `csrf_secret_hash`;
- response contains only `{ ok: true, csrf }`;
- `Cache-Control: no-store, max-age=0` and `Pragma: no-cache`;
- no session row, credential, device token, password, OTP, pepper, or hash is returned.

Frontend behaviour:

- validate the API path through the existing V2 internal-endpoint normalizer before fetch;
- request CSRF with `credentials: include`;
- store CSRF only in memory;
- never store session/auth/CSRF material in localStorage;
- retry one time only for `CSRF_MISSING`, `CSRF_MISMATCH`, or `CSRF_INVALID`;
- reset the cached CSRF token after session-mutating auth actions and on HTTP 401.

## `whoami` posture

`GET /api/eip/auth/whoami` remains the V2 minimal session projection. This repair does not broaden it.

The endpoint continues to expose only the bounded auth context required by the UI shell:

- tenant identity;
- identity id;
- realm;
- device id;
- assurance;
- expiry;
- permission codes.

It must not expose session hashes, CSRF hashes, password credentials, device hashes, OTP challenges, TOTP secrets, or raw identity attributes.

Both `whoami` and the CSRF transport endpoint are non-cacheable.

## V1 controls not copied blindly

This repair does not copy:

- V1-specific admin/module assumptions;
- V1 route-local session authority;
- compatibility/debug paths;
- raw database rows;
- frontend business/security authority;
- localStorage bearer-token substitutes;
- new auth tables.

## Next security parity item

V1 is stricter than the current V2 default for password-only sign-in on an untrusted browser, especially for privileged identities. After session transport is validated on Railway, the next narrow Wave 3 item is to make password-only login a trusted-device path and require OTP/TOTP step-up before establishing a new privileged/untrusted-device session.

That change must reuse the V2 device/session/permission model rather than importing V1 admin-role assumptions.

## Validation gate

Required before declaring this repair complete:

1. API tests pass.
2. Workbench tests pass.
3. Workbench build passes.
4. Railway login response establishes browser auth cookies.
5. Immediate `GET /api/eip/auth/whoami` returns 200 from the frontend flow.
6. `GET /api/eip/auth/csrf` returns a bounded token DTO and no sensitive session fields.
7. Authenticated mutating requests include `x-csrf` and succeed.
8. Wrong/stale CSRF triggers one refresh/retry only.
9. Logout revokes session and clears auth cookies.
10. No new migration/table is introduced.

## Drift check

- Kernel-first: unchanged.
- Process authority: unchanged.
- UI engine: transport only; no business semantics moved to React.
- Tenant/realm isolation: retained in V2 auth shell.
- Security: no downgrade; V1 transport behaviour is adapted into stronger V2 session/device controls.
- Schema discipline: no migration and no new table.
