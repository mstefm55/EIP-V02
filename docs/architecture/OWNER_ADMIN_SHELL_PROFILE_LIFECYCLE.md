# OWNER_ADMIN_SHELL_PROFILE_LIFECYCLE

## Purpose

Define the durable owner-admin shell profile architecture so shell theming stays governed, versioned, auditable, rollback-safe, and runtime-stable.

## Final Ownership Model

1. Platform/template shell profile identity:
- `eip_core.ui_shell_profile`
- owns profile code, scope, template classification, activation state
- does not store `ui_surface` composition

2. Shell profile lifecycle/version authority:
- `eip_core.ui_shell_profile_revision`
- owns payload, draft/published/archived lifecycle, version chain, publish actor/time, rollback lineage
- runtime authority is published revisions only

3. Shell profile audit/history:
- `eip_core.ui_shell_profile_event`
- append-only lifecycle events (`draft_created`, `draft_published`, `published_archived`, `rollback_published`)

4. Surface composition:
- `eip_core.ui_surface`
- owns primitive tree/contracts/layout metadata
- only references shell profile via `attrs.shell_profile_code`

5. Tenant-scoped variability:
- `tenant.tenant_settings`
- profile selection key: `OWNER_ADMIN_SHELL_PROFILE_SELECTION`
- token/asset/layout override key: `OWNER_ADMIN_SHELL_THEME_OVERRIDE`
- no raw CSS, no executable metadata

## Lifecycle Model

- Draft creation: `eip_core.ui_shell_profile_create_draft(...)`
- Publish: `eip_core.ui_shell_profile_publish(...)`
- Rollback publish: `eip_core.ui_shell_profile_rollback_publish(...)`
- Runtime reads only `eip_core.ui_shell_profile_published`

Rules:
- one published revision per profile
- one active draft per profile
- published revisions are retained as history (`archived`), not overwritten
- rollback produces a new published version from historical payload, preserving lineage

## Role Governance

- Owner-admin (platform authority):
  - creates drafts, publishes, and rolls back profiles
  - controls approved template profiles and allowed profile catalog
- Partners/trainers:
  - configure tenant-level selection/overrides only within governed settings
  - cannot inject raw CSS/executable metadata
- Tenant admins:
  - consume approved profiles and constrained overrides
  - cannot redefine platform shell architecture

## Effective Resolution Hierarchy

Server runtime resolves shell theme in this order:
1. Tenant surface-specific profile selection (`OWNER_ADMIN_SHELL_PROFILE_SELECTION.surface`)
2. Tenant global profile selection (`OWNER_ADMIN_SHELL_PROFILE_SELECTION.global_profile_code`)
3. Surface default profile (`ui_surface.attrs.shell_profile_code`)
4. System fallback (`EIP_CORE_STANDARD`)

Then merges payload layers:
1. Published profile payload
2. Tenant global override (`OWNER_ADMIN_SHELL_THEME_OVERRIDE.global`)
3. Tenant profile override (`OWNER_ADMIN_SHELL_THEME_OVERRIDE.profile[profile_code]`)
4. Tenant surface override (`OWNER_ADMIN_SHELL_THEME_OVERRIDE.surface[surface_code]`)

## Cache/Invalidation Contract

The resolved shell payload includes a runtime token `shell_theme.theme_version_token` derived from:
- published profile code/version/timestamps
- tenant selection metadata timestamp
- tenant override metadata timestamp

`/api/eip/ui/surfaces/:code` ETag and Last-Modified include this token path so shell profile publish/rollback/override updates invalidate cached surface payloads without UI recoding.
