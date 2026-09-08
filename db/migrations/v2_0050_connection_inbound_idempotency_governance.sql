BEGIN;

-- EIP Core V2 — governed inbound idempotency and transport receipt support.
--
-- Reuse the canonical eip_core.info_record kernel object for bounded transport
-- evidence rather than introducing a connection-specific receipt table.
-- Tenant authority remains server-derived; idempotency keys are stored only as
-- SHA-256 digests and raw request payloads/credentials are never persisted.

DO $$
DECLARE
  composition text;
BEGIN
  IF to_regclass('eip_core.info_record') IS NULL THEN
    RAISE EXCEPTION 'v2_0050 requires canonical eip_core.info_record';
  END IF;

  SELECT tree #>> '{props,composition}'
  INTO composition
  FROM eip_core.ui_surface
  WHERE tenant_id IS NULL
    AND version = 1
    AND code = 'owner_connections'
  LIMIT 1;

  IF composition IS DISTINCT FROM 'connection_setup_v2' THEN
    RAISE EXCEPTION 'v2_0050 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

WITH list_defs(module, code, name, attrs) AS (
  VALUES
    (
      'integration',
      'CONNECTION_EVENT_ID_LOCATION',
      'Connection Event ID Location',
      '{"ui":{"applies_to":["connection.idempotency.event_id_location"]}}'::jsonb
    ),
    (
      'integration',
      'CONNECTION_IDEMPOTENCY_SCOPE',
      'Connection Idempotency Scope',
      '{"ui":{"applies_to":["connection.idempotency.idempotency_scope"]}}'::jsonb
    )
), upserted AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  SELECT NULL, module, code, name, 1, true, attrs
  FROM list_defs
  ON CONFLICT (tenant_id, module, code, version) DO UPDATE
  SET name = EXCLUDED.name,
      is_active = true,
      attrs = EXCLUDED.attrs,
      updated_at = now()
  RETURNING id, code
)
SELECT count(*) FROM upserted;

WITH value_defs(list_code, code, label, sort_order, attrs) AS (
  VALUES
    ('CONNECTION_EVENT_ID_LOCATION', 'header', 'HTTP Header', 10, '{}'::jsonb),
    ('CONNECTION_EVENT_ID_LOCATION', 'query', 'Query Parameter', 20, '{}'::jsonb),
    ('CONNECTION_EVENT_ID_LOCATION', 'body', 'JSON Body Path', 30, '{}'::jsonb),
    (
      'CONNECTION_IDEMPOTENCY_SCOPE',
      'connection',
      'This Connection',
      10,
      '{"description":"Event IDs are unique within the current tenant and connection."}'::jsonb
    ),
    (
      'CONNECTION_IDEMPOTENCY_SCOPE',
      'tenant',
      'Entire Organisation',
      20,
      '{"description":"Event IDs are unique across all connections in the current tenant."}'::jsonb
    )
), lists AS (
  SELECT id, code
  FROM eip_core.dropdown_list
  WHERE tenant_id IS NULL
    AND module = 'integration'
    AND version = 1
    AND is_active = true
    AND code IN ('CONNECTION_EVENT_ID_LOCATION', 'CONNECTION_IDEMPOTENCY_SCOPE')
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT lists.id, value_defs.code, value_defs.label, value_defs.sort_order, true, value_defs.attrs
FROM value_defs
JOIN lists ON lists.code = value_defs.list_code
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    attrs = EXCLUDED.attrs,
    updated_at = now();

-- Enforce one transport receipt per tenant + computed idempotency digest even
-- across concurrent API workers. The digest itself already includes connection
-- authority when the governed scope is "connection".
CREATE UNIQUE INDEX IF NOT EXISTS info_record_connection_inbound_idempotency_uk
  ON eip_core.info_record (
    tenant_id,
    record_type,
    ((attrs ->> 'idempotency_key_digest'))
  )
  WHERE record_type = 'connection_inbound_receipt'
    AND attrs ? 'idempotency_key_digest';

-- Upgrade Reliability from free-text location/scope inputs to governed selects.
DO $$
DECLARE
  fields jsonb;
BEGIN
  SELECT tree #> '{children,1,children,1,children,1,children,3,children,0,props,fields}'
  INTO fields
  FROM eip_core.ui_surface
  WHERE tenant_id IS NULL
    AND version = 1
    AND code = 'owner_connections'
  LIMIT 1;

  IF fields #>> '{0,key}' IS DISTINCT FROM 'event_id_location'
     OR fields #>> '{1,key}' IS DISTINCT FROM 'event_id_key'
     OR fields #>> '{2,key}' IS DISTINCT FROM 'idempotency_scope' THEN
    RAISE EXCEPTION 'v2_0050 Reliability field order drift detected';
  END IF;
END
$$;

UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      jsonb_set(
        tree,
        '{children,1,children,1,children,1,children,3,children,0,props,fields,0}',
        $json$
        {
          "key":"event_id_location",
          "path":"idempotency.event_id_location",
          "label":"Event ID location",
          "type":"select",
          "options_path":"taxonomy.CONNECTION_EVENT_ID_LOCATION",
          "omit_empty":true,
          "help":"Choose where the external sender supplies its stable event identifier."
        }
        $json$::jsonb,
        true
      ),
      '{children,1,children,1,children,1,children,3,children,0,props,fields,2}',
      $json$
      {
        "key":"idempotency_scope",
        "path":"idempotency.idempotency_scope",
        "label":"Idempotency scope",
        "type":"select",
        "options_path":"taxonomy.CONNECTION_IDEMPOTENCY_SCOPE",
        "omit_empty":true,
        "help":"Connection scope isolates event IDs per connection; organisation scope shares them across this tenant."
      }
      $json$::jsonb,
      true
    ),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0050"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.dropdown_value dv
    JOIN eip_core.dropdown_list dl ON dl.id = dv.list_id
    WHERE dl.tenant_id IS NULL
      AND dl.module = 'integration'
      AND dl.code = 'CONNECTION_EVENT_ID_LOCATION'
      AND dl.version = 1
      AND dv.code = 'header'
      AND dv.is_active = true
  ) THEN
    RAISE EXCEPTION 'v2_0050 event ID location taxonomy validation failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.dropdown_value dv
    JOIN eip_core.dropdown_list dl ON dl.id = dv.list_id
    WHERE dl.tenant_id IS NULL
      AND dl.module = 'integration'
      AND dl.code = 'CONNECTION_IDEMPOTENCY_SCOPE'
      AND dl.version = 1
      AND dv.code = 'connection'
      AND dv.is_active = true
  ) THEN
    RAISE EXCEPTION 'v2_0050 idempotency scope taxonomy validation failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_connections'
      AND tree::text LIKE '%"path":"tenant_id"%'
  ) THEN
    RAISE EXCEPTION 'v2_0050 must not introduce browser-owned tenant authority';
  END IF;
END
$$;

COMMIT;
