BEGIN;

-- Tenant-layer governed keys consumed by runtime resolver:
-- - OWNER_ADMIN_SHELL_PROFILE_SELECTION
-- - OWNER_ADMIN_SHELL_THEME_OVERRIDE

CREATE TABLE IF NOT EXISTS eip_core.ui_shell_profile (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL,
    label text NOT NULL,
    profile_scope text NOT NULL DEFAULT 'platform',
    template_kind text,
    template_key text,
    is_active boolean NOT NULL DEFAULT true,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ui_shell_profile_code_uk UNIQUE (code),
    CONSTRAINT ui_shell_profile_code_not_blank_ck CHECK (btrim(code) <> ''),
    CONSTRAINT ui_shell_profile_label_not_blank_ck CHECK (btrim(label) <> ''),
    CONSTRAINT ui_shell_profile_scope_ck CHECK (profile_scope IN ('platform', 'template')),
    CONSTRAINT ui_shell_profile_template_kind_ck CHECK (
      template_kind IS NULL OR template_kind IN ('industry', 'business_type')
    ),
    CONSTRAINT ui_shell_profile_template_shape_ck CHECK (
      (profile_scope = 'platform' AND template_kind IS NULL AND template_key IS NULL)
      OR
      (profile_scope = 'template' AND template_kind IS NOT NULL AND btrim(COALESCE(template_key, '')) <> '')
    ),
    CONSTRAINT ui_shell_profile_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS ui_shell_profile_scope_idx
    ON eip_core.ui_shell_profile (profile_scope, template_kind, template_key, is_active);

COMMENT ON TABLE eip_core.ui_shell_profile IS
  'Owner-admin shell profile identity registry. Platform/template profile identity is separated from ui_surface composition.';
COMMENT ON COLUMN eip_core.ui_shell_profile.profile_scope IS
  'platform = canonical platform shell profile, template = approved industry/business-type variant.';

CREATE TABLE IF NOT EXISTS eip_core.ui_shell_profile_revision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES eip_core.ui_shell_profile (id) ON DELETE CASCADE,
    version integer NOT NULL,
    lifecycle_status text NOT NULL DEFAULT 'draft',
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    notes text,
    previous_revision_id uuid REFERENCES eip_core.ui_shell_profile_revision (id) ON DELETE SET NULL,
    rollback_of_revision_id uuid REFERENCES eip_core.ui_shell_profile_revision (id) ON DELETE SET NULL,
    created_by_identity_id uuid REFERENCES eip_auth.auth_identity (id) ON DELETE SET NULL,
    published_by_identity_id uuid REFERENCES eip_auth.auth_identity (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT ui_shell_profile_revision_unique UNIQUE (profile_id, version),
    CONSTRAINT ui_shell_profile_revision_version_ck CHECK (version > 0),
    CONSTRAINT ui_shell_profile_revision_status_ck CHECK (
      lifecycle_status IN ('draft', 'published', 'archived')
    ),
    CONSTRAINT ui_shell_profile_revision_payload_object_ck CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT ui_shell_profile_revision_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object'),
    CONSTRAINT ui_shell_profile_revision_publish_ck CHECK (
      (lifecycle_status = 'published' AND published_at IS NOT NULL)
      OR
      (lifecycle_status IN ('draft', 'archived'))
    )
);

CREATE INDEX IF NOT EXISTS ui_shell_profile_revision_lookup_idx
    ON eip_core.ui_shell_profile_revision (profile_id, lifecycle_status, version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ui_shell_profile_revision_one_published_uk
    ON eip_core.ui_shell_profile_revision (profile_id)
    WHERE lifecycle_status = 'published';

CREATE UNIQUE INDEX IF NOT EXISTS ui_shell_profile_revision_one_draft_uk
    ON eip_core.ui_shell_profile_revision (profile_id)
    WHERE lifecycle_status = 'draft';

COMMENT ON TABLE eip_core.ui_shell_profile_revision IS
  'Versioned shell profile payloads with draft/published lifecycle and rollback lineage.';
COMMENT ON COLUMN eip_core.ui_shell_profile_revision.rollback_of_revision_id IS
  'When populated, identifies the historical revision whose payload was used for rollback publish.';

CREATE TABLE IF NOT EXISTS eip_core.ui_shell_profile_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES eip_core.ui_shell_profile (id) ON DELETE CASCADE,
    revision_id uuid REFERENCES eip_core.ui_shell_profile_revision (id) ON DELETE SET NULL,
    event_type text NOT NULL,
    actor_identity_id uuid REFERENCES eip_auth.auth_identity (id) ON DELETE SET NULL,
    event_at timestamptz NOT NULL DEFAULT now(),
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT ui_shell_profile_event_type_ck CHECK (
      event_type IN ('seeded', 'draft_created', 'draft_published', 'published_archived', 'rollback_published')
    ),
    CONSTRAINT ui_shell_profile_event_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS ui_shell_profile_event_profile_idx
    ON eip_core.ui_shell_profile_event (profile_id, event_at DESC);

COMMENT ON TABLE eip_core.ui_shell_profile_event IS
  'Append-only audit events for owner-admin shell profile lifecycle actions.';

WITH list_ref AS (
  SELECT list.id
  FROM eip_core.dropdown_list AS list
  WHERE list.module = 'ui'
    AND list.code = 'OWNER_ADMIN_SHELL_PROFILE'
    AND list.is_active = true
  ORDER BY list.version DESC
  LIMIT 1
),
legacy_profiles AS (
  SELECT
    value.code,
    value.label,
    COALESCE(value.attrs, '{}'::jsonb) AS payload,
    CASE
      WHEN value.code = 'EIP_CORE_STANDARD' THEN 'platform'
      ELSE 'template'
    END AS profile_scope,
    CASE
      WHEN value.code = 'EIP_CORE_STANDARD' THEN NULL
      ELSE 'industry'
    END AS template_kind,
    CASE
      WHEN value.code = 'EIP_CORE_STANDARD' THEN NULL
      ELSE 'ecom'
    END AS template_key
  FROM eip_core.dropdown_value AS value
  JOIN list_ref ON list_ref.id = value.list_id
  WHERE value.is_active = true
)
INSERT INTO eip_core.ui_shell_profile
  (code, label, profile_scope, template_kind, template_key, is_active, attrs)
SELECT
  legacy.code,
  legacy.label,
  legacy.profile_scope,
  legacy.template_kind,
  legacy.template_key,
  true,
  jsonb_build_object(
    'source', 'v2_0019',
    'legacy_source', 'OWNER_ADMIN_SHELL_PROFILE'
  )
FROM legacy_profiles AS legacy
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      profile_scope = EXCLUDED.profile_scope,
      template_kind = EXCLUDED.template_kind,
      template_key = EXCLUDED.template_key,
      is_active = true,
      updated_at = now();

WITH list_ref AS (
  SELECT list.id
  FROM eip_core.dropdown_list AS list
  WHERE list.module = 'ui'
    AND list.code = 'OWNER_ADMIN_SHELL_PROFILE'
    AND list.is_active = true
  ORDER BY list.version DESC
  LIMIT 1
),
legacy_profiles AS (
  SELECT
    value.code,
    COALESCE(value.attrs, '{}'::jsonb) AS payload
  FROM eip_core.dropdown_value AS value
  JOIN list_ref ON list_ref.id = value.list_id
  WHERE value.is_active = true
)
INSERT INTO eip_core.ui_shell_profile_revision
  (
    profile_id,
    version,
    lifecycle_status,
    payload,
    notes,
    created_at,
    published_at,
    updated_at,
    attrs
  )
SELECT
  profile.id AS profile_id,
  1,
  'published',
  legacy.payload,
  'Seeded from OWNER_ADMIN_SHELL_PROFILE baseline',
  now(),
  now(),
  now(),
  jsonb_build_object('source', 'v2_0019_seed')
FROM eip_core.ui_shell_profile AS profile
JOIN legacy_profiles AS legacy ON legacy.code = profile.code
ON CONFLICT (profile_id, version) DO NOTHING;

INSERT INTO eip_core.ui_shell_profile_event
  (profile_id, revision_id, event_type, event_at, attrs)
SELECT
  revision.profile_id,
  revision.id,
  'seeded',
  now(),
  jsonb_build_object(
    'source', 'v2_0019_seed',
    'version', revision.version
  )
FROM eip_core.ui_shell_profile_revision AS revision
JOIN eip_core.ui_shell_profile AS profile ON profile.id = revision.profile_id
WHERE revision.version = 1
  AND revision.lifecycle_status = 'published'
  AND profile.code IN ('EIP_CORE_STANDARD', 'EIP_ECOM_STANDARD', 'EIP_ECOM_REVIEW')
  AND NOT EXISTS (
    SELECT 1
    FROM eip_core.ui_shell_profile_event AS event
    WHERE event.profile_id = revision.profile_id
      AND event.revision_id = revision.id
      AND event.event_type = 'seeded'
  );

CREATE OR REPLACE FUNCTION eip_core.ui_shell_profile_create_draft(
  p_profile_code text,
  p_source_version integer DEFAULT NULL,
  p_actor_identity_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile_id uuid;
  v_source_revision_id uuid;
  v_source_payload jsonb;
  v_source_version integer;
  v_next_version integer;
  v_current_published_version integer;
  v_new_revision_id uuid;
BEGIN
  SELECT profile.id
  INTO v_profile_id
  FROM eip_core.ui_shell_profile AS profile
  WHERE profile.code = p_profile_code
    AND profile.is_active = true
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'SHELL_PROFILE_NOT_FOUND: %', p_profile_code;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM eip_core.ui_shell_profile_revision AS revision
    WHERE revision.profile_id = v_profile_id
      AND revision.lifecycle_status = 'draft'
  ) THEN
    RAISE EXCEPTION 'SHELL_PROFILE_DRAFT_EXISTS: %', p_profile_code;
  END IF;

  IF p_source_version IS NULL THEN
    SELECT revision.id, revision.version, revision.payload
    INTO v_source_revision_id, v_source_version, v_source_payload
    FROM eip_core.ui_shell_profile_revision AS revision
    WHERE revision.profile_id = v_profile_id
      AND revision.lifecycle_status = 'published'
    ORDER BY revision.version DESC
    LIMIT 1;
  ELSE
    SELECT revision.id, revision.version, revision.payload
    INTO v_source_revision_id, v_source_version, v_source_payload
    FROM eip_core.ui_shell_profile_revision AS revision
    WHERE revision.profile_id = v_profile_id
      AND revision.version = p_source_version
    LIMIT 1;
  END IF;

  IF v_source_revision_id IS NULL THEN
    RAISE EXCEPTION 'SHELL_PROFILE_SOURCE_VERSION_NOT_FOUND: % / %', p_profile_code, COALESCE(p_source_version::text, 'published');
  END IF;

  SELECT revision.version
  INTO v_current_published_version
  FROM eip_core.ui_shell_profile_revision AS revision
  WHERE revision.profile_id = v_profile_id
    AND revision.lifecycle_status = 'published'
  ORDER BY revision.version DESC
  LIMIT 1;

  SELECT COALESCE(MAX(revision.version), 0) + 1
  INTO v_next_version
  FROM eip_core.ui_shell_profile_revision AS revision
  WHERE revision.profile_id = v_profile_id;

  INSERT INTO eip_core.ui_shell_profile_revision
    (
      profile_id,
      version,
      lifecycle_status,
      payload,
      notes,
      previous_revision_id,
      rollback_of_revision_id,
      created_by_identity_id,
      created_at,
      updated_at,
      attrs
    )
  VALUES
    (
      v_profile_id,
      v_next_version,
      'draft',
      v_source_payload,
      p_note,
      v_source_revision_id,
      CASE
        WHEN p_source_version IS NOT NULL
             AND v_current_published_version IS NOT NULL
             AND p_source_version <> v_current_published_version
          THEN v_source_revision_id
        ELSE NULL
      END,
      p_actor_identity_id,
      now(),
      now(),
      jsonb_build_object(
        'workflow', 'ui_shell_profile_create_draft',
        'source_version', v_source_version
      ) || CASE
             WHEN btrim(COALESCE(p_note, '')) = '' THEN '{}'::jsonb
             ELSE jsonb_build_object('note', p_note)
           END
    )
  RETURNING id
  INTO v_new_revision_id;

  INSERT INTO eip_core.ui_shell_profile_event
    (profile_id, revision_id, event_type, actor_identity_id, event_at, attrs)
  VALUES
    (
      v_profile_id,
      v_new_revision_id,
      'draft_created',
      p_actor_identity_id,
      now(),
      jsonb_build_object(
        'version', v_next_version,
        'source_version', v_source_version
      ) || CASE
             WHEN btrim(COALESCE(p_note, '')) = '' THEN '{}'::jsonb
             ELSE jsonb_build_object('note', p_note)
           END
    );

  UPDATE eip_core.ui_shell_profile
  SET updated_at = now()
  WHERE id = v_profile_id;

  RETURN v_next_version;
END;
$$;

CREATE OR REPLACE FUNCTION eip_core.ui_shell_profile_publish(
  p_profile_code text,
  p_version integer,
  p_actor_identity_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile_id uuid;
  v_target_revision_id uuid;
  v_previous_published_revision_id uuid;
  v_previous_published_version integer;
BEGIN
  SELECT profile.id
  INTO v_profile_id
  FROM eip_core.ui_shell_profile AS profile
  WHERE profile.code = p_profile_code
    AND profile.is_active = true
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'SHELL_PROFILE_NOT_FOUND: %', p_profile_code;
  END IF;

  SELECT revision.id
  INTO v_target_revision_id
  FROM eip_core.ui_shell_profile_revision AS revision
  WHERE revision.profile_id = v_profile_id
    AND revision.version = p_version
    AND revision.lifecycle_status = 'draft'
  LIMIT 1;

  IF v_target_revision_id IS NULL THEN
    RAISE EXCEPTION 'SHELL_PROFILE_DRAFT_VERSION_NOT_FOUND: % / %', p_profile_code, p_version;
  END IF;

  SELECT revision.id, revision.version
  INTO v_previous_published_revision_id, v_previous_published_version
  FROM eip_core.ui_shell_profile_revision AS revision
  WHERE revision.profile_id = v_profile_id
    AND revision.lifecycle_status = 'published'
  ORDER BY revision.version DESC
  LIMIT 1;

  IF v_previous_published_revision_id IS NOT NULL THEN
    UPDATE eip_core.ui_shell_profile_revision
    SET lifecycle_status = 'archived',
        updated_at = now(),
        attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object(
          'archived_at', now(),
          'archived_by_publish_version', p_version
        )
    WHERE id = v_previous_published_revision_id;

    INSERT INTO eip_core.ui_shell_profile_event
      (profile_id, revision_id, event_type, actor_identity_id, event_at, attrs)
    VALUES
      (
        v_profile_id,
        v_previous_published_revision_id,
        'published_archived',
        p_actor_identity_id,
        now(),
        jsonb_build_object(
          'archived_by_version', p_version,
          'archived_version', v_previous_published_version
        )
      );
  END IF;

  UPDATE eip_core.ui_shell_profile_revision
  SET lifecycle_status = 'published',
      published_at = now(),
      published_by_identity_id = COALESCE(p_actor_identity_id, published_by_identity_id),
      updated_at = now(),
      attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object(
        'publish_note', COALESCE(p_note, ''),
        'published_version', p_version
      )
  WHERE id = v_target_revision_id;

  INSERT INTO eip_core.ui_shell_profile_event
    (profile_id, revision_id, event_type, actor_identity_id, event_at, attrs)
  VALUES
    (
      v_profile_id,
      v_target_revision_id,
      'draft_published',
      p_actor_identity_id,
      now(),
      jsonb_build_object(
        'published_version', p_version,
        'replaced_version', v_previous_published_version
      ) || CASE
             WHEN btrim(COALESCE(p_note, '')) = '' THEN '{}'::jsonb
             ELSE jsonb_build_object('note', p_note)
           END
    );

  UPDATE eip_core.ui_shell_profile
  SET updated_at = now()
  WHERE id = v_profile_id;

  RETURN p_version;
END;
$$;

CREATE OR REPLACE FUNCTION eip_core.ui_shell_profile_rollback_publish(
  p_profile_code text,
  p_target_version integer,
  p_actor_identity_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile_id uuid;
  v_target_revision_id uuid;
  v_new_version integer;
BEGIN
  SELECT profile.id
  INTO v_profile_id
  FROM eip_core.ui_shell_profile AS profile
  WHERE profile.code = p_profile_code
    AND profile.is_active = true
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'SHELL_PROFILE_NOT_FOUND: %', p_profile_code;
  END IF;

  SELECT revision.id
  INTO v_target_revision_id
  FROM eip_core.ui_shell_profile_revision AS revision
  WHERE revision.profile_id = v_profile_id
    AND revision.version = p_target_version
  LIMIT 1;

  IF v_target_revision_id IS NULL THEN
    RAISE EXCEPTION 'SHELL_PROFILE_ROLLBACK_TARGET_NOT_FOUND: % / %', p_profile_code, p_target_version;
  END IF;

  v_new_version := eip_core.ui_shell_profile_create_draft(
    p_profile_code,
    p_target_version,
    p_actor_identity_id,
    p_note
  );

  PERFORM eip_core.ui_shell_profile_publish(
    p_profile_code,
    v_new_version,
    p_actor_identity_id,
    p_note
  );

  UPDATE eip_core.ui_shell_profile_revision
  SET rollback_of_revision_id = v_target_revision_id,
      attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object(
        'rollback_target_version', p_target_version
      )
  WHERE profile_id = v_profile_id
    AND version = v_new_version;

  INSERT INTO eip_core.ui_shell_profile_event
    (profile_id, revision_id, event_type, actor_identity_id, event_at, attrs)
  SELECT
    v_profile_id,
    revision.id,
    'rollback_published',
    p_actor_identity_id,
    now(),
    jsonb_build_object(
      'rollback_target_version', p_target_version,
      'published_version', v_new_version
    ) || CASE
           WHEN btrim(COALESCE(p_note, '')) = '' THEN '{}'::jsonb
           ELSE jsonb_build_object('note', p_note)
         END
  FROM eip_core.ui_shell_profile_revision AS revision
  WHERE revision.profile_id = v_profile_id
    AND revision.version = v_new_version;

  RETURN v_new_version;
END;
$$;

CREATE OR REPLACE VIEW eip_core.ui_shell_profile_published AS
SELECT
  profile.id AS profile_id,
  profile.code AS profile_code,
  profile.label AS profile_label,
  profile.profile_scope,
  profile.template_kind,
  profile.template_key,
  profile.attrs AS profile_attrs,
  profile.updated_at AS profile_updated_at,
  revision.id AS revision_id,
  revision.version AS profile_version,
  revision.payload,
  revision.published_at,
  revision.updated_at AS revision_updated_at
FROM eip_core.ui_shell_profile AS profile
JOIN LATERAL (
  SELECT
    revision.id,
    revision.version,
    revision.payload,
    revision.published_at,
    revision.updated_at
  FROM eip_core.ui_shell_profile_revision AS revision
  WHERE revision.profile_id = profile.id
    AND revision.lifecycle_status = 'published'
  ORDER BY revision.version DESC
  LIMIT 1
) AS revision ON true
WHERE profile.is_active = true;

COMMENT ON VIEW eip_core.ui_shell_profile_published IS
  'Runtime view of currently published shell profiles. ui_surface runtime should resolve shell_theme payloads from this view, not from ui_surface attrs.';

COMMIT;
