# ARCHITECTURE_GUARDRAILS

This document is the architectural constitution for EIP Core V2.

## 1. Foundational direction
- EIP Core V2 is kernel-first.
- EIP Core V2 is engine-first: process engine, task/workflow engine, and UI/rendering engine remain the primary implementation surfaces.
- EIP Core V2 is multi-tenant.
- EIP Core V2 is governed: metadata, schema, and configuration should drive behavior whenever possible.

## 2. Kernel canon
- The kernel defines managed work through reusable concepts, not feature-specific exceptions.
- Service object is the canonical unit of managed work in the kernel.
- The same service object exists at two abstraction levels: conceptual kernel concept and operational case instance.
- Those levels are the same concept viewed differently, not two unrelated entities.
- Business classes such as agent/entity, asset, material, document, and money may support, execute, constrain, or record a process.
- Any of those classes may become the active case and therefore be represented as a service object.

## 3. Process, task, effect model
- Canonical layered model:
  1. process (control-flow definition)
  2. task label (human/business-facing wording)
  3. macro (reusable execution bundle)
  4. effect library (standardized reusable engine actions)
  5. service object + service object category (runtime execution parameters)
- The process engine acts on service objects and executes lifecycle transitions.
- Task labels may vary by tenant or organization; execution logic must remain generic.
- Effects are reusable engine capabilities, not bespoke task implementations.
- Prefer effect composition over one-off task definitions.
- Avoid task explosion by composing reusable effects with service object type and service object category.
- Canonical instance naming may follow `ServiceObjectType_Effect_ServiceObjectCategory`.
- Implementation must remain generic: use effect codes plus runtime metadata to resolve concrete execution context.
- Do not create a unique hardcoded function for each semantic instance.
- Macro status in the current baseline: explicitly governed in `process_def.graph.macros`; transitions invoke `macro_code`, and macro bundles invoke effects.
- Hidden transition effect bundles are forbidden.
- Effect catalog authority must remain metadata-governed (`PROCESS_EFFECT_TYPE`), including canonical alias mapping (`canonical_effect_code`) and minimum parameter contract metadata.
- Runtime handler dispatch may remain in code, but catalog semantics must not be redefined as hidden JS authority.
- Business lifecycle changes must go through the process engine; do not bypass it with direct runtime status mutation.

## 4. Multi-tenant rule
- Shared code must remain tenant-agnostic.
- Tenant-specific behavior belongs in tenant configuration, metadata, approved extension points, or tenant-level assets.
- Do not hardcode tenant assumptions into shared kernel, engine, or studio code.

## 5. Data modeling rule
- Use relational modeling for core governed structures.
- Use JSONB for flexible, extensible, object-specific, or tenant-specific payloads where appropriate.
- Do not use JSONB as a shortcut to avoid governing core data.
- Prefer existing tables, attrs, statuses, bundles, and governed extension points before adding schema.
- Field headers and validation keys should be governed metadata, not ad hoc literals.
- Service object type/category and document keys should be governed through dropdown metadata (`SERVICE_OBJECT_TYPE`, `SERVICE_OBJECT_CATEGORY`, `DOCUMENT_CATEGORY`, `DOCUMENT_HEADER_KEY`).
- New tables are allowed only when clearly required for kernel integrity, engine integrity, tenant isolation, security hardening, or migration authority.
- A new table is forbidden when a simpler adaptation of existing governed structures is sufficient.
- Every new or proposed table must be recorded in `docs/db/NEW_TABLE_JUSTIFICATION_REGISTER.md`.
- Weakly justified table proposals must be marked `deferred` and not created.

## 6. UI rule
- Shared UI must stay adaptable and engine-driven.
- Avoid page-specific hardcoding where metadata, workflow definition, or service response should drive behavior.
- Keep UI ownership explicit:
  - code-owned whitelisted primitives/renderer
  - metadata-owned composition and labels
  - server-owned business/process/security authority
- Keep UI metadata tenant-scoped and realm-scoped in discovery/load paths.
- Surface cache keys must include tenant + realm + surface_code + version/etag; memory cache first.
- Never treat metadata as executable code.

## 7. Backend rule
- Preserve existing Fastify patterns and security controls.
- Use explicit machine-readable responses.
- Validate external-service requests and responses.
- Do not expose secrets to frontend.

## 8. Change control rule
Before adding a table, endpoint, UI flow, or major abstraction, ask:
1. Can the kernel already represent this?
2. Can an existing engine handle it?
3. Can metadata or configuration express it?
4. Can existing schema or governed JSONB absorb it?

If yes, reuse the existing architecture.

For any new table, explicitly verify:
1. It does not undermine the service object kernel concept.
2. It does not bypass the process/task/effect model.
3. It does not introduce hardcoded business-specific workflow drift.

## 9. Anti-patterns
- Hardcoded tenant logic in shared code
- Hardcoded flows that bypass the process or task engines
- Page-level logic that replaces reusable rendering behavior
- Unnecessary schema proliferation
- Duplicate data structures for convenience
- Feature shortcuts that reduce future extensibility

## 10. Default implementation order
1. Reuse existing kernel behavior
2. Reuse or extend engine behavior
3. Reuse metadata/configuration-driven rendering
4. Reuse existing schema or JSONB extension points
5. Add minimal new code only when the above are insufficient

## 11. Conflict rule
- If speed conflicts with architecture, preserve architecture.
- If convenience conflicts with kernel-first, engine-based, or multi-tenant consistency, preserve consistency.
