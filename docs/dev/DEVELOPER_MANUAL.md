# DEVELOPER_MANUAL

## Purpose

Implementation guardrails for contributors working on V2 runtime code.

## Documentation Maintenance Rule

- This file is a living system record, not a static guide.
- Every completed wave must update:
  - `V2 Progress Record` (what changed)
  - `Full System Explanation` (how the live architecture now works)
- A wave is not complete until this update is done.

## V2 Progress Record (Living)

Last updated: 2026-04-06

1. `v2_0001` to `v2_0003`
- Kernel/bootstrap schemas established (`kernel`, `tenant`, `security`).
- Tenant membership and tenant settings foundations added with RLS.

2. `v2_0004`
- Auth shell foundations added (`eip_auth.auth_identity`, `eip_auth.auth_credential`, `eip_auth.auth_session`).

3. `v2_0005` to `v2_0007`
- Process schema core added (service object, process/task runtime, dropdown governance).
- Auth identity-to-agent bridge added.

4. `v2_0008` to `v2_0012`
- Ecom process seed and process-engine governance strengthened.
- Macro runtime governance made explicit; inline transition-effect fallback removed.
- Effect/service-object/document governance lists standardized.

5. `v2_0009` and `v2_0013` to `v2_0016`
- UI surface governance plane established in DB.
- Workbench surfaces migrated toward generic primitive composition.
- Definition studio ownership decomposed away from runtime-specific composites.

6. `v2_0017` to `v2_0018`
- Owner-admin shell/theme separated from `ui_surface` composition.
- `ui_surface` reduced to composition + shell profile reference (`attrs.shell_profile_code`).

7. `v2_0019`
- Production lifecycle model for shell profiles added:
  - profile identity table
  - revision/lifecycle table (`draft`, `published`, `archived`)
  - append-only event/audit table
  - published runtime view
  - draft/publish/rollback DB functions
- Runtime resolver updated for governed selection hierarchy + tenant override layering.
- Surface ETag/Last-Modified now include shell lifecycle token (`theme_version_token`) for cache-safe invalidation.

8. Local staging secure-access hardening (no new migration)
- Staging gateway default moved from `http://localhost:8080` to `https://localhost:8443` with loopback host binding.
- Gateway now auto-generates local TLS cert/key via OpenSSL when missing (or fails with explicit instructions).
- Staging smoke password defaults/examples are policy-compliant; seed script now fails with explicit actionable messaging for placeholder/weak values.
- UI API client default is now same-origin (`/api/...`) with Vite dev proxy for local dev, keeping staging single-origin and reducing cross-origin drift.
- Staging smoke/test defaults now target secure origin and assert cookie `Secure` flag according to protocol.

9. Workbench request-loop + light shell stabilization (`v2_0020`)
- UI renderer now memoizes sanitized surface payloads so node/props references stay stable between unrelated rerenders.
- Primitive contract editors/tables were hardened to avoid effect/refetch churn from unstable prop identities.
- Owner-admin shell profile payloads were refreshed to a light baseline and dark hero background fallback was removed.
- Shell fallback tokens in API runtime were aligned with the light profile baseline.

10. V1-auth-layout login refresh (no migration)
- Workbench login page was restyled to mirror the V1 auth-screen structure (header + hero + glass login card) while keeping V2 credentials and flow.
- Typography was aligned to the V1 stack (`Montserrat` + `Comfortaa`) and the page kept on the EIP light palette.
- Smoke tests were updated for the new login heading and hardened for the New Definition draft-state timing race.

11. Universal workbench UX refinement (`v2_0021`)
- Process workbench metadata composition now uses a unified tabbed right panel (`Tabs` primitive) for templates/bindings/instances.
- Shell navigation now presents process workbench as one universal builder entry with module profiles handled as metadata-backed tabs.
- Table ergonomics now include per-page controls, pager actions, sticky table headers, and improved horizontal/vertical scroll behavior.
- Shell behavior was tightened with sticky/fixed-style header behavior, improved collapse interaction, and a stronger profile/session dropdown modal.
- Loading flash behavior was reduced by suppressing noisy loading notices when cached/previous data is already present.

12. V1 UX salvage + runtime-stability closure (no migration)
- Process table/data primitives were further stabilized to avoid request-loop churn caused by callback/effect dependency coupling.
- Definition editor now includes a guided transition designer (metadata-configurable) that edits transition JSON through safe primitive controls instead of raw JSON-only workflow.
- Loading notices were kept fail-informative but reduced for non-empty states to cut UI flicker during selection/surface churn.
- Universal process-builder direction remains enforced through metadata + one process-builder entry with module profile tabs.

