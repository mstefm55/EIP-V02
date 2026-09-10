# Connection Execution Capability V1

Status: implementation contract for completing the HTTP/API/Webhook Connections capability.

Read with:

- `docs/codex/ARCHITECTURE_GUARDRAILS.md`
- `docs/architecture/CONNECTION_MANAGEMENT_UI_V2.md`
- `SECURITY_TARGET.md`

## 1. Completion rule

A Connection parameter is not considered supported merely because it can be stored.

For every supported integration parameter there must be a complete route through the system:

```text
provider/manual parameter
  -> governed configuration input or runtime operation input
  -> validation
  -> stored non-secret metadata / encrypted credential / bounded runtime value
  -> an implemented runtime function that consumes it
  -> regression evidence
```

Parameters that vary per API operation belong to the runtime request input and later Process Studio effects. Parameters that describe the relationship with the remote system belong to the Connection profile. Credential values belong only to the encrypted Connection secret lifecycle.

This separation prevents the Connections UI from becoming an API-development console while keeping the runtime capable.

## 2. Generic outbound execution function

The reusable runtime authority is `executeGovernedConnectionRequest(...)`, backed by `executeConnectionRequest(...)`.

Bounded operation input:

| Parameter | Runtime input | Consumer |
| --- | --- | --- |
| HTTP method | `request.method` | `normalizeMethod` / transport |
| relative resource path | `request.path` | `buildOutboundRequestUrl` |
| query parameters | `request.query` | `normalizeQuery` / URL builder |
| per-request headers | `request.headers` | `normalizeHeaderMap` |
| request body | `request.body` | `serializeRequestBody` |
| request body format | `request.body_encoding` | `serializeRequestBody` |
| content type | `request.content_type` | request-plan builder |
| Accept | `request.accept` | request-plan builder |
| response format | `request.response_encoding` | `decodeResponseBody` |
| idempotency key | `request.idempotency_key` | request-plan builder / retry guard |

Persistent connection input:

| Parameter | Profile input | Consumer |
| --- | --- | --- |
| API origin | `outbound.base_url` | outbound URL builder + SSRF policy |
| common path | `outbound.path_prefix` | outbound URL builder |
| static non-secret headers | `outbound.default_headers` | request-plan builder |
| auth mode | `outbound.auth_mode` | `applyOutboundAuthentication` |
| API-key header/query name | `outbound.auth.header_name` / `query_param_name` | authentication handler |
| Basic username | `outbound.auth.username` | Basic handler |
| OAuth client ID | `outbound.auth.client_id` | OAuth token handler |
| OAuth token endpoint | `outbound.auth.token_url` | OAuth token handler + SSRF policy |
| OAuth scope | `outbound.auth.scope` | OAuth token body builder |
| timeout | `outbound.timeout_ms` | transport |
| retries/backoff | `outbound.retry_policy.*` | execution loop |
| default request/response formats | `attrs.outbound_request.*` | effective runtime profile / request planner |
| OAuth client-auth/body/extra params | `attrs.oauth_client_credentials.*` | OAuth token handler |

Supported request body representations are JSON, URL-encoded form data, text and base64-decoded binary. GET/HEAD bodies are rejected. Response bodies are bounded and can be decoded automatically, as JSON, as text or as base64.

## 3. Credential mapping

Credential values never enter profile metadata or normal response DTOs.

| Auth/verification mode | Encrypted secret kind | Consumer |
| --- | --- | --- |
| bearer | `bearer_token` | outbound authentication handler |
| API key header/query | `api_key` | outbound authentication handler |
| Basic username/password | `basic_password` | outbound authentication handler |
| OAuth2 client credentials | `oauth_client_secret` | OAuth token exchange |
| inbound API key | `api_key` | inbound verifier |
| inbound generic HMAC | `hmac_secret` | inbound verifier |
| Stripe provider signature | `webhook_signing_secret` | Stripe verifier |

Secret lifecycle remains tenant scoped, encrypted with AES-256-GCM, independently versioned, rotatable and revocable.

## 4. Transport/security behavior

Outbound execution reuses the V2 external HTTP safety boundary:

- only HTTP/HTTPS URL schemes;
- no embedded URL credentials;
- DNS resolution and pinned approved addresses;
- loopback, private, link-local and reserved destinations rejected;
- relative operation paths cannot override the configured host;
- caller-supplied Authorization, Cookie, Host and transport-controlled headers rejected;
- redirects are returned but never followed automatically;
- request and response sizes bounded;
- timeout bounded;
- retries bounded;
- non-idempotent requests are retried only when an idempotency key is supplied;
- credential values are never returned in request plans or execution results.

The Owner Admin request-plan action may inspect the resolved non-secret plan on a disabled draft. Actual `/execute` requires the Connection to be enabled and is protected by `OWNER_ADMIN_CONNECTION_TEST` plus CSRF. The same runtime function is reusable by Process Studio/effects without making the browser the execution authority.

