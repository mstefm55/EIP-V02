# V1 -> V2 Reuse Matrix

Legend:
- `Keep`: can be carried with minimal structural change.
- `Adapt`: keep contract/shape, rework internals for V2.
- `Rewrite`: build clean V2 replacement; do not copy through.
- `Defer`: postpone until prerequisites are stable.

## Backend Port Sequence

Use this order once the V2 governance tables, DB baseline, and API shell are live:

1. `services/api/src/server.js`, `services/api/src/plugins/db.js`, and `services/api/src/routes/health.js` as the shell smoke-test layer.
2. `services/api/src/auth/**` and `services/api/src/routes/auth.js` as the first real policy-bound adapter.
3. `services/api/src/core/core_process_engine.js` and `services/api/src/routes/process/core_process.js` as the first business-flow port.
4. `services/api/src/routes/ui_surface.js` after process metadata and payload governance are stable.
5. `services/api/src/services/gateway/**` and `services/api/src/routes/public_gateway.js` only after secret-safe response shaping is implemented.

Do not move to the next step until its dependency notes are true in V2:

- Step 2 is blocked by missing shared auth/session context, tenant enforcement, or authoritative permission policy.
- Step 3 is blocked by missing process taxonomy, effect taxonomy, or idempotency/audit wiring.
- Step 4 is blocked by missing governed surface metadata or payload allowlists.
- Step 5 is blocked by any target-tenant leak, secret exposure, or weak public-response envelope.

No-drift rule:

- `Rewrite` remains the default for useful legacy code that crosses the V2 trust boundary.
- `Adapt` means preserve the contract, not the implementation style.
- `Keep` is limited to components that already match the V2 shell and policy model.