13. Admin shell UX consolidation + form-first editor cleanup (no migration)
- Header is now full-width and dominant, with compact V2 EIP branding moved from sidebar to header.
- Sidebar now starts below the header, with tighter spacing and restored insignia-style background treatment.
- Top actions simplified to business UX (`Refresh` + `Account` menu + `Sign out`) while preserving existing governed behavior.
- Business-language cleanup applied to user-visible notices/panel eyebrows/default messages.
- Definition editor is now form-first, with advanced JSON moved into an optional single-viewer panel (section picker), instead of always-on JSON-heavy layout.
- Right-panel tab organization remains active, and process-builder stays universal (module variation via metadata tabs).

14. Header/sidebar corrective pass after runtime review (no migration)
- Removed duplicate surface-name authority in the global header; process/workbench naming remains in rendered surface headers.
- Sidebar now stretches to full viewport bottom below the fixed header (`height: calc(100vh - header)`), avoiding partial-height behavior.
- Sidebar background was tightened to insignia-only pattern treatment (no stacked mixed artwork overlays).
- Account control was restyled toward the V1-style bubble interaction pattern while keeping V2 branding and security behavior.
- Process-builder navigation remains one universal menu entry (`Process Builder`), while module differences remain metadata/backend-resolved.

15. V2 local port isolation from V1 (no migration)
- V2 API default/dev/staging port changed from `4000` to `4010` to avoid collision with V1.
- Workbench UI dev proxy target updated to `http://localhost:4010`.
- Local runtime now binds API on `4010` and UI remains on `5175`.

16. Owner-admin modern favicon rollout (`v2_0022`)
- New governed asset key `brand.eip_core.favicon.modern` added to the UI asset registry.
- Owner-admin theme resolution now maps legacy `favicon_key=brand.eip_core.icon.square` to the modern favicon key.
- Migration `v2_0022_owner_admin_favicon_modern.sql` updates shell profile revisions + legacy dropdown baseline to `favicon_key=brand.eip_core.favicon.modern`.

17. Favicon fit correction (no migration)
- Rebuilt `eip-modern-favicon.png` from the provided artwork into a square icon crop that fills favicon space (no large transparent canvas).
- Favicon payload remains key-governed through `brand.eip_core.favicon.modern`; no UI-engine authority drift.

18. Favicon runtime resolution hardening (no migration)
- Owner-admin theme fallback now always prefers the governed modern favicon key instead of falling back to legacy icon keys when `favicon_key` is missing.
- API shell-theme sanitizer now maps legacy favicon key values to `brand.eip_core.favicon.modern`.
- Favicon link application now uses a versioned query suffix to force browser refresh after asset updates.

19. Login UX salvage refinement (no migration)
- V2 login header now uses EIP icon branding + resource links + top-right quick-access/request-access actions.
- Left identity block now follows V1-style structure (hero + assurance cards + security standards panel) with EIP light admin palette.
- Welcome card now follows V1 long-form layout (email/org/password/totp fields, OTP action row, recovery links) while preserving V2 password login contract and safe server-side auth authority.

20. Auth step-up + device/session hardening (`v2_0023`)
- Added `eip_auth.auth_device` and `eip_auth.auth_otp_challenge` for trusted-device binding and OTP challenge lifecycle.
- Auth routes now support governed `request-otp`, `login/otp`, `totp/bootstrap`, and `login/totp` flows with SMTP delivery and encrypted TOTP secret storage.
- Session cookies now include a device cookie (`did`) when device binding is active, and server session validation enforces device-token hash matching.
- Session inactivity timeout is enforced server-side via `last_seen_at` governance and reflected in frontend auto-logout inactivity handling.
- V2 env mappings now carry V1 SMTP/OTP/TOTP settings into `.env.v2.local` and `.env.v2.staging` for local/staging parity.

21. Auth hardening proof wave (no new schema)
- Added explicit auth security regression runner: `npm run test:auth:security` (`services/api/scripts/test_auth_security_flow.mjs`).
- Added fail-closed origin enforcement for CSRF-protected unsafe methods (`AUTH_CSRF_REQUIRE_ORIGIN=true`).
- Added session user-agent binding enforcement (`AUTH_SESSION_BIND_USER_AGENT=true`) with automatic session revocation on mismatch.
- Added password brute-force control in auth flow via governed identity attrs:
  - `failed_login_count`
  - `last_failed_login_at`
  - `login_lock_until`
  configured by `AUTH_LOGIN_FAILURE_THRESHOLD` and `AUTH_LOGIN_LOCK_MIN`.
