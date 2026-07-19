# WAVE_4_5_MACRO_RUNTIME_CLOSEOUT

Date: 2026-03-28

## Scope
- Eliminate macro-runtime caveat from the 5-layer process model.
- Keep process authority DB-driven and route-agnostic.
- Preserve generic effect library and service object canon.

## Before
- Macro intent existed as transition metadata (`macro_code`) but runtime execution still depended on transition-local effect bundles.
- Macro resolution was not a first-class engine step.

## Now
- Engine explicitly resolves transition `macro_code` from governed `process_def.graph.macros`.
- Macro executes effects as an explicit runtime step before transition completion.
- Process history now records `macro_code`, `macro_source`, and resolved macro params.
- Graph validation now rejects hidden transition effects when `macro_code` is present.
- Ecom seeded process definitions are upgraded to explicit graph macro registries (`v2_0010`).

## Compatibility
- Legacy inline transition definitions are migrated to explicit macro-governed definitions.
- Inline-compat runtime fallback has been removed.
- Transition execution now requires explicit `macro_code` + governed macro registry effects.
