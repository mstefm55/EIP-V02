# V2 Transfer Rules

These rules govern any transfer of successful V1 work into EIP Core V2.

## Authority

Codex is the architecture and integration authority for V2 transfer work. No UI output, generated code, imported V1 code, or third-party generated artifact is accepted without drift and security review.

## Transfer principles

- Successful V1 work may be transferred only when it aligns with strict V2 kernel/process/UI-engine principles.
- V2 remains process-driven, not module-driven.
- V2 remains UI-engine-driven, not screen-by-screen hardcoded.
- Metadata is the governing source wherever possible.
- Routes and React screens must not contain hidden business authority.
- No V1 module may be copied blindly.

## Candidate transfer areas

- Content Studio Enhanced may be revisited, but only as a UI-engine/content-engine-driven capability.
- Login and security hardening may be transferred carefully after checking secrets, session posture, CSRF, CORS, authorization, audit, and response-boundary behavior.
- Process handlers, taxonomy, effect library, and document handling must be audited before transfer.
- Any Google AI Studio UI output must be reviewed by Codex before integration.

## Required review before acceptance

Every transfer must answer:

1. Does the kernel/process/task/macro/effect/service-object model already represent this?
2. Is business meaning stored in governed metadata rather than hidden in a route or React screen?
3. Does the UI render through the V2 UI engine or an approved primitive/composite path?
4. Does the change preserve tenant isolation and deny-by-default authorization?
5. Does the change avoid raw secrets, private DB rows, and unbounded payloads crossing API boundaries?
6. Does the change add any table? If yes, is it justified in `docs/db/NEW_TABLE_JUSTIFICATION_REGISTER.md` and checked against `docs/db/V2_MIGRATION_CHECKLIST.md`?

If any answer is unclear, stop and document the gap before implementation.