- Upgraded API mail dependency to remove known production vulnerability signal (`nodemailer` to 8.0.4) and added `npm run audit:prod`.
- Added no-downgrade release gate script: `npm run gate:no-downgrade` (runs unit tests + auth security flow + production dependency audit and fails closed on any regression).

22. Login UX corrective pass (no migration)
- Replaced placeholder login field glyphs with governed SVG icon assets under `apps/workbench-ui/src/assets/icons/` for higher visual quality.
- Removed UUID/challenge-id exposure from OTP success messaging; users now see only business-safe OTP delivery + expiry messaging.
- Added a password visibility toggle in the login form (`show/hide`) with dedicated eye icons.
- Added a TOTP setup/verification modal flow so users can complete step-up login or re-bootstrap authenticator setup without backend drift.
- Seed/bootstrap script now clears temporary login-lock metadata so reseeding can recover UAT access cleanly (`failed_login_count` / `login_lock_until` reset).

23. Auth/login UI governance hardening in AGENTS (no migration)
- Added explicit AGENTS gate that all login/auth controls must be production-ready and wired; no empty-shell controls allowed in runtime UI.
- Added explicit rule that standard login UX must not expose tenant-id override.
- Added explicit rule that TOTP setup must remain authenticator-app QR/`otpauth://` registration + verification.
- Added explicit completion checks for password/OTP/TOTP/logout/session/CSRF before claiming UI wave closure.

24. Auth UI upgrade closure wave (no migration)
- Removed tenant-id override from standard login UX and removed duplicate TOTP panel trigger.
- Quick Access now opens a functional OTP verification flow (request + verify) backed by `/api/eip/auth/request-otp` and `/api/eip/auth/login/otp`.
- TOTP setup modal now includes authenticator QR generation from governed `otpauth://` payload plus verify action.
- Request Access now opens a functional onboarding modal and submits to a governed public backend route (`POST /api/public/tenant-requests`), with accepted-response tracking and delivery logging.
- Login icons are aligned with V1 icon family (`lucide-react`) for OTP/email/password/org field parity.

25. Auth + process-builder UX hardening follow-up (no migration)
- Request Access modal now includes explicit Terms & Conditions guidance text in the submission form.
- Contract-driven process-definition editor now exposes canonical 5-layer guidance in UI (process, task label, macro, effect library, service object parameters).
- Transition designer now supports task-label and macro assignment directly, with optional fallback effect code.
- Macro/effect authoring is now guided in UI through a macro effect library editor using governed effect metadata (`PROCESS_EFFECT_TYPE`) without introducing new schema.

26. Tabbed process-authoring + top-down flow closure (`v2_0024`)
- Process-definition authoring in `ContractDetailEditor` is now tabbed (`Definition`, `Flow Tree`, `Macro Effects`, `Advanced`) to match V1-style guided UX while keeping primitive/metadata authority.
- Flow authoring now includes a top-down tree view generated from governed node/transition JSON, so process progression is visible without leaving the engine-owned editor.
- Shell header gained functional quick-navigation tabs (same governed surface switching authority as sidebar) to align closer with V1 admin console interaction.
- No new table was introduced; metadata composition was refined through `v2_0024_process_definition_tabbed_flow_authoring.sql`.

27. Visual canvas + starter-template authoring uplift (`v2_0025`)
- `ContractDetailEditor` flow tab now includes a visual task-card canvas where add/edit/remove actions translate directly into governed `graph.nodes` and `graph.transitions` payload fields in the background.
- Introduced starter templates (quick apply) so users can begin from predefined process skeletons rather than manually building every flow from scratch.
- Canvas node edits auto-maintain transition references and initial-node validity to reduce authoring friction and invalid graph states.
- No new table introduced; metadata-driven authoring config is delivered through `v2_0025_process_visual_builder_templates.sql`.

28. V1-style process-builder UX parity correction (`v2_0026`)
- Flow tab was reworked to a V1-style operational layout: quick template strip, center builder-canvas lane, right inspector tabs, and bottom transition list.
- Visual canvas behavior now focuses on discoverable user flow (select node, inspect/edit node, select transition, inspect/edit transition) while still writing governed graph payload fields.
- Process catalog panel now supports `library_cards` mode to mirror V1 process-library card UX instead of default table mode.
- Right workspace tabs can now be switched from flow inspector actions through governed context synchronization (`bind_to_workbench_panel`).
- No new table introduced; metadata/UI behavior was refined via `v2_0026_process_builder_v1_visual_tuning.sql`.

