# V1 -> V2 Partition Map

Purpose: classify V1 areas for controlled migration into V2.

## Baseline distribution (audit context)
- Keep as-is: ~32%
- Keep with adaptation: ~43%
- Rewrite: ~25%

These percentages are planning estimates and must be refined as V2 implementation progresses.

## Backend Port Order

Do not start real V1 -> V2 backend ports until these V2 prerequisites are in place:

- governed process taxonomy and permission policy are loaded from V2 metadata
- V2 DB baseline, tenant constraints, and seed chain are established
- API shell is live with a single bootstrap path, shared DB plugin, health endpoint, and canonical auth/session context

First safe backend ports after that gate:

1. `services/api/src/auth/**` and `services/api/src/routes/auth.js`
2. `services/api/src/core/core_process_engine.js` and `services/api/src/routes/process/core_process.js`
3. `services/api/src/routes/ui_surface.js`
4. `services/api/src/services/gateway/**` and `services/api/src/routes/public_gateway.js` only after secret-safe response rules exist

Blocked until later:

- `services/api/src/routes/gateway.js` because target-tenant auth and response redaction are not yet canonical
- `services/api/src/routes/public_commerce.js` because it still mixes storefront behavior with workflow decisions
- any permission-sensitive route that depends on a second, page-local policy layer

No-drift rule:

- useful but architecturally wrong code stays `Rewrite`, even if it is operationally handy
- `Adapt` means preserve the contract shape only; do not copy legacy branching or direct state mutation
- `Keep as-is` is reserved for behavior that already matches the V2 trust boundary and engine model

## Partition table

| Area / module group | Classification | Why |
|---|---|---|
| `services/api/src/server.js` | Keep with adaptation | API shell bootstrap must stay thin, with V2 route/plugin registration and secure defaults. |
| `services/api/src/plugins/db.js` | Keep with adaptation | Shared DB bootstrapping is a prerequisite for all backend ports; keep the contract, clean the internals. |
| `services/api/src/routes/health.js` | Keep as-is | Minimal shell endpoint; safe to use as the first smoke test for V2 boot. |
| `services/api/src/routes/auth.js` | Keep with adaptation | Thin adapter over shared auth/session policy; must not own policy logic. |
| `services/api/src/auth/**` | Keep with adaptation | Valuable primitives, but they need V2 consistency and policy hardening before use. |
| Core process engine primitives (`services/api/src/core/core_process_engine.js`) | Keep with adaptation | Strong kernel base; needs V2 effect-core tightening and macro/composite layer. |
| Process definitions/routes (`services/api/src/routes/process/core_process.js`) | Keep with adaptation | Good taxonomy validation; align to V2 execution/error contracts. |
| Process taxonomy/dropdown governance (migrations and metadata) | Keep as-is | Already aligned with governed metadata direction. |
| UI surface persistence/fetch foundation (`ui_surface` table + route) | Keep with adaptation | Strong engine direction; needs stricter payload governance and safe exposure boundaries. |
| Auth/session/CSRF primitives | Keep with adaptation | Good baseline controls; tighten consistency and policy gaps. |
| Multi-tenant core schema conventions (`tenant_id` discipline, relational core) | Keep as-is | Reusable foundation for V2 DB and service boundaries. |
| Gateway inbound architecture pattern (verification/idempotency/audit) | Keep with adaptation | Good structure, but enforce stricter tenant/secret response controls. |
| Gateway/public response shaping | Rewrite | Current exposure and trust-boundary issues require clean V2 contract enforcement. |
| Permission consistency layer (`hasPermission` behavior and active-role consistency) | Rewrite | Needs single authoritative policy semantics and strict active-state handling. |
| Ecom/storefront lifecycle segments with direct status mutation | Rewrite | Architecturally drifted from process-engine-first rule. |
| CRM/commerce flows already using process transitions | Keep with adaptation | Mostly salvageable; align with V2 policy and error contracts. |
| Dashboard engine runtime (loader/renderer) | Keep with adaptation | Reusable skeleton; reduce hardcoded fallback coupling. |
| Static/hardcoded dashboard surface definitions | Rewrite | Should be replaced by governed DB surface source-of-truth flows. |
| Samara storefront monolithic rendering and unsafe sink areas | Rewrite | High drift and security risks; avoid direct carryover. |
| Admin utility routes with high privilege and broad coupling | Keep with adaptation | Keep contracts where needed, refactor to shared policy services. |
| V1 migration chain (`0001...`) as sequence | Rewrite (for V2 chain) | V2 must start fresh numbering; V1 migrations remain reference only. |
| V1 migration content (core kernel tables/governance intent) | Keep with adaptation | Reuse intent selectively in new V2 migration chain. |
| Seed data bundles | Keep with adaptation | Reuse governed reference seeds; drop tenant-specific or drifted defaults. |
| Security posture as currently implemented | Rewrite + adapt mix | Keep good primitives; rewrite weak paths (XSS, exposure, inconsistent authz checks). |
| CI/quality system (current minimal validation) | Rewrite | Needs full test/security gate model for V2. |
| Documentation canon (refined codex rules + process intent) | Keep as-is | Use as V2 constitutional baseline; resolve contradictions in carryover docs. |

## Unknown bucket (must validate before migration)

| Area | Why unknown | Required validation |
|---|---|---|
| Edge/debug artifacts and route remnants | Runtime usage unclear from static scan alone | Route-map + runtime trace + ownership decision |
| Legacy/generated output artifacts under public/report folders | Could be build artifacts, not source architecture | Build pipeline provenance check |
| Low-visibility helper scripts and ad hoc reports | Unclear operational dependency | CI usage check + deployment script audit |

## Partition rules
- `Keep as-is` does not mean copy blindly; it means behavior is architecturally aligned.
- `Keep with adaptation` requires explicit delta notes before code porting.
- `Rewrite` means no direct module copy into V2 source.
- `Unknown` blocks migration until validated.
