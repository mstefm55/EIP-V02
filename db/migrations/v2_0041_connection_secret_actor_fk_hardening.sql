BEGIN;

-- Pre-release hardening for v2_0040.
-- Actor identity UUIDs are audit attribution only. Composite FKs with ON DELETE
-- SET NULL would also attempt to null tenant_id when an identity is removed,
-- conflicting with the tenant NOT NULL boundary. Keep the immutable actor UUID
-- evidence without delete-time coupling to authentication identity lifecycle.

ALTER TABLE tenant.connection_secret
  DROP CONSTRAINT IF EXISTS connection_secret_identity_rotate_fk;

ALTER TABLE tenant.connection_secret
  DROP CONSTRAINT IF EXISTS connection_secret_identity_revoke_fk;

COMMENT ON COLUMN tenant.connection_secret.rotated_by_identity_id IS
  'Tenant-context actor identity UUID captured at rotation time. Audit attribution is intentionally not delete-cascaded or FK-coupled to mutable auth identity lifecycle.';

COMMENT ON COLUMN tenant.connection_secret.revoked_by_identity_id IS
  'Tenant-context actor identity UUID captured at revocation time. Audit attribution is intentionally not delete-cascaded or FK-coupled to mutable auth identity lifecycle.';

COMMIT;