29. Operator manual baseline for workbench usage (no migration)
- Added an operator-facing manual for V2 workbench usage and feedback preparation:
  - `docs/dev/WORKBENCH_OPERATOR_MANUAL.md`
- Manual documents runtime access, layout map, process-authoring flow, 5-layer model usage, permissions expectations, troubleshooting, and a standard format for submitting UI/UX improvements.

30. Workbench icon + guidance tooltip polish (no migration)
- Updated process-authoring/workbench iconography to replace text-only icon placeholders with consistent functional icons across tabs, canvas node badges, and key actions.
- Removed developer-leaning UI helper wording in process-authoring surfaces and replaced with business-oriented instruction copy.
- Added delayed mini-help tooltips (3-second hover/focus) for key workbench actions/tabs using a reusable primitive wrapper:
  - `apps/workbench-ui/src/components/primitives/MiniHelp.jsx`

31. Owner-admin icon/navigation parity + module surface expansion (`v2_0027`)
- Sidebar/navigation now uses governed icon codes from `ui_surface.attrs.surface_nav.icon` with a V1-style icon set and improved collapse control styling.
- Header branding now uses the same governed favicon-style logo asset for compact fit parity.
- Login OTP modal icons were normalized to the V1 icon family (lucide) for visual consistency.
- Added governed owner-admin module surfaces (dashboard, tenant requests, connections, tasks, users, portfolios, templates, security, audit, data explorer, integrations, reports, settings) without new tables.
- Existing process/review surfaces were updated with explicit nav icon metadata and preserved process-builder authority.

32. V1-visual parity correction pass (`v2_0028`)
- Sidebar watermark artwork was removed to prevent drift from requested clean V1-style nav background.
- Sidebar labels were simplified to primary business labels only (no repeated workspace suffix lines).
- Header quick-tab buttons were switched to borderless pill style with dark-blue active state and white text.
- Workbench UI font source now uses the same local V1 font assets (`Montserrat` + `Comfortaa`) instead of external font import.
- Owner connections surface subtitle now explicitly states tenant-scoped gateway connection intent.

33. V1 naming parity correction (`v2_0029`)
- Core process navigation label was corrected from `Process Builder` to `Processes` for exact V1 menu parity.
- Connections panel title/subtitle was tightened to explicit tenant-scoped gateway connection wording.
- Header tab focus state now follows the same dark active pattern (dark blue background + white text) for keyboard navigation parity.

34. Process-workbench wording + tenant UX correction (`v2_0030`)
- Process workbench header wording was updated to business-facing copy (`Process Studio` / `Process Builder`) and explicit tenant-scoped wording.
- Process catalog eyebrow was changed to `Tenant Process Library`, and `v1` version markers were removed from library-card rendering.
- Definition-studio flow inspector no longer duplicates process-level definition data in a second process-definition panel; the inspector now has task-level definition editing for selected canvas tasks.
- Surface/catalog 401 handling now forces session refresh so expired sessions redirect cleanly back to login instead of staying inside shell error state.
- Sidebar selected-item visual drift was reduced (no active shadow, no bold nav labels).

35. Owner-admin module execution alignment (`v2_0031`, no new table)
- Added secured owner-admin module API contracts under `/api/eip/owner-admin/modules/:module/records` (list/create/update) with centralized auth session + permission + CSRF enforcement.
- Owner-admin menu surfaces now render as contract-driven table + editor workspaces (metadata-composed via `ContractTablePanel` + `ContractRecordEditor`) instead of static placeholder rows.
- Seed/bootstrap now populates tenant-scoped owner-admin baseline records in `eip_core.service_object` for every menu module (dashboard, tenant requests, connections, tasks, users, portfolios, templates, security, audit, data explorer, integrations, reports, settings).
- No schema table was added; owner-admin module records reuse the governed kernel store `eip_core.service_object` with module/object-type partitioning.

## Full System Explanation (Current V2)

### 1) Kernel, Tenancy, and Security Base

- Kernel and tenancy authority are anchored in relational schema (`kernel.tenants`, `tenant.tenant_settings`, security membership primitives).
- Shared code remains tenant-agnostic; tenant behavior is introduced through governed metadata/settings.
- New tables are controlled by explicit justification and drift checks.

