# DRIFT_CLOSURE_0010

Date: 2026-03-28

Superseded for macro-runtime closure by: `docs/codex/WAVE_4_5_MACRO_RUNTIME_CLOSEOUT.md`

## Why drift entered
- Route-level readiness was over-weighted: mounted endpoints were treated as process readiness even when lifecycle authority was not fully DB-driven.
- Macro layer intent existed but was left implicit and under-documented, creating ambiguity in process/task/effect discussions.
- Ecom readiness was inferred from module migration progress rather than from seeded process definitions and governed UI-surface metadata.
- Service-object terminology was mostly correct but process canon was not consistently expressed as a strict 5-layer model.

## What is corrected in this round
- Process-instance creation can now resolve definitions through governed `eip_core.process_binding` when no explicit process def/code is passed.
- Ecom process authority is seeded through V2 migrations (`v2_0008`) with governed process actions/statuses, process defs, and bindings.
- UI engine metadata plane is now explicit (`eip_core.ui_surface`) with seeded ecom demonstration surfaces (`v2_0009`).
- API surface routes expose governed UI metadata; they do not own lifecycle mutation logic.
- Canon docs now state the 5-layer model directly and consistently, including current macro status.

## Macro status decision
- Current status: macro is explicit in metadata (`macro_code`) and implicit in runtime expansion through transition effect bundles.
- This is deliberate for current consolidation: no route-level macro execution layer is introduced.
- Planned evolution remains a governed macro registry when needed, without bypassing process-engine authority.

## Remaining non-blocking follow-up
- Add dedicated macro registry only when governance requirements exceed transition-bundle metadata.
- Add end-to-end UI renderer integration in V2 frontend waves while keeping surface metadata authority in DB.
