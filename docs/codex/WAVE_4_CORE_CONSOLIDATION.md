# WAVE_4_CORE_CONSOLIDATION

Date: 2026-03-28

Macro-runtime caveat from this wave is closed in `docs/codex/WAVE_4_5_MACRO_RUNTIME_CLOSEOUT.md`.

## Scope
- Close route-readiness drift and enforce DB/engine authority.
- Seed ecom process definitions as the core demonstration path.
- Add governed UI-surface metadata plane and exposure routes.
- Keep lifecycle authority in process engine, not in routes.

## Implemented
- `createInstance` now supports DB-driven process resolution via `eip_core.process_binding` when explicit process refs are omitted.
- Process instance create route accepts binding-driven startup (explicit process refs optional).
- Ecom process/taxonomy seeds added in `v2_0008`.
- UI surface table + ecom surface seeds added in `v2_0009`.
- Public/authenticated UI surface metadata routes added.
- Canon docs updated to explicit 5-layer model with macro status.

## Canon decision
- At this wave checkpoint macro was metadata-explicit; runtime hardening is completed in the follow-up wave noted above.

## Drift closure
- See `docs/codex/DRIFT_CLOSURE_0010.md` for root cause and closure detail.