### 2) Authentication and Session Authority

- Auth shell is centralized in server plugins.
- Session, CSRF, and permission checks are enforced through shared APIs (`requireSession`, `requireCsrf`, `requirePermission`).
- Route-level security shortcuts are forbidden.
- Session identity is cookie-backed with signed/hashed server validation (`sid` + CSRF secret hash + tenant/realm binding).
- Device identity is enforced through governed `did` cookie hash checks against `eip_auth.auth_device` when session rows are device-bound.
- Step-up auth is available through governed OTP (email challenge) and TOTP flows; TOTP secrets are encrypted at rest with `AUTH_TOTP_SECRET_KEY`.
- Inactivity timeout is fail-closed: expired idle sessions are revoked server-side and frontend also enforces user-idle logout timers.
- CSRF validation now includes trusted-origin gating for unsafe methods.
- Session replay resistance is strengthened by user-agent hash binding with revoke-on-mismatch behavior.
- Repeated failed password attempts now trigger temporary lock windows through governed auth identity metadata.

### 3) Process Engine Authority

- Lifecycle authority is process-engine-owned (`core_process_engine`), not route-owned.
- Canonical execution model is fixed at 5 layers:
  - process definition
  - task label
  - macro
  - effect library
  - service object + category runtime parameters
- Macro execution is explicit and governed; hidden inline transition bundles are not allowed.

### 4) UI Engine Authority

- Renderer/registry/primitive library are code-owned.
- `eip_core.ui_surface` is metadata-owned composition authority.
- Server remains business/process/security authority.
- Workbench UI resolves surfaces through tenant-scoped catalog + surface endpoints with cache validators.
- Process-definition UX now uses tabbed primitive composition with explicit 5-layer guidance and a top-down flow tree, while raw JSON remains governed source-of-truth in the advanced tab.
- Visual-builder interactions (task cards, transitions, starter templates) now map to governed graph/macro JSON fields in background, so UX stays graphical while runtime remains metadata/process-engine authoritative.
- Workbench flow authoring now follows a V1-like operator mental model (library -> canvas -> inspector -> transitions) while retaining V2 engine-owned rendering and server-owned authority.
- An operator-oriented usage manual is now part of dev docs (`docs/dev/WORKBENCH_OPERATOR_MANUAL.md`) to support structured UX-improvement proposals without requiring source-level inspection first.
- Workbench UX now includes delayed inline mini-help tooltips for key controls (3-second hover/focus) so operators get contextual instructions without persistent visual noise.
- Owner-admin shell navigation now supports metadata-defined nav icon codes (`surface_nav.icon`) and full admin module surface discovery through governed UI metadata.
- Owner-admin module pages now use governed contract endpoints backed by tenant-scoped service objects, so each menu item has persistent DB-backed records and editable detail forms without introducing module-specific table sprawl.

### 5) Owner-Admin Shell/Theming Authority

- Shell/theme is separated from `ui_surface` tree composition.
- Profile lifecycle authority lives in:
  - `eip_core.ui_shell_profile`
  - `eip_core.ui_shell_profile_revision`
  - `eip_core.ui_shell_profile_event`
- Runtime consumes published state from `eip_core.ui_shell_profile_published`.
- Selection and override hierarchy is tenant-governed through settings keys:
  - `OWNER_ADMIN_SHELL_PROFILE_SELECTION`
  - `OWNER_ADMIN_SHELL_THEME_OVERRIDE`
- Branding defaults now include governed modern favicon key `brand.eip_core.favicon.modern` with legacy-key compatibility mapping for older profile payloads.
- No arbitrary CSS, no executable metadata, no tenant self-architecture authority.

### 6) Effective Runtime Resolution Path

- For a surface request:
  - server resolves the surface tree from `eip_core.ui_surface`
  - server resolves effective shell profile/version from published lifecycle data
  - server applies governed tenant selection/override hierarchy
  - server returns `surface.shell_theme` plus cache validators that include shell lifecycle changes
- Frontend renders with engine primitives and uses returned shell payload only as governed data.

### 7) Secure Local/Staging Access Path

- Recommended local staging path is TLS single-origin through gateway: `https://localhost:8443`.
- Browser should talk only to gateway origin; gateway proxies `/api/*` to internal API origin.
- API cookie policy for staging should remain `AUTH_COOKIE_SECURE=true` and CSRF remains enforced on unsafe methods.
- Staging smoke checks validate login/session/CSRF behavior in this deployed-shape path.

