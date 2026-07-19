# TASK_EFFECT_MODEL

This document defines the canonical 5-layer process model for EIP Core V2.

## 5-layer model
1. Process: control-flow definition (states, transitions, guards).
2. Task label: human/business-facing wording (tenant/organization specific).
3. Macro: reusable execution bundle attached to lifecycle intent.
4. Effect library: standardized reusable engine capabilities.
5. Service object + service object category: runtime parameters passed into execution.

These layers are complementary and must be modeled together.

## Macro runtime model in current V2 baseline
- Macro is first-class and governed at runtime through `process_def.graph.macros`.
- Transition execution resolves `macro_code` first, then executes the macro's effect bundle explicitly.
- Process history records `macro_code`, `macro_source`, and resolved macro parameters for auditability.
- No inline transition-effect compatibility path remains in runtime.
- Transition-level inline effect ownership is not allowed.

## Effect model
- Effects are reusable engine actions (examples: `CREATE`, `CREATE_CHILD`, `FETCH`, `UPDATE`, `INVENTORY_AMEND`).
- Canonical executable instance naming may follow `ServiceObjectType_Effect_ServiceObjectCategory`.
- Example names are semantic governance patterns only; implementation remains generic via effect codes plus resolved runtime metadata.
- Do not create one hardcoded function per semantic instance.
- Effect catalog governance is anchored in dropdown metadata (`PROCESS_EFFECT_TYPE`).
- Alias/canonical mapping is metadata-driven through `dropdown_value.attrs.canonical_effect_code` (for example `API_CALL -> HTTP_REQUEST`).
- Runtime dispatch handlers remain in code, but effect authority (`active`, `canonical`, minimum parameter contract) is governed in metadata.

## Runtime resolution rule
- API/service layer resolves concrete values, governed metadata, and tenant context.
- Field headers used for validation and full-structure assembly must come from governed metadata (dropdown tables and approved metadata contracts).
- Process-definition validation forbids hidden transition effects when `macro_code` is present.
- Routes expose transport endpoints; they must not become hidden workflow engines.
- Service object type/category governance uses dropdown metadata (`SERVICE_OBJECT_TYPE`, `SERVICE_OBJECT_CATEGORY`).
- Document governance stays kernel-aligned through service objects plus governed document metadata (`DOCUMENT_CATEGORY`, `DOCUMENT_HEADER_KEY`), not route-local hardcoding.

## Anti-task-explosion rule
- Do not multiply bespoke task definitions for each business variant.
- Compose reusable effects with service object type and service object category.
- Keep lifecycle mutation under process engine authority.