| V1 path / area | V2 action | Rationale | Dependency notes | Security notes | Kernel/engine compliance notes |
|---|---|---|---|---|---|
| `services/api/src/server.js` | Adapt | Good bootstrap structure; simplify and make V2 switchable cleanly. | Depends on plugin order and route registration map. | Preserve secure defaults, CSP, rate limits, CSRF hooks. | Compliant as kernel entrypoint when kept tenant-agnostic. |
| `services/api/src/plugins/db.js` | Adapt | Reusable DB plugin pattern with minor cleanup. | Depends on env schema and pool settings. | Avoid noisy config logging that may expose operational details. | Shared infrastructure component. |
| `services/api/src/routes/health.js` | Keep | Minimal operational endpoint pattern is reusable. | Depends on config flags and db plugin. | Ensure production-safe health exposure policy. | Infrastructure-only, no business drift. |
| `services/api/src/routes/auth.js` | Adapt | Keep route contract, move more logic to shared auth services. | Depends on auth primitives and session store. | Address password reuse and RNG weaknesses in V2 implementation. | Compliant when thin adapter over shared policy layer. |
| `services/api/src/auth/**` | Adapt | Valuable primitives with some correctness gaps. | Depends on crypto/session/auth schema. | Must harden password history, RNG, and consistency checks. | Kernel utility layer; keep centralized. |
| `services/api/src/authz/**` and `services/api/src/auth/perm.js` | Rewrite | Policy consistency must be made authoritative for V2. | Depends on role/permission tables and session context. | Critical for tenant-boundary and active-role enforcement. | Must be unified as single policy authority. |
| `services/api/src/core/core_process_engine.js` | Adapt | Strong kernel foundation; V2 needs tighter effect core and macro layer. | Depends on process defs, task templates, idempotency, dropdown governance. | Must enforce pre-effect authz and deterministic replay behavior. | Core kernel-compliant base with targeted evolution. |
| `services/api/src/routes/process/core_process.js` | Adapt | Good process contract and validation surface. | Depends on dropdown lists/effect taxonomy and engine core. | Validate all write inputs and idempotency consistently. | Engine-aligned if kept as thin contract adapter. |
| `services/api/src/routes/core_process.js` alias surface | Defer | Wrapper/alias only; decide after contract map is finalized. | Depends on final route namespace strategy. | Ensure no duplicate exposure surface. | Keep only if it does not fragment engine contracts. |
| `services/api/src/routes/ui_surface.js` | Adapt | Reusable UI surface delivery pattern. | Depends on `ui_surface` schema and renderer contracts. | Enforce payload allowlist and no secret leakage. | Engine-compliant if metadata-driven remains source-of-truth. |
| `services/api/src/routes/gateway.js` | Rewrite | Trust-boundary and tenant-target semantics need stricter redesign. | Depends on connection profile model and authz helpers. | Must enforce target-tenant authorization and secret-safe responses. | Partial drift from shared policy model in V1. |
| `services/api/src/routes/public_gateway.js` | Adapt | Inbound verification pattern is strong and reusable. | Depends on idempotency service and connection profiles. | Remove/avoid tenant attrs overexposure in public responses. | Good engine-style ingress boundary after hardening. |
| `services/api/src/services/gateway/**` | Adapt | Reusable integration service layer with strong potential. | Depends on profile schemas and outbound policy definitions. | Add stricter destination allowlist/SSRF protections and redaction. | Aligned if centralized as integration engine boundary. |
| `services/api/src/routes/ecom.js` | Rewrite | Contains lifecycle bypass and mixed domain responsibilities. | Depends on process bindings, material/service object links. | Must eliminate direct status mutation and unsafe content paths. | Drifted from process-engine-first in V1. |
| `services/api/src/routes/commerce_orders.js` | Adapt | Mostly process-driven; salvageable with policy cleanup. | Depends on process defs and order/payment contracts. | Harden permission and error semantics. | Near-compliant with engine model. |
| `services/api/src/routes/crm.js` | Adapt | Large module but many flows already engine-oriented. | Depends on process bindings and object models. | Validate tenant-boundaries and privilege actions consistently. | Good salvage candidate with controlled adaptation. |
| `services/api/src/routes/public_commerce.js` | Rewrite | High coupling of storefront logic and workflow concerns. | Depends on member auth, orders, content, gateway data. | Must rebuild with stricter boundary separation and sink safety. | Drifted due mixed concerns in shared route module. |
| `services/api/src/routes/admin_*.js` | Adapt | Contracts may remain; internals should move into governed services. | Depends on authz/admin policy and tenant access model. | High-privilege surface; tighten auditing and least privilege. | Compliant when thin and policy-driven. |
| `services/api/src/routes/tenant_*` | Adapt | Keep intent but harden tenant-scoped authorization model. | Depends on tenant admin/access policy design. | Critical isolation boundary; enforce explicit target checks. | Must remain tenant-safe and engine-governed. |
| `services/api/src/routes/edi*.js` | Adapt | Integration boundary useful if normalized under gateway policy model. | Depends on transport/security policy and channel mapping. | Preserve verification, idempotency, and payload redaction. | Compliant when treated as channel adapter. |
| `services/api/src/routes/privacy.js` | Adapt | Keep contract, rework internals for correctness and audit integrity. | Depends on info_record schema and process hooks. | Fix logging/schema mismatches and ensure secure data handling. | Compliant when policy-driven and process-aligned. |
| `services/api/db/migrations/0001-0038` core foundations | Adapt | Core schema intent is reusable, but V2 chain must be fresh. | Depends on ordered bootstrap and additive strategy. | Validate constraints for tenant isolation and secure defaults. | Good kernel foundation source material. |
| `services/api/db/migrations/0039+` domain-heavy migrations | Adapt/Rewrite | Selective salvage; several flows encode V1 drift. | Depends on domain-specific process/task evolution. | Reassess each migration for drift and security posture. | Keep only compliant parts in new chain. |
| `services/api/db/seed/**` | Adapt | Keep governed reference seeds; drop tenant-specific assumptions. | Depends on migration order and bootstrap profiles. | No secrets or debug defaults in seed payloads. | Useful only when governance-aligned. |
| `tools/validate_process_alignment.mjs` | Adapt | Good starting CI check; needs broader coverage in V2. | Depends on process seeds and UI action maps. | Add security and migration policy checks alongside. | Supports anti-drift if expanded. |
| `.github/workflows/validation.yml` | Rewrite | Current CI too narrow for V2 gate quality. | Depends on new test/security scripts. | Must include vulnerability and security policy gates. | Needed for enforceable architecture discipline. |
| `apps/dashboard/src/engine/renderer.jsx` | Keep | Core renderer pattern is aligned with UI engine direction. | Depends on stable component registry contracts. | Ensure safe rendering defaults and no unsafe sink regressions. | Strong UI engine primitive. |
| `apps/dashboard/src/hooks/useSurfaceLoader.js` | Adapt | Useful loading/caching pattern; tighten contract handling. | Depends on `ui_surface` API and ETag behavior. | Validate error handling and payload expectations. | Engine-aligned once governed strictly. |
| `apps/dashboard/src/engine/registry.jsx` | Adapt | Required registry, but needs stronger governance boundaries. | Depends on component map and versioning policy. | Block unsafe/unapproved component exposure. | Compliant when treated as controlled extension point. |
| `apps/dashboard/src/engine/surfaces/*.js` static fallbacks | Rewrite | Should not remain primary source-of-truth in V2. | Depends on DB-driven surface publishing model. | Avoid stale or hardcoded behavior drift. | Move to governed surface metadata path. |
| `apps/dashboard/src/components/admin/AdminProcessBuilder.jsx` | Adapt | Valuable UI tooling, but should consume stricter engine schemas. | Depends on process taxonomy endpoints and effect model. | Validate admin-only controls and unsafe input handling. | Engine tooling candidate after governance hardening. |
| `apps/samara-web/my-vite-react-app/src/App.jsx` monolith | Rewrite | High coupling and unsafe rendering paths; not suitable as V2 base. | Depends on many API contracts and local state patterns. | Contains critical XSS risk patterns; redesign required. | Non-compliant as reusable shared architecture. |
| `apps/samara-web/my-vite-react-app/src/services/api.js` | Adapt | Useful API-call map reference; re-implement with V2 contract client pattern. | Depends on public commerce/gateway contracts. | Enforce strict error handling, header policy, and safe defaults. | Can be adapted as storefront adapter layer only. |
| `apps/eip-landing/**` | Defer | Not core to kernel foundation work. | Depends on product/go-live priorities. | Apply baseline security standards when migrated. | Outside critical engine migration path. |
| `docs/PROCESS_V2_INTENT.md` and codex guardrail docs | Keep | Canonical architecture references for V2. | Depends on ongoing alignment updates. | Ensure contradictions are resolved early. | Directly aligned with kernel/engine direction. |