### 8) Auth UI Runtime Contract (Owner Admin Login)

- Login shell remains UI-engine-owned code, while security/session/process authority remains server-side.
- Standard login UX is business-facing and tenant-code based; tenant-id override is not exposed in normal user flow.
- OTP quick access is a real functional flow, not a placeholder.
- TOTP setup is authenticator-QR driven (`otpauth://`), then verified by 6-digit code before elevated sign-in.
- Request Access is a functional governed submission flow through `/api/public/tenant-requests` (accepted + reference code + delivery telemetry).

### 9) Process Builder Authoring Contract

- Definition authoring remains metadata-/contract-driven through UI engine primitives (`ContractDetailEditor`) and governed process endpoints.
- Authoring UX now keeps the 5-layer process model visible and editable in-guided mode:
  - transition-level task label
  - transition-level macro reference
  - macro-level effect bundles
  - effect-level service object type/category parameters
- Effect catalog choices remain governed by taxonomy metadata (`PROCESS_EFFECT_TYPE`); no one-off hardcoded effect functions are introduced.

## Process Engine Rules (Wave 3.5 baseline)

- Process lifecycle mutations must happen through `core_process_engine` transitions/effects only.
- Route handlers must not implement direct business lifecycle status mutation logic.
- Process routes require authenticated EIP session + CSRF.
- Cross-tenant process access is fail-closed in Wave 3A unless centralized cross-tenant authz is explicitly migrated.
- If process schema tables are missing, process routes must return `503 PROCESS_SCHEMA_UNAVAILABLE` instead of running partial writes.
- `POST /api/eip/process/instances` may resolve process definitions through governed `eip_core.process_binding` when callers do not pass explicit process def/code references.

## Process Schema Baseline (Wave 3.5)

- The V2 process data plane now includes these core relations: `eip_core.dropdown_list`, `eip_core.dropdown_value`, `eip_core.process_def`, `eip_core.process_binding`, `eip_core.process_instance`, `eip_core.task_template`, `eip_core.service_object`, `eip_core.task`, `eip_core.service_object_status_event`, and `eip_core.task_status_event`.
- `eip_core.process_task_template` is a compatibility view over `eip_core.task_template` for readiness checks during staged migration.
- `eip_auth.auth_identity_agent` now exists so actor-resolution lookup no longer aborts process transactions when mapping is absent.
- `PROCESS_SCHEMA_UNAVAILABLE` should only appear if migrations were not applied to the runtime V2 database.

## 5-layer process canon

- Every lifecycle implementation must preserve these layers:
  1. process definition
  2. task label
  3. macro
  4. effect library
  5. service object + service object category runtime parameters
- Macro handling is runtime-explicit: transitions invoke `macro_code`, engine resolves macro bundles from `process_def.graph.macros`, and macro bundles invoke effects.
- Inline transition effects are forbidden; all execution bundles must be macro-governed.
- Do not introduce route-level macro/effect shortcuts.

## Effect Governance

- Keep effect handlers generic and reusable.
- Do not add one-off tenant/business-specific effect handlers for single workflows.
- Keep task labels business-facing; keep effect execution metadata-driven.
- Effect catalog authority is governed in `PROCESS_EFFECT_TYPE` dropdown metadata.
- Use `canonical_effect_code` in governed metadata for alias mapping; do not add hardcoded alias maps in runtime.
- Runtime code may own handler dispatch only (`effect_code -> handler`), not business authority for effect catalog semantics.

## Service Object + Document Governance

- Service object type must be governed by `SERVICE_OBJECT_TYPE` metadata.
- Service object category should be governed by `SERVICE_OBJECT_CATEGORY` metadata where provided.
- Documents are governed as service-object types in the same kernel model (not a parallel route-owned model).
- Document category keys and document header keys should come from `DOCUMENT_CATEGORY` and `DOCUMENT_HEADER_KEY`.
- If a document flow needs richer relational persistence later, justify it through the new-table register first.

## UI Surface Governance

