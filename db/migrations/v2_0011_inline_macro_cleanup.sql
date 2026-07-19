BEGIN;

DO $$
DECLARE
  rec record;
  transition jsonb;
  transitions_in jsonb;
  new_transitions jsonb;
  base_graph jsonb;
  macros jsonb;
  effects jsonb;
  macro_code text;
  from_text text;
  action_text text;
  to_text text;
  generated_code text;
  idx integer;
  changed boolean;
BEGIN
  FOR rec IN
    SELECT id, code, graph, attrs
    FROM eip_core.process_def
    FOR UPDATE
  LOOP
    base_graph := COALESCE(rec.graph, '{}'::jsonb);

    transitions_in := CASE
      WHEN jsonb_typeof(base_graph->'transitions') = 'array'
        THEN base_graph->'transitions'
      ELSE '[]'::jsonb
    END;

    macros := base_graph->'macros';
    IF COALESCE(jsonb_typeof(macros), '') <> 'object' THEN
      macros := '{}'::jsonb;
    END IF;

    new_transitions := '[]'::jsonb;
    idx := 0;
    changed := false;

    FOR transition IN
      SELECT value
      FROM jsonb_array_elements(transitions_in)
    LOOP
      idx := idx + 1;

      effects := CASE
        WHEN jsonb_typeof(transition->'effects') = 'array'
          AND jsonb_array_length(transition->'effects') > 0
          THEN transition->'effects'
        ELSE NULL
      END;

      macro_code := COALESCE(
        NULLIF(transition->>'macro_code', ''),
        NULLIF(transition->>'macroCode', '')
      );

      IF effects IS NOT NULL THEN
        IF macro_code IS NULL THEN
          from_text := regexp_replace(
            upper(COALESCE(NULLIF(transition->>'from', ''), 'NODE')),
            '[^A-Z0-9]+',
            '_',
            'g'
          );
          action_text := regexp_replace(
            upper(COALESCE(NULLIF(transition->>'action', ''), 'ACTION')),
            '[^A-Z0-9]+',
            '_',
            'g'
          );
          to_text := regexp_replace(
            upper(
              COALESCE(
                NULLIF(transition->>'to', ''),
                NULLIF(transition->>'target', ''),
                'NODE'
              )
            ),
            '[^A-Z0-9]+',
            '_',
            'g'
          );
          generated_code := format(
            'LEGACY_%s_%s_%s_%s',
            from_text,
            action_text,
            to_text,
            idx
          );
          macro_code := generated_code;
        END IF;

        IF NOT (macros ? macro_code) THEN
          macros := macros || jsonb_build_object(
            macro_code,
            jsonb_build_object(
              'code', macro_code,
              'label', format('Legacy Migrated Macro %s', macro_code),
              'effects', effects,
              'attrs', jsonb_build_object(
                'source', 'v2_0011_inline_cleanup',
                'legacy_inline', true
              )
            )
          );
        END IF;

        transition := jsonb_set(transition, '{macro_code}', to_jsonb(macro_code), true);
        transition := transition - 'macroCode';
        transition := transition - 'effects';
        changed := true;
      ELSE
        -- Normalize legacy key casing only.
        IF macro_code IS NOT NULL AND (transition ? 'macroCode') THEN
          transition := jsonb_set(transition, '{macro_code}', to_jsonb(macro_code), true);
          transition := transition - 'macroCode';
          changed := true;
        END IF;
      END IF;

      new_transitions := new_transitions || jsonb_build_array(transition);
    END LOOP;

    IF changed THEN
      UPDATE eip_core.process_def
      SET graph = jsonb_set(
                    jsonb_set(base_graph, '{macros}', macros, true),
                    '{transitions}',
                    new_transitions,
                    true
                  ),
          attrs = COALESCE(rec.attrs, '{}'::jsonb) || jsonb_build_object(
            'macro_layer', 'explicit_graph_registry',
            'macro_cleanup_wave', 'v2_0011'
          ),
          updated_at = now()
      WHERE id = rec.id;
    END IF;
  END LOOP;
END $$;

COMMIT;
