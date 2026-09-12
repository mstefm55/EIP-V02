BEGIN;

-- Process Studio integration lifecycle hardening.
-- No new feature tables: lifecycle is projected through existing process_def attrs.

UPDATE eip_core.process_def pd
SET attrs =
  (COALESCE(pd.attrs, '{}'::jsonb)
    - 'lifecycleStatus'
    - 'isPublished'
    - 'isArchived')
  || jsonb_build_object(
      'lifecycle_status',
      CASE
        WHEN lower(COALESCE(pd.attrs->>'lifecycle_status', '')) = 'archived'
          OR lower(COALESCE(pd.attrs->>'is_archived', 'false')) IN ('true','1','yes','on')
          THEN 'archived'
        WHEN lower(COALESCE(pd.attrs->>'lifecycle_status', '')) = 'published'
          OR lower(COALESCE(pd.attrs->>'is_published', 'false')) IN ('true','1','yes','on')
          OR EXISTS (
            SELECT 1
            FROM eip_core.process_binding pb
            WHERE pb.tenant_id = pd.tenant_id
              AND pb.process_def_id = pd.id
              AND pb.is_active = true
          )
          OR EXISTS (
            SELECT 1
            FROM eip_core.process_instance pi
            WHERE pi.tenant_id = pd.tenant_id
              AND pi.process_def_id = pd.id
          )
          THEN 'published'
        ELSE 'draft'
      END,
      'is_published',
      CASE
        WHEN lower(COALESCE(pd.attrs->>'lifecycle_status', '')) = 'archived'
          OR lower(COALESCE(pd.attrs->>'is_archived', 'false')) IN ('true','1','yes','on')
          THEN false
        WHEN lower(COALESCE(pd.attrs->>'lifecycle_status', '')) = 'published'
          OR lower(COALESCE(pd.attrs->>'is_published', 'false')) IN ('true','1','yes','on')
          OR EXISTS (
            SELECT 1
            FROM eip_core.process_binding pb
            WHERE pb.tenant_id = pd.tenant_id
              AND pb.process_def_id = pd.id
              AND pb.is_active = true
          )
          OR EXISTS (
            SELECT 1
            FROM eip_core.process_instance pi
            WHERE pi.tenant_id = pd.tenant_id
              AND pi.process_def_id = pd.id
          )
          THEN true
        ELSE false
      END
    )
  || CASE
      WHEN lower(COALESCE(pd.attrs->>'lifecycle_status', '')) = 'archived'
        OR lower(COALESCE(pd.attrs->>'is_archived', 'false')) IN ('true','1','yes','on')
        THEN jsonb_build_object('is_archived', true)
      ELSE '{}'::jsonb
    END;

ALTER TABLE eip_core.process_def
  DROP CONSTRAINT IF EXISTS process_def_lifecycle_status_ck;

ALTER TABLE eip_core.process_def
  ADD CONSTRAINT process_def_lifecycle_status_ck
  CHECK (
    COALESCE(attrs->>'lifecycle_status', 'draft') IN ('draft', 'published', 'archived')
  );

CREATE OR REPLACE FUNCTION eip_core.process_lifecycle_state(p_attrs jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_attrs->>'lifecycle_status', '')) = 'archived'
      OR lower(COALESCE(p_attrs->>'is_archived', 'false')) IN ('true','1','yes','on')
      THEN 'archived'
    WHEN lower(COALESCE(p_attrs->>'lifecycle_status', '')) = 'published'
      OR lower(COALESCE(p_attrs->>'is_published', 'false')) IN ('true','1','yes','on')
      THEN 'published'
    ELSE 'draft'
  END;
$$;

COMMENT ON FUNCTION eip_core.process_lifecycle_state(jsonb) IS
  'Canonical compatibility resolver for Process Definition lifecycle: draft, published, archived.';

CREATE OR REPLACE FUNCTION eip_core.enforce_process_definition_lifecycle_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_state text;
  new_state text;
  requested_publish boolean;