- UI surfaces are governed metadata in `eip_core.ui_surface`.
- Public/authenticated surface routes expose metadata and caching headers only; they do not own lifecycle logic.
- Surface discovery must use `/api/eip/ui/surfaces` (tenant-scoped + realm-scoped), then load a selected surface with `/api/eip/ui/surfaces/:code`.
- UI-surface readiness does not replace process-engine authority.
- Process-builder/workbench surfaces must bind to governed process contracts (`/api/eip/process/workbench/catalog`, `/api/eip/process/workbench/defs/:id`) rather than hardcoding process definition codes in UI metadata.
- Surface catalog/surface loader 401 responses must trigger auth refresh and fail-closed login redirect so expired sessions do not remain in stale in-shell states.
- Workbench edit actions must use governed process routes (`/process/defs`, `/process/task-templates`, `/process/bindings`) and never introduce route-local lifecycle shortcuts.
- Rendered V2 operator workbench frontend lives in `apps/workbench-ui` and must stay surface-loader/renderer/registry driven.
- Frontend workbench components must consume node contract props (`list_contract`, `detail_source`, `create_contract`, `update_contract`) instead of hardcoding API authority in page shells.
- Surface switching authority belongs to governed metadata (surface catalog records), not hardcoded page-level lists in `App.jsx`.
- Keep a code-owned, whitelisted primitive library in `engine/registry.jsx`; metadata may compose primitives but must not execute arbitrary code.
- Owner-admin shell is code-owned runtime chrome (`components/shell/OwnerAdminShell.jsx`), while shell/theme identity and lifecycle are metadata-governed in `eip_core.ui_shell_profile` + `eip_core.ui_shell_profile_revision` + `eip_core.ui_shell_profile_event`.
- Runtime shell payload must resolve from published profile revisions (`eip_core.ui_shell_profile_published`) and be returned as `surface.shell_theme`.
- `ui_surface` remains composition metadata; it may only reference shell identity via `attrs.shell_profile_code`, not embed raw shell theme payloads.
- Workbench render stability depends on keeping metadata node/prop references stable across rerenders; renderer-level memoization is required to prevent request-loop churn in contract-driven primitives.
- Login shell remains presentation-only; authentication/session authority stays server-side (`/api/eip/auth/*`) with unchanged cookie/CSRF controls.
- Universal process-builder direction is enforced at UI level:
  - one process-builder nav authority
  - module variation via metadata-backed profile tabs and surface contracts
  - no route/page-owned module-silo workflow authority
- Transition authoring in workbench definitions should prefer guided primitive controls (transition designer in `ContractDetailEditor`) while retaining raw JSON fields as governed source-of-truth fallback.
- Header/shell UX model is now:
  - full-width top header for brand + account + refresh
  - left navigation below header with governed insignia/asset treatment
  - dense center workspace with reduced inter-block whitespace
  - business-facing labels by default (technical wording avoided in visible UI where safe)
- Login UX model is now:
  - V1-style identity gateway composition (resource links, assurance cards, standards panel, long-form access card)
  - EIP light palette aligned with owner-admin shell tokens
  - password sign-in remains server-authoritative (`/api/eip/auth/login/password`) even when OTP/TOTP actions are surfaced as governed UI affordances
- Shell profile lifecycle operations are DB-governed through:
  - `eip_core.ui_shell_profile_create_draft(...)`
  - `eip_core.ui_shell_profile_publish(...)`
  - `eip_core.ui_shell_profile_rollback_publish(...)`
- Shell profile resolution order is fixed:
  - tenant surface profile selection (`OWNER_ADMIN_SHELL_PROFILE_SELECTION.surface`)
  - tenant global profile selection (`OWNER_ADMIN_SHELL_PROFILE_SELECTION.global_profile_code`)
  - surface default (`attrs.shell_profile_code`)
  - fallback (`EIP_CORE_STANDARD`)
- Tenant/theme override merge order is fixed:
  - profile payload
  - `OWNER_ADMIN_SHELL_THEME_OVERRIDE.global`
  - `OWNER_ADMIN_SHELL_THEME_OVERRIDE.profile[profile_code]`
  - `OWNER_ADMIN_SHELL_THEME_OVERRIDE.surface[surface_code]`
