# Connections create activation visibility closeout — 2026-09-10

## Scope

Owner Admin Connections draft creation must not present the `Enabled` lifecycle control before a connection exists.

## Canonical behavior

- New connection creation always produces a disabled draft.
- `Enabled` is hidden while `ContractFlowStepEditor` is in create mode.
- After the draft is persisted and selected, `Enabled` becomes visible on Identity.
- Activation remains server-authoritative and subject to existing readiness validation.
- The behavior is metadata-driven through generic field metadata (`hide_on_create`), not hard-coded to Connections in React.
- No new tables and no browser-controlled tenant authority are introduced.

## Implementation

- Generic `ContractFlowStepEditor` field metadata now supports `hide_on_create`.
- Hidden create-time fields are excluded from create-mode validation and patching.
- `v2_0056_connection_activation_visibility.sql` applies `hide_on_create: true` to the Connections `is_enabled` field and removes the obsolete create-disabled presentation flag.
- The new-record template still carries `identity.is_enabled=false`, preserving fail-closed server semantics.

## Acceptance

1. Open Owner Admin > Connections.
2. Choose a tenant and click `New connection`.
3. Confirm `Enabled` is absent from the create form.
4. Enter the required identity fields and click `Create draft`.
5. Confirm the draft is created disabled and selected.
6. Confirm `Enabled` is now visible for the persisted record.
7. Confirm attempting activation before readiness continues to fail closed through the existing server validation.