BEGIN
  NEW.attrs := COALESCE(NEW.attrs, '{}'::jsonb);

  IF TG_OP = 'INSERT' THEN
    new_state := eip_core.process_lifecycle_state(NEW.attrs);
    NEW.attrs := NEW.attrs
      - 'lifecycleStatus'
      - 'isPublished'
      - 'isArchived';

    IF new_state = 'published' THEN
      NEW.attrs := NEW.attrs
        || jsonb_build_object(
          'lifecycle_status', 'published',
          'is_published', true,
          'published_at', COALESCE(NEW.attrs->>'published_at', now()::text)
        );
      NEW.attrs := NEW.attrs - 'is_archived' - 'archived_at';
    ELSIF new_state = 'archived' THEN
      NEW.attrs := NEW.attrs
        || jsonb_build_object(
          'lifecycle_status', 'archived',
          'is_published', false,
          'is_archived', true,
          'archived_at', COALESCE(NEW.attrs->>'archived_at', now()::text)
        );
    ELSE
      NEW.attrs := NEW.attrs
        || jsonb_build_object('lifecycle_status', 'draft', 'is_published', false);
      NEW.attrs := NEW.attrs - 'is_archived' - 'published_at' - 'archived_at';
    END IF;
    RETURN NEW;
  END IF;

  old_state := eip_core.process_lifecycle_state(OLD.attrs);
  requested_publish := lower(COALESCE(NEW.attrs->>'is_published', 'false')) IN ('true','1','yes','on');
  new_state := eip_core.process_lifecycle_state(NEW.attrs);

  -- Compatibility with the existing validated publish route, which historically
  -- toggled is_published without writing lifecycle_status.
  IF old_state = 'draft'
     AND requested_publish
     AND lower(COALESCE(NEW.attrs->>'lifecycle_status', 'draft')) = 'draft'
  THEN
    new_state := 'published';
  END IF;

  IF old_state = 'archived' THEN
    IF NEW.code IS DISTINCT FROM OLD.code
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.graph IS DISTINCT FROM OLD.graph
       OR NEW.attrs IS DISTINCT FROM OLD.attrs
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
    THEN
      RAISE EXCEPTION 'PROCESS_DEF_ARCHIVED_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF old_state = 'published' THEN
    IF new_state = 'archived' THEN
      IF NEW.code IS DISTINCT FROM OLD.code
         OR NEW.name IS DISTINCT FROM OLD.name
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.graph IS DISTINCT FROM OLD.graph
      THEN
        RAISE EXCEPTION 'PROCESS_DEF_PUBLISHED_IMMUTABLE' USING ERRCODE = 'P0001';
      END IF;
      NEW.attrs := NEW.attrs
        - 'lifecycleStatus'
        - 'isPublished'
        - 'isArchived'
        || jsonb_build_object(
          'lifecycle_status', 'archived',
          'is_published', false,
          'is_archived', true,
          'archived_at', COALESCE(NEW.attrs->>'archived_at', now()::text)
        );
      RETURN NEW;
    END IF;

    IF NEW.code IS DISTINCT FROM OLD.code
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.graph IS DISTINCT FROM OLD.graph
       OR NEW.attrs IS DISTINCT FROM OLD.attrs
    THEN
      RAISE EXCEPTION 'PROCESS_DEF_PUBLISHED_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  NEW.attrs := NEW.attrs
    - 'lifecycleStatus'
    - 'isPublished'
    - 'isArchived';

  IF new_state = 'published' THEN
    NEW.attrs := NEW.attrs
      || jsonb_build_object(
        'lifecycle_status', 'published',
        'is_published', true,
        'published_at', COALESCE(NEW.attrs->>'published_at', now()::text)
      );
    NEW.attrs := NEW.attrs - 'is_archived' - 'archived_at';
  ELSIF new_state = 'archived' THEN
    NEW.attrs := NEW.attrs
      || jsonb_build_object(
        'lifecycle_status', 'archived',
        'is_published', false,
        'is_archived', true,
        'archived_at', COALESCE(NEW.attrs->>'archived_at', now()::text)
      );
  ELSE
    NEW.attrs := NEW.attrs
      || jsonb_build_object('lifecycle_status', 'draft', 'is_published', false);
    NEW.attrs := NEW.attrs - 'is_archived' - 'published_at' - 'archived_at';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS process_definition_lifecycle_v1_trg ON eip_core.process_def;
CREATE TRIGGER process_definition_lifecycle_v1_trg
BEFORE INSERT OR UPDATE ON eip_core.process_def
FOR EACH ROW
EXECUTE FUNCTION eip_core.enforce_process_definition_lifecycle_v1();

