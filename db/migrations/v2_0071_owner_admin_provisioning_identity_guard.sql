BEGIN;

-- EIP Core V2 — Owner Admin onboarding provisioning identity guard.
--
-- A tenant request exists before tenant authority exists. Once platform approval
-- provisions a tenant + initial admin identity, that linkage becomes immutable.
-- This prevents a legacy/recovered request from ever being re-approved onto a
-- second tenant, even if an application-route regression attempts to do so.
-- No new table is introduced.

DO $$
BEGIN
  IF to_regclass('kernel.tenant_request') IS NULL THEN
    RAISE EXCEPTION 'v2_0071 requires kernel.tenant_request';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM kernel.tenant_request
    WHERE (tenant_id IS NULL) <> (admin_identity_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'v2_0071 found tenant_request rows with incomplete provisioning identity';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION kernel.enforce_tenant_request_provisioning_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tenant_id IS NOT NULL
     AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_request tenant_id is immutable after provisioning'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.admin_identity_id IS NOT NULL
     AND NEW.admin_identity_id IS DISTINCT FROM OLD.admin_identity_id THEN
    RAISE EXCEPTION 'tenant_request admin_identity_id is immutable after provisioning'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW.tenant_id IS NULL) <> (NEW.admin_identity_id IS NULL) THEN
    RAISE EXCEPTION 'tenant_request provisioning identity must be set or cleared as a complete pair'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS tenant_request_provisioning_identity_guard
  ON kernel.tenant_request;

CREATE TRIGGER tenant_request_provisioning_identity_guard
BEFORE UPDATE OF tenant_id, admin_identity_id
ON kernel.tenant_request
FOR EACH ROW
EXECUTE FUNCTION kernel.enforce_tenant_request_provisioning_identity();

COMMENT ON FUNCTION kernel.enforce_tenant_request_provisioning_identity() IS
  'Prevents an already-provisioned tenant request from being reassigned to another tenant or initial admin identity.';

COMMIT;
