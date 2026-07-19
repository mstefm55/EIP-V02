BEGIN;

-- Extend governed action taxonomy used by ecom process definitions.
WITH action_lists AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_ACTION'
    AND is_active = true
    AND tenant_id IS NULL
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT
  action_lists.id,
  src.code,
  src.label,
  src.sort_order,
  true,
  '{}'::jsonb
FROM action_lists
CROSS JOIN (
  VALUES
    ('REVIEW_SUBMIT', 'Review Submit', 305),
    ('HIDE',          'Hide',          306),
    ('UNHIDE',        'Unhide',        307)
) AS src(code, label, sort_order)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

-- Extend governed service-object statuses used by ecom flows.
WITH status_lists AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'SERVICE_OBJECT_STATUS'
    AND is_active = true
    AND tenant_id IS NULL
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT
  status_lists.id,
  src.code,
  src.label,
  src.sort_order,
  true,
  src.attrs::jsonb
FROM status_lists
CROSS JOIN (
  VALUES
    ('review',         'Review',         35, '{"module":"ecom","scope":"status","service_object_category":"content"}'),
    ('approved',       'Approved',       45, '{"module":"ecom","scope":"status","service_object_category":"content"}'),
    ('published',      'Published',      55, '{"module":"ecom","scope":"status","service_object_category":"content"}'),
    ('rejected',       'Rejected',       65, '{"module":"ecom","scope":"status","service_object_category":"moderation"}'),
    ('pending_review', 'Pending Review', 70, '{"module":"ecom","scope":"status","service_object_type":"product_review","service_object_category":"moderation"}'),
    ('hidden',         'Hidden',         75, '{"module":"ecom","scope":"status","service_object_type":"product_review","service_object_category":"moderation"}'),
    ('visible',        'Visible',        76, '{"module":"ecom","scope":"status","service_object_type":"product_review","service_object_category":"moderation"}')
) AS src(code, label, sort_order, attrs)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    attrs = EXCLUDED.attrs,
    updated_at = now();

DO $$
DECLARE
  v_tenant_id uuid;
  v_storefront_def_id uuid;
  v_review_def_id uuid;
  v_blog_def_id uuid;