CREATE OR REPLACE FUNCTION eip_core.enforce_task_template_process_draft_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_process_def_id uuid;
  target_tenant_id uuid;
  lifecycle text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_process_def_id := OLD.process_def_id;
    target_tenant_id := OLD.tenant_id;
  ELSE
    target_process_def_id := NEW.process_def_id;
    target_tenant_id := NEW.tenant_id;
  END IF;

  SELECT eip_core.process_lifecycle_state(pd.attrs)
  INTO lifecycle
  FROM eip_core.process_def pd
  WHERE pd.tenant_id = target_tenant_id
    AND pd.id = target_process_def_id;

  IF lifecycle IS NULL THEN
    RAISE EXCEPTION 'PROCESS_DEF_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'PROCESS_DEF_%_IMMUTABLE', upper(lifecycle) USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_template_process_draft_v1_trg ON eip_core.task_template;
CREATE TRIGGER task_template_process_draft_v1_trg
BEFORE INSERT OR UPDATE OR DELETE ON eip_core.task_template
FOR EACH ROW
EXECUTE FUNCTION eip_core.enforce_task_template_process_draft_v1();

-- Existing active bindings are treated as evidence that a legacy definition was
-- deployed. Any binding that still targets a true draft after normalization is
-- made inert before the new guard is installed.
UPDATE eip_core.process_binding pb
SET is_active = false,
    updated_at = now()
FROM eip_core.process_def pd
WHERE pd.tenant_id = pb.tenant_id
  AND pd.id = pb.process_def_id
  AND pb.is_active = true
  AND eip_core.process_lifecycle_state(pd.attrs) <> 'published';

CREATE OR REPLACE FUNCTION eip_core.enforce_binding_published_target_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lifecycle text;
  target_active boolean;
BEGIN
  IF NEW.is_active IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  SELECT eip_core.process_lifecycle_state(pd.attrs), pd.is_active
  INTO lifecycle, target_active
  FROM eip_core.process_def pd
  WHERE pd.tenant_id = NEW.tenant_id
    AND pd.id = NEW.process_def_id;

  IF lifecycle IS NULL THEN
    RAISE EXCEPTION 'PROCESS_DEF_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF lifecycle <> 'published' OR target_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PROCESS_BINDING_TARGET_NOT_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS process_binding_published_target_v1_trg ON eip_core.process_binding;
CREATE TRIGGER process_binding_published_target_v1_trg
BEFORE INSERT OR UPDATE ON eip_core.process_binding
FOR EACH ROW
EXECUTE FUNCTION eip_core.enforce_binding_published_target_v1();

CREATE OR REPLACE FUNCTION eip_core.enforce_process_instance_published_def_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lifecycle text;
  target_active boolean;
BEGIN
  SELECT eip_core.process_lifecycle_state(pd.attrs), pd.is_active
  INTO lifecycle, target_active
  FROM eip_core.process_def pd
  WHERE pd.tenant_id = NEW.tenant_id
    AND pd.id = NEW.process_def_id;

  IF lifecycle IS NULL THEN
    RAISE EXCEPTION 'PROCESS_DEF_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF target_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PROCESS_DEF_INACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF lifecycle = 'archived' THEN
    RAISE EXCEPTION 'PROCESS_DEF_ARCHIVED' USING ERRCODE = 'P0001';
  END IF;
  IF lifecycle <> 'published' THEN
    RAISE EXCEPTION 'PROCESS_DEF_NOT_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS process_instance_published_def_v1_trg ON eip_core.process_instance;
CREATE TRIGGER process_instance_published_def_v1_trg
BEFORE INSERT ON eip_core.process_instance
FOR EACH ROW
EXECUTE FUNCTION eip_core.enforce_process_instance_published_def_v1();

CREATE OR REPLACE FUNCTION eip_core.activate_revision_bindings_on_publish_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF eip_core.process_lifecycle_state(OLD.attrs) <> 'published'
     AND eip_core.process_lifecycle_state(NEW.attrs) = 'published'
  THEN
    UPDATE eip_core.process_binding
    SET is_active = true,
        attrs = COALESCE(attrs, '{}'::jsonb) - '_studio_activate_on_publish',
        updated_at = now()
    WHERE tenant_id = NEW.tenant_id
      AND process_def_id = NEW.id
      AND lower(COALESCE(attrs->>'_studio_activate_on_publish', 'false')) IN ('true','1','yes','on');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS process_definition_activate_revision_bindings_v1_trg ON eip_core.process_def;
CREATE TRIGGER process_definition_activate_revision_bindings_v1_trg
AFTER UPDATE ON eip_core.process_def
FOR EACH ROW
EXECUTE FUNCTION eip_core.activate_revision_bindings_on_publish_v1();

COMMENT ON CONSTRAINT process_def_lifecycle_status_ck ON eip_core.process_def IS
  'Process Studio lifecycle is draft, published, or archived. Published/archived definition content is immutable.';

COMMIT;
