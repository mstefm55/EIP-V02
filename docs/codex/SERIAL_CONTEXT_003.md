# SERIAL_CONTEXT_003

## Title
Process engine / task engine continuity

## Purpose
This file preserves continuity for process modeling, task taxonomy, and effect design so V2 does not drift from the kernel intent.

## Kernel center
- Service object is the kernel concept of managed work.
- Service object must be understood at two levels simultaneously: conceptual global kernel unit and operational case instance.
- Business classes include agent/entity, asset, material, document, and money.
- When any of those becomes the subject of an active workflow, it is represented as a service object.

## Process, task, effect model
- Canonical 5 layers:
  1. process definition
  2. task label
  3. macro
  4. effect library
  5. service object + service object category runtime parameters
- The process engine acts on service objects and executes transitions/effects.
- Process transitions drive effects and produce tasks or state changes.
- Task labels are human/business-facing and may vary by tenant.
- Effects are reusable engine capabilities such as Create, CreateChild, Fetch, Update, or InventoryAmend.
- Prefer generic effect codes with resolved runtime metadata over one hardcoded function per semantic instance.
- Macro status in current V2: first-class runtime resolution through governed `graph.macros` bundles plus explicit transition `macro_code`.
- Hidden transition bundles are disallowed when `macro_code` is present.
- Inline-compat execution fallback is removed; transitions are required to use explicit macro references.
- The API/service layer resolves concrete values and governed metadata for execution.
- Field headers used for validation and structure should come from governed metadata or approved dropdown tables.
- Avoid task-list explosion by composing reusable effects with service object type and service object category.

## Direction lock
- Preserve kernel-first, engine-based, multi-tenant, and metadata-driven direction.
- Business lifecycle changes must go through the process engine; do not bypass it with direct status mutation in runtime flows.
- Readiness is not route-mount readiness. Process readiness requires DB-driven process authority, engine-backed execution, and governed UI-surface representation where applicable.