BEGIN
  FOR v_tenant_id IN
    SELECT tenant_id
    FROM kernel.tenants
    WHERE tenant_status = 'active'
  LOOP
    INSERT INTO eip_core.process_def
      (tenant_id, code, name, version, is_active, graph, attrs)
    VALUES
      (
        v_tenant_id,
        'ECOM_STOREFRONT_CONTENT_FLOW',
        'Ecom Storefront Content Flow',
        1,
        true,
        $json$
        {
          "version": 1,
          "object_type": "storefront_content",
          "initial_node": "content_intake",
          "nodes": [
            { "id": "content_intake", "type": "TRIGGER", "label": "Content Intake" },
            { "id": "content_draft", "type": "STEP", "label": "Draft" },
            { "id": "content_review", "type": "STEP", "label": "Moderation" },
            { "id": "content_published", "type": "STEP", "label": "Published" },
            { "id": "content_closed", "type": "TERMINAL", "label": "Closed", "is_terminal": true }
          ],
          "transitions": [
            {
              "from": "content_intake",
              "to": "content_draft",
              "action": "INTAKE",
              "task_label": "Prepare Content",
              "macro_code": "ECOM_CONTENT_DRAFT_OPEN",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "new", "service_object_type": "storefront_content", "service_object_category": "content_slot", "effect_instance": "StorefrontContent_StatusSet_content_slot" }
              ]
            },
            {
              "from": "content_draft",
              "to": "content_review",
              "action": "DRAFT_READY",
              "task_label": "Submit For Moderation",
              "macro_code": "ECOM_CONTENT_DRAFT_SUBMIT",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "review", "service_object_type": "storefront_content", "service_object_category": "content_slot", "effect_instance": "StorefrontContent_StatusSet_content_slot" }
              ]
            },
            {
              "from": "content_review",
              "to": "content_published",
              "action": "APPROVE",
              "task_label": "Approve Content",
              "macro_code": "ECOM_CONTENT_MODERATION_DECISION",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "published", "service_object_type": "storefront_content", "service_object_category": "content_slot", "effect_instance": "StorefrontContent_StatusSet_content_slot" }
              ]
            },
            {
              "from": "content_review",
              "to": "content_draft",
              "action": "REJECT",
              "task_label": "Reject Content",
              "macro_code": "ECOM_CONTENT_MODERATION_DECISION",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "rejected", "service_object_type": "storefront_content", "service_object_category": "content_slot", "effect_instance": "StorefrontContent_StatusSet_content_slot" }
              ]
            },
            {
              "from": "content_published",
              "to": "content_closed",
              "action": "CANCEL",
              "task_label": "Close Content",
              "macro_code": "ECOM_CONTENT_CLOSE",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "cancelled", "service_object_type": "storefront_content", "service_object_category": "content_slot", "effect_instance": "StorefrontContent_StatusSet_content_slot" }
              ]
            }
          ]
        }
        $json$::jsonb,
        $json$
        {
          "module": "ecom",
          "object_type": "storefront_content",
          "service_object_category": "content_slot",
          "macro_layer": "implicit_transition_bundle",
          "source": "v2_0008"
        }
        $json$::jsonb
      )
    ON CONFLICT (tenant_id, code, version) DO UPDATE
      SET name = EXCLUDED.name,
          is_active = EXCLUDED.is_active,
          graph = EXCLUDED.graph,
          attrs = EXCLUDED.attrs,
          updated_at = now()
    RETURNING id INTO v_storefront_def_id;

    INSERT INTO eip_core.process_def
      (tenant_id, code, name, version, is_active, graph, attrs)
    VALUES
      (
        v_tenant_id,
        'ECOM_PRODUCT_REVIEW_FLOW',
        'Ecom Product Review Flow',
        1,
        true,
        $json$
        {
          "version": 1,
          "object_type": "product_review",
          "initial_node": "review_intake",
          "nodes": [
            { "id": "review_intake", "type": "TRIGGER", "label": "Review Intake" },
            { "id": "review_pending", "type": "STEP", "label": "Pending Review" },
            { "id": "review_visible", "type": "STEP", "label": "Visible" },
            { "id": "review_hidden", "type": "STEP", "label": "Hidden" },
            { "id": "review_closed", "type": "TERMINAL", "label": "Closed", "is_terminal": true }
          ],
          "transitions": [
            {
              "from": "review_intake",
              "to": "review_pending",
              "action": "REVIEW_SUBMIT",
              "task_label": "Queue Review",
              "macro_code": "ECOM_REVIEW_SUBMIT",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "pending_review", "service_object_type": "product_review", "service_object_category": "moderation", "effect_instance": "ProductReview_StatusSet_moderation" }
              ]
            },
            {
              "from": "review_pending",
              "to": "review_visible",
              "action": "APPROVE",
              "task_label": "Approve Review",
              "macro_code": "ECOM_REVIEW_MODERATION",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "visible", "service_object_type": "product_review", "service_object_category": "moderation", "effect_instance": "ProductReview_StatusSet_moderation" }
              ]
            },
            {
              "from": "review_pending",
              "to": "review_hidden",
              "action": "HIDE",
              "task_label": "Hide Review",
              "macro_code": "ECOM_REVIEW_MODERATION",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "hidden", "service_object_type": "product_review", "service_object_category": "moderation", "effect_instance": "ProductReview_StatusSet_moderation" }
              ]
            },
            {
              "from": "review_hidden",
              "to": "review_visible",
              "action": "UNHIDE",
              "task_label": "Unhide Review",
              "macro_code": "ECOM_REVIEW_MODERATION",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "visible", "service_object_type": "product_review", "service_object_category": "moderation", "effect_instance": "ProductReview_StatusSet_moderation" }
              ]
            },
            {
              "from": "review_pending",
              "to": "review_closed",
              "action": "REJECT",
              "task_label": "Reject Review",
              "macro_code": "ECOM_REVIEW_MODERATION",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "rejected", "service_object_type": "product_review", "service_object_category": "moderation", "effect_instance": "ProductReview_StatusSet_moderation" }
              ]
            }
          ]
        }
        $json$::jsonb,
        $json$
        {
          "module": "ecom",
          "object_type": "product_review",
          "service_object_category": "moderation",
          "macro_layer": "implicit_transition_bundle",
          "source": "v2_0008"
        }
        $json$::jsonb
      )
    ON CONFLICT (tenant_id, code, version) DO UPDATE
      SET name = EXCLUDED.name,
          is_active = EXCLUDED.is_active,
          graph = EXCLUDED.graph,
          attrs = EXCLUDED.attrs,
          updated_at = now()
    RETURNING id INTO v_review_def_id;

    INSERT INTO eip_core.process_def
      (tenant_id, code, name, version, is_active, graph, attrs)
    VALUES
      (
        v_tenant_id,
        'ECOM_BLOG_POST_FLOW',
        'Ecom Blog Post Flow',
        1,
        true,
        $json$
        {
          "version": 1,
          "object_type": "blog_post",
          "initial_node": "blog_intake",
          "nodes": [
            { "id": "blog_intake", "type": "TRIGGER", "label": "Blog Intake" },
            { "id": "blog_draft", "type": "STEP", "label": "Draft" },
            { "id": "blog_published", "type": "STEP", "label": "Published" },
            { "id": "blog_rejected", "type": "STEP", "label": "Rejected" },
            { "id": "blog_closed", "type": "TERMINAL", "label": "Closed", "is_terminal": true }
          ],
          "transitions": [
            {
              "from": "blog_intake",
              "to": "blog_draft",
              "action": "INTAKE",
              "task_label": "Prepare Draft",
              "macro_code": "ECOM_BLOG_DRAFT_OPEN",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "new", "service_object_type": "blog_post", "service_object_category": "editorial", "effect_instance": "BlogPost_StatusSet_editorial" }
              ]
            },
            {
              "from": "blog_draft",
              "to": "blog_published",
              "action": "PUBLISH",
              "task_label": "Publish Post",
              "macro_code": "ECOM_BLOG_EDITORIAL_DECISION",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "published", "service_object_type": "blog_post", "service_object_category": "editorial", "effect_instance": "BlogPost_StatusSet_editorial" }
              ]
            },
            {
              "from": "blog_draft",
              "to": "blog_rejected",
              "action": "REJECT",
              "task_label": "Reject Draft",
              "macro_code": "ECOM_BLOG_EDITORIAL_DECISION",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "rejected", "service_object_type": "blog_post", "service_object_category": "editorial", "effect_instance": "BlogPost_StatusSet_editorial" }
              ]
            },
            {
              "from": "blog_rejected",
              "to": "blog_draft",
              "action": "REOPEN",
              "task_label": "Reopen Draft",
              "macro_code": "ECOM_BLOG_EDITORIAL_DECISION",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "new", "service_object_type": "blog_post", "service_object_category": "editorial", "effect_instance": "BlogPost_StatusSet_editorial" }
              ]
            },
            {
              "from": "blog_published",
              "to": "blog_closed",
              "action": "CANCEL",
              "task_label": "Archive Post",
              "macro_code": "ECOM_BLOG_CLOSE",
              "edge_type": "DEFAULT",
              "effects": [
                { "type": "STATUS_SET", "to": "cancelled", "service_object_type": "blog_post", "service_object_category": "editorial", "effect_instance": "BlogPost_StatusSet_editorial" }
              ]
            }
          ]
        }
        $json$::jsonb,
        $json$
        {
          "module": "ecom",
          "object_type": "blog_post",
          "service_object_category": "editorial",
          "macro_layer": "implicit_transition_bundle",
          "source": "v2_0008"
        }
        $json$::jsonb
      )
    ON CONFLICT (tenant_id, code, version) DO UPDATE
      SET name = EXCLUDED.name,
          is_active = EXCLUDED.is_active,
          graph = EXCLUDED.graph,
          attrs = EXCLUDED.attrs,
          updated_at = now()
    RETURNING id INTO v_blog_def_id;

    INSERT INTO eip_core.process_binding
      (tenant_id, service_object_type, process_def_id, task_type, is_active, priority, attrs)
    SELECT
      v_tenant_id,
      'storefront_content',
      v_storefront_def_id,
      NULL,
      true,
      50,
      '{"source":"v2_0008","apply_on_create":true,"service_object_category":"content_slot"}'::jsonb
    WHERE NOT EXISTS (
      SELECT 1
      FROM eip_core.process_binding pb
      WHERE pb.tenant_id = v_tenant_id
        AND pb.service_object_type = 'storefront_content'
        AND pb.process_def_id = v_storefront_def_id
        AND COALESCE(pb.task_type, '') = ''
    );

    UPDATE eip_core.process_binding
    SET is_active = true,
        priority = 50,
        attrs = '{"source":"v2_0008","apply_on_create":true,"service_object_category":"content_slot"}'::jsonb,
        updated_at = now()
    WHERE tenant_id = v_tenant_id
      AND service_object_type = 'storefront_content'
      AND process_def_id = v_storefront_def_id
      AND COALESCE(task_type, '') = '';

    INSERT INTO eip_core.process_binding
      (tenant_id, service_object_type, process_def_id, task_type, is_active, priority, attrs)
    SELECT
      v_tenant_id,
      'product_review',
      v_review_def_id,
      NULL,
      true,
      50,
      '{"source":"v2_0008","apply_on_create":true,"service_object_category":"moderation"}'::jsonb
    WHERE NOT EXISTS (
      SELECT 1
      FROM eip_core.process_binding pb
      WHERE pb.tenant_id = v_tenant_id
        AND pb.service_object_type = 'product_review'
        AND pb.process_def_id = v_review_def_id
        AND COALESCE(pb.task_type, '') = ''
    );

    UPDATE eip_core.process_binding
    SET is_active = true,
        priority = 50,
        attrs = '{"source":"v2_0008","apply_on_create":true,"service_object_category":"moderation"}'::jsonb,
        updated_at = now()
    WHERE tenant_id = v_tenant_id
      AND service_object_type = 'product_review'
      AND process_def_id = v_review_def_id
      AND COALESCE(task_type, '') = '';

    INSERT INTO eip_core.process_binding
      (tenant_id, service_object_type, process_def_id, task_type, is_active, priority, attrs)
    SELECT
      v_tenant_id,
      'blog_post',
      v_blog_def_id,
      NULL,
      true,
      50,
      '{"source":"v2_0008","apply_on_create":true,"service_object_category":"editorial"}'::jsonb
    WHERE NOT EXISTS (
      SELECT 1
      FROM eip_core.process_binding pb
      WHERE pb.tenant_id = v_tenant_id
        AND pb.service_object_type = 'blog_post'
        AND pb.process_def_id = v_blog_def_id
        AND COALESCE(pb.task_type, '') = ''
    );

    UPDATE eip_core.process_binding
    SET is_active = true,
        priority = 50,
        attrs = '{"source":"v2_0008","apply_on_create":true,"service_object_category":"editorial"}'::jsonb,
        updated_at = now()
    WHERE tenant_id = v_tenant_id
      AND service_object_type = 'blog_post'
      AND process_def_id = v_blog_def_id
      AND COALESCE(task_type, '') = '';
  END LOOP;
END $$;

COMMIT;
