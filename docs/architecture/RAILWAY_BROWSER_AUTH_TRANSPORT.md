# RAILWAY_BROWSER_AUTH_TRANSPORT

## Purpose

Lock the production browser/auth transport boundary for EIP Core V2 on Railway.

Read with `UI_ENGINE_OWNERSHIP.md`. Authentication/session transport remains code-owned, while authentication, authorization, tenant/realm scope and session authority remain server-owned.

## Production invariant

The browser MUST use same-origin `/api/*` requests through the frontend runtime gateway.

```text
Browser
  -> https://<frontend-origin>/api/*
  -> eip-frontend runtime proxy
  -> eip-v2-api
  -> Postgres
```

The production browser MUST NOT depend on direct cross-site auth requests from the frontend Railway domain to the API Railway domain.

## Reason

EIP auth uses cookie-backed sessions plus CSRF verification. Direct browser calls across separate Railway public domains make the API session cookies third-party cookies relative to the frontend page. Modern browser privacy controls, especially private/incognito modes, may block those cookies even when `SameSite=None; Secure` is used. The resulting failure pattern is strong-auth success followed by `whoami = 401` because the new `sid` cookie is not returned by the browser.

The CSRF cookie is also intentionally readable by same-origin frontend code so it can be mirrored into the governed `x-csrf` header. A cookie scoped only to a different API host cannot be read by frontend JavaScript.

## Runtime ownership

`apps/workbench-ui/server.mjs` owns the production transport gateway:

- serves the built Vite `dist` application;
- proxies `/api/*` to the configured API upstream;
- streams request and response bodies;
- preserves `Set-Cookie` headers so cookies are established on the frontend public origin;
- preserves the browser `Origin` header so API origin policy remains authoritative;
- does not implement authentication or authorization logic.

The upstream target resolves from:

1. `API_PROXY_TARGET`, when explicitly configured;
2. `VITE_API_BASE_URL`, retained as a Railway/runtime upstream hint for compatibility;
3. `http://localhost:4010` for local fallback.

## Frontend API client rule

Production `apiClient.js` must build relative `/api/*` URLs. It must not compile a direct Railway API public domain into browser auth requests.

Local Vite development may continue to use the Vite development proxy or an explicit development API base.

## Cookie rule

For the Railway same-origin gateway deployment:

- keep auth cookies host-only unless a deliberate custom-domain design supersedes this document;
- do not set `AUTH_COOKIE_DOMAIN` to a Railway service hostname;
- `sid` and `did` remain HttpOnly;
- `csrf` remains browser-readable for the double-submit/header flow;
- Secure cookies remain required in production.

## Security boundary

The frontend gateway is transport only. It MUST NOT:

- infer tenant access;
- authorize actions;
- calculate permissions;
- create or validate sessions;
- bypass API CSRF/origin checks;
- transform governed business payload semantics.

All such authority remains in `eip-v2-api`.

## Validation gate

A production auth deployment is not accepted until a private/incognito browser proves:

1. organisation lookup succeeds;
2. OTP request succeeds;
3. OTP verification succeeds;
4. session cookies are established on the frontend origin;
5. `GET /api/eip/auth/whoami` returns `200` immediately after strong authentication;
6. an authenticated state-changing request can obtain/send valid CSRF and does not fail solely because of cross-domain cookie isolation.