- Treat workbench/domain components as composites, not primitives. `ProcessWorkbenchCatalog`, `TaskTemplateWorkbench`, `ProcessBindingWorkbench`, `ProcessInstanceStream`, and `ProcessDefinitionStudio` are not valid primitive entries.
- No workbench/domain composite should remain runtime-registered once metadata + generic primitives cover their surface composition.
- `ProcessDefinitionStudio` authority is decomposed into metadata + `ContractDetailEditor`; keep `ProcessDefinitionStudio` source only as legacy reference, not runtime authority.
- Primitive classification gate (all must be true): domain-neutral, metadata-configurable, reusable across modules/tenants/object types without source edits, no business workflow authority, no business-specific structure identity, and allowlisted in engine runtime.
- Primitive test: if object name, tenant, fields, layout, and module can all change without source edits, classify as primitive; otherwise classify as composite.
- Prefer generic primitive composition (`ContractTablePanel`, `ContractRecordEditor`, layout/header primitives) in `eip_core.ui_surface.tree`; keep composites only where generic primitives do not yet cover required behavior.
- Component organization is mandatory:
  - primitives in `apps/workbench-ui/src/components/primitives/`
  - composites in `apps/workbench-ui/src/components/composites/`
  - app shell components in `apps/workbench-ui/src/components/shell/`
  - engine runtime modules in `apps/workbench-ui/src/engine/`
  - no ambiguous top-level JSX/JS files directly under `apps/workbench-ui/src/components/`
- Asset references in metadata must be key-based and resolved through a safe in-code asset registry (no raw runtime URL/code injection from DB metadata).
- Theme-token overrides are limited to governed allowlisted token keys and validated color formats; arbitrary CSS injection is forbidden.
- Allowed tenant/theme overrides:
  - resolved profile selection through `tenant.tenant_settings` key `OWNER_ADMIN_SHELL_PROFILE_SELECTION`
  - resolved through `tenant.tenant_settings` key `OWNER_ADMIN_SHELL_THEME_OVERRIDE`
  - `logo_key`, `icon_key`, `favicon_key`, `hero_key` (must resolve through safe asset key registry)
  - `layout_variant` (allowlisted variants only)
  - approved color token keys under `tokens`
- Forbidden tenant/theme overrides:
  - selecting unpublished or unknown profile codes as runtime authority
  - arbitrary style blobs
  - uncontrolled URL-based assets
  - runtime script/style injection via metadata
- Shell profile cache/version invalidation must include shell lifecycle metadata: profile code/version/publish timestamp plus tenant selection/override update timestamps.
- Reference architecture: `docs/architecture/OWNER_ADMIN_SHELL_PROFILE_LIFECYCLE.md`.
- Cache strategy must use identity `tenant_id + realm + surface_code` plus validator token `version/etag`.
- Use memory cache for surface payloads and discovery catalogs; use `sessionStorage` only for non-sensitive UI hints (for example last selected surface code per tenant/realm).
- Never store sessions, permissions, csrf tokens, or sensitive personalized payloads in `localStorage`.
- Rendered workbench closure requires authenticated frontend smoke evidence (`npm run test:smoke` in `apps/workbench-ui`) covering:
  - core + ecom surface rendering through governed UI-engine path
  - tenant-scoped surface discovery through `/api/eip/ui/surfaces`
  - contract-driven workbench endpoint calls
  - permission fail-closed UI behavior
  - cookie/session/CSRF/CORS runtime behavior for the real frontend -> API path
- Apply `db/migrations/v2_0014_workbench_ui_generic_primitive_composition.sql` before expecting generic-primitive workbench composition in runtime data.

## Security and Tenancy

- Keep tenant scope explicit on all tenant-owned queries.
- Do not expose raw secrets/tokens in process responses.
- Do not bypass shared session/CSRF controls for process actions.
- Process/workbench route authorization must flow through centralized `app.requirePermission(...)`.
- Permission codes are resolved from governed identity metadata (`eip_auth.auth_identity.attrs.permissions`) via the auth shell and enforced fail-closed.
- Passing permission-code arrays into route guards is mandatory; placeholder/ignored permission arguments are forbidden.

## Staging Deployment Baseline

- Preferred V2 staging shape is single-origin: reverse-proxy gateway in front of API and built workbench assets.
- Keep session/cookie/CSRF behavior validated in the deployed-origin path, not only localhost split-origin dev mode.
- Canonical staging runbook: `deploy/staging/README.md`.
- Canonical staging smoke entrypoint: `deploy/staging/staging_smoke.mjs`.

## Current Technical Notes

- `HTTP_REQUEST` effect path is fail-closed when gateway outbound module is not present in V2.
- `auth_identity_agent` mapping remains optional at runtime; when no active primary mapping exists, process execution continues with `actor_agent_id = null`.
- `routes/crm_process.js` is a thin alias to `routes/process/core_process.js`; CRM lifecycle handling must stay under shared process engine routes, not a separate route-local authority.
- Governance drift checks should include `node scripts/validate_process_governance.mjs` in addition to existing security/tenant scripts.
