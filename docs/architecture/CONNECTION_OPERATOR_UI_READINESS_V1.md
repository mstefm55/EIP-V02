# Connections Operator UI Readiness V1

## Status

This document records the final operator-facing readiness boundary for the EIP Core V2 Connections control plane.

The Connections runtime is provider-capable and tenant-governed. The Owner Admin UI must expose the existing runtime without creating provider-specific React authority or a second integration engine.

## Operator journey

The canonical seven-step journey remains:

1. Identity
2. Endpoint
3. Security
4. Reliability
5. Routing & Mapping
6. Test & Health
7. Audit

The target tenant is selected by tenant code in metadata-driven UI and resolved to tenant identity by the API. Browser-supplied `tenant_id` is not authority.

New connections are created as disabled drafts. The server allocates the `conn-<serial>` code. Activation is only available after persistence and remains blocked until server readiness rules pass.

## Security configuration

Security fields must have one operator control per live runtime parameter. Earlier duplicate aliases are retired from the rendered surface. Credentials remain write-only and are stored through the encrypted Connection secret lifecycle.

Supported outbound authentication configuration remains provider-neutral:

- none
- bearer token
- API key header
- API key query parameter
- Basic authentication
- OAuth2 client credentials

Inbound verification remains limited to live verification modes, including governed provider signatures where implemented.

## Test & Health

Test & Health separates four different operator questions:

- **Connection readiness** — is activation configuration complete for the selected tenant and connection?
- **Endpoint health check** — is the configured outbound endpoint reachable?
- **Authenticated request test** — what request will EIP send, and can the enabled connection execute it with the configured authentication?
- **Inbound endpoint** — what live tenant-qualified inbound URL should the external system call?

Request preview uses the governed request-plan contract and does not expose secret values. Live request testing uses the governed execute contract, dedicated TEST permission, CSRF, tenant resolution, encrypted credentials, SSRF/DNS-pinning controls, bounded response handling and the connection enabled-state guard.

## UI authority

The UI remains metadata-driven:

- generic `ContractFlowStepEditor` for connection fields
- generic `ContractActionPanel` for readiness, health, secret lifecycle and request tests
- no Stripe-specific or PayPal-specific React component
- no browser-owned tenant ID
- no plaintext secret projection

Provider-specific behavior is selected through governed metadata and consumed by the server runtime.

## Closure criteria

Operator UI readiness is complete when production has applied `v2_0061_connection_operator_ui_readiness.sql`, governance gates are green, the frontend/API deployment is healthy, and an operator can perform the seven-step flow for a real tenant without duplicate Security inputs.