## 5. PayPal reference proof

The PayPal simulation exercises the parameter classes required for a standard REST connection:

| PayPal requirement | EIP input/function |
| --- | --- |
| sandbox/live API base URL | `outbound.base_url` -> URL builder |
| OAuth client ID | `outbound.auth.client_id` -> OAuth exchange |
| OAuth client secret | encrypted `oauth_client_secret` -> OAuth exchange |
| token URL | `outbound.auth.token_url` -> safe transport |
| client-credentials grant | OAuth runtime defaults `grant_type=client_credentials` |
| HTTP Basic client authentication | `client_auth_method=basic` -> OAuth header builder |
| URL-encoded token body | `token_body_encoding=form` -> body serializer |
| optional scope/extra non-secret token params | `outbound.auth.scope` / `token_params` -> token body builder |
| bearer access token on API request | OAuth response -> authentication handler |
| resource path | runtime `request.path` |
| query | runtime `request.query` |
| PayPal request/partner headers | runtime/static safe headers |
| JSON request body | runtime `request.body` + JSON encoding |
| PayPal request ID | configured idempotency header + runtime idempotency key |
| JSON response | bounded response decoder |

### PayPal webhook verification

`provider_signature=paypal` consumes:

- `PAYPAL-TRANSMISSION-ID`;
- `PAYPAL-TRANSMISSION-TIME`;
- `PAYPAL-CERT-URL`;
- `PAYPAL-AUTH-ALGO`;
- `PAYPAL-TRANSMISSION-SIG`;
- configured Webhook ID;
- exact raw webhook body.

The verifier restricts certificate retrieval to HTTPS PayPal hosts, uses the shared SSRF-safe transport, constructs the PayPal signed message from transmission ID/time, Webhook ID and CRC32 of the raw event, and verifies RSA-SHA256 locally.

## 6. Stripe reference proof

The Stripe simulation exercises:

| Stripe requirement | EIP input/function |
| --- | --- |
| API base URL | `outbound.base_url` -> URL builder |
| API key | encrypted credential -> bearer authentication handler |
| HTTPS | external HTTP safety policy |
| API resource path | runtime `request.path` |
| URL-encoded form body | runtime/profile body encoding -> serializer |
| nested/bracket form parameter names | generic form-key input |
| API-version/Connect/custom headers | runtime/static safe headers |
| Idempotency-Key | runtime idempotency key -> configured/default header |
| JSON response | bounded response decoder |

Stripe documents bearer authentication as an alternative to HTTP Basic authentication. V2 therefore does not require a Stripe-specific outbound auth branch.

### Stripe webhook verification

`provider_signature=stripe` consumes:

- exact raw webhook body;
- `Stripe-Signature` (or configured signature-header name);
- encrypted `webhook_signing_secret`;
- configured timestamp tolerance.

The verifier parses the timestamp and all `v1` signatures, validates timestamp tolerance, signs `timestamp.raw_body` with HMAC-SHA256 and compares signatures using timing-safe equality.

## 7. UI rule

The existing seven-step Connections journey remains unchanged.

Frequently used fields stay visible. Low-frequency execution/provider parameters are Advanced metadata fields. Generic React primitives do not contain PayPal or Stripe branches. Provider-specific verification behavior is server-side and selected through governed metadata.

Do not place implementation explanations, architecture notes or developer guidance in the production UI. Such detail belongs in this document and tests.

## 8. Deliberate boundary

Connections owns **how EIP communicates** with a system.

Connections does not own business operations such as "create PayPal order", "capture payment" or "create Stripe PaymentIntent". Those operation paths, bodies and response mappings are runtime inputs that Process Studio/effects will supply to the generic executor.

This is not a capability limitation: the transport has inputs for method, path, query, headers, body, content type, response handling and idempotency. Keeping operation semantics outside Connections prevents provider-specific CRUD and workflow logic from accumulating in the control plane.

## 9. Acceptance evidence

Required regression evidence before merge:

1. generic request-plan coverage for every runtime input;
2. SSRF/path/header negative tests;
3. PayPal OAuth2 token-exchange + API-call simulation with no external credentials;
4. Stripe authenticated form-request + idempotency simulation with no external credentials;
5. retry behavior for idempotent and non-idempotent requests;
6. Stripe provider-signature positive/negative tests;
7. PayPal provider-signature positive/negative/certificate-boundary tests;
8. activation readiness tests for provider and OAuth credential requirements;
9. DTO/input-policy tests proving safe configuration round-trip and secret rejection;
10. route tests proving TEST permission, CSRF and server-resolved target-tenant scope;
11. UI/migration governance tests proving Advanced-only capability expansion and no provider-specific React branching.
