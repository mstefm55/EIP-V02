BEGIN;

DO $$
DECLARE
  v_tenant_id uuid;
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
          "macros": {
            "ECOM_CONTENT_DRAFT_OPEN": {
              "code": "ECOM_CONTENT_DRAFT_OPEN",
              "label": "Prepare Content",
              "effects": [
                { "type": "STATUS_SET", "to": "new", "service_object_type": "storefront_content", "service_object_category": "content_slot", "effect_instance": "StorefrontContent_StatusSet_content_slot" }
              ]
            },
            "ECOM_CONTENT_DRAFT_SUBMIT": {
              "code": "ECOM_CONTENT_DRAFT_SUBMIT",
              "label": "Submit For Moderation",
              "effects": [
                { "type": "STATUS_SET", "to": "review", "service_object_type": "storefront_content", "service_object_category": "content_slot", "effect_instance": "StorefrontContent_StatusSet_content_slot" }
              ]
            },
            "ECOM_CONTENT_MODERATION_DECISION": {
              "code": "ECOM_CONTENT_MODERATION_DECISION",
              "label": "Moderation Decision",
              "effects": [
                { "type": "STATUS_SET", "to": "published", "service_object_type": "storefront_content", "service_object_category": "content_slot", "effect_instance": "StorefrontContent_StatusSet_content_slot" }
              ]
            },
            "ECOM_CONTENT_MODERATION_REJECT": {
              "code": "ECOM_CONTENT_MODERATION_REJECT",
              "label": "Reject Content",
              "effects": [
                { "type": "STATUS_SET", "to": "rejected", "service_object_type": "storefront_content", "service_object_category": "content_slot", "effect_instance": "StorefrontContent_StatusSet_content_slot" }
              ]
            },
            "ECOM_CONTENT_CLOSE": {
              "code": "ECOM_CONTENT_CLOSE",
              "label": "Close Content",
              "effects": [
                { "type": "STATUS_SET", "to": "cancelled", "service_object_type": "storefront_content", "service_object_category": "content_slot", "effect_instance": "StorefrontContent_StatusSet_content_slot" }
              ]
            }
          },
          "nodes": [
            { "id": "content_intake", "type": "TRIGGER", "label": "Content Intake" },
            { "id": "content_draft", "type": "STEP", "label": "Draft" },
            { "id": "content_review", "type": "STEP", "label": "Moderation" },
            { "id": "content_published", "type": "STEP", "label": "Published" },
            { "id": "content_closed", "type": "TERMINAL", "label": "Closed", "is_terminal": true }
          ],
          "transitions": [
            { "from": "content_intake", "to": "content_draft", "action": "INTAKE", "task_label": "Prepare Content", "macro_code": "ECOM_CONTENT_DRAFT_OPEN", "edge_type": "DEFAULT" },
            { "from": "content_draft", "to": "content_review", "action": "DRAFT_READY", "task_label": "Submit For Moderation", "macro_code": "ECOM_CONTENT_DRAFT_SUBMIT", "edge_type": "DEFAULT" },
            { "from": "content_review", "to": "content_published", "action": "APPROVE", "task_label": "Approve Content", "macro_code": "ECOM_CONTENT_MODERATION_DECISION", "edge_type": "DEFAULT" },
            { "from": "content_review", "to": "content_draft", "action": "REJECT", "task_label": "Reject Content", "macro_code": "ECOM_CONTENT_MODERATION_REJECT", "edge_type": "DEFAULT" },
            { "from": "content_published", "to": "content_closed", "action": "CANCEL", "task_label": "Close Content", "macro_code": "ECOM_CONTENT_CLOSE", "edge_type": "DEFAULT" }
          ]
        }
        $json$::jsonb,
        $json$
        {
          "module": "ecom",
          "object_type": "storefront_content",
          "service_object_category": "content_slot",
          "macro_layer": "explicit_graph_registry",
          "source": "v2_0010"
        }
        $json$::jsonb
      )
    ON CONFLICT (tenant_id, code, version) DO UPDATE
      SET name = EXCLUDED.name,
          is_active = EXCLUDED.is_active,
          graph = EXCLUDED.graph,
          attrs = EXCLUDED.attrs,
          updated_at = now();

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
          "macros": {
            "ECOM_REVIEW_SUBMIT": {
              "code": "ECOM_REVIEW_SUBMIT",
              "label": "Queue Review",
              "effects": [
                { "type": "STATUS_SET", "to": "pending_review", "service_object_type": "product_review", "service_object_category": "moderation", "effect_instance": "ProductReview_StatusSet_moderation" }
              ]
            },
            "ECOM_REVIEW_APPROVE": {
              "code": "ECOM_REVIEW_APPROVE",
              "label": "Approve Review",
              "effects": [
                { "type": "STATUS_SET", "to": "visible", "service_object_type": "product_review", "service_object_category": "moderation", "effect_instance": "ProductReview_StatusSet_moderation" }
              ]
            },
            "ECOM_REVIEW_HIDE": {
              "code": "ECOM_REVIEW_HIDE",
              "label": "Hide Review",
              "effects": [
                { "type": "STATUS_SET", "to": "hidden", "service_object_type": "product_review", "service_object_category": "moderation", "effect_instance": "ProductReview_StatusSet_moderation" }
              ]
            },
            "ECOM_REVIEW_UNHIDE": {
              "code": "ECOM_REVIEW_UNHIDE",
              "label": "Unhide Review",
              "effects": [
                { "type": "STATUS_SET", "to": "visible", "service_object_type": "product_review", "service_object_category": "moderation", "effect_instance": "ProductReview_StatusSet_moderation" }
              ]
            },
            "ECOM_REVIEW_REJECT": {
              "code": "ECOM_REVIEW_REJECT",
              "label": "Reject Review",
              "effects": [
                { "type": "STATUS_SET", "to": "rejected", "service_object_type": "product_review", "service_object_category": "moderation", "effect_instance": "ProductReview_StatusSet_moderation" }
              ]
            }
          },
          "nodes": [
            { "id": "review_intake", "type": "TRIGGER", "label": "Review Intake" },
            { "id": "review_pending", "type": "STEP", "label": "Pending Review" },
            { "id": "review_visible", "type": "STEP", "label": "Visible" },
            { "id": "review_hidden", "type": "STEP", "label": "Hidden" },
            { "id": "review_closed", "type": "TERMINAL", "label": "Closed", "is_terminal": true }
          ],
          "transitions": [
            { "from": "review_intake", "to": "review_pending", "action": "REVIEW_SUBMIT", "task_label": "Queue Review", "macro_code": "ECOM_REVIEW_SUBMIT", "edge_type": "DEFAULT" },
            { "from": "review_pending", "to": "review_visible", "action": "APPROVE", "task_label": "Approve Review", "macro_code": "ECOM_REVIEW_APPROVE", "edge_type": "DEFAULT" },
            { "from": "review_pending", "to": "review_hidden", "action": "HIDE", "task_label": "Hide Review", "macro_code": "ECOM_REVIEW_HIDE", "edge_type": "DEFAULT" },
            { "from": "review_hidden", "to": "review_visible", "action": "UNHIDE", "task_label": "Unhide Review", "macro_code": "ECOM_REVIEW_UNHIDE", "edge_type": "DEFAULT" },
            { "from": "review_pending", "to": "review_closed", "action": "REJECT", "task_label": "Reject Review", "macro_code": "ECOM_REVIEW_REJECT", "edge_type": "DEFAULT" }
          ]
        }
        $json$::jsonb,
        $json$
        {
          "module": "ecom",
          "object_type": "product_review",
          "service_object_category": "moderation",
          "macro_layer": "explicit_graph_registry",
          "source": "v2_0010"
        }
        $json$::jsonb
      )
    ON CONFLICT (tenant_id, code, version) DO UPDATE
      SET name = EXCLUDED.name,
          is_active = EXCLUDED.is_active,
          graph = EXCLUDED.graph,
          attrs = EXCLUDED.attrs,
          updated_at = now();

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
          "macros": {
            "ECOM_BLOG_DRAFT_OPEN": {
              "code": "ECOM_BLOG_DRAFT_OPEN",
              "label": "Prepare Draft",
              "effects": [
                { "type": "STATUS_SET", "to": "new", "service_object_type": "blog_post", "service_object_category": "editorial", "effect_instance": "BlogPost_StatusSet_editorial" }
              ]
            },
            "ECOM_BLOG_PUBLISH": {
              "code": "ECOM_BLOG_PUBLISH",
              "label": "Publish Post",
              "effects": [
                { "type": "STATUS_SET", "to": "published", "service_object_type": "blog_post", "service_object_category": "editorial", "effect_instance": "BlogPost_StatusSet_editorial" }
              ]
            },
            "ECOM_BLOG_REJECT": {
              "code": "ECOM_BLOG_REJECT",
              "label": "Reject Draft",
              "effects": [
                { "type": "STATUS_SET", "to": "rejected", "service_object_type": "blog_post", "service_object_category": "editorial", "effect_instance": "BlogPost_StatusSet_editorial" }
              ]
            },
            "ECOM_BLOG_REOPEN": {
              "code": "ECOM_BLOG_REOPEN",
              "label": "Reopen Draft",
              "effects": [
                { "type": "STATUS_SET", "to": "new", "service_object_type": "blog_post", "service_object_category": "editorial", "effect_instance": "BlogPost_StatusSet_editorial" }
              ]
            },
            "ECOM_BLOG_CLOSE": {
              "code": "ECOM_BLOG_CLOSE",
              "label": "Archive Post",
              "effects": [
                { "type": "STATUS_SET", "to": "cancelled", "service_object_type": "blog_post", "service_object_category": "editorial", "effect_instance": "BlogPost_StatusSet_editorial" }
              ]
            }
          },
          "nodes": [
            { "id": "blog_intake", "type": "TRIGGER", "label": "Blog Intake" },
            { "id": "blog_draft", "type": "STEP", "label": "Draft" },
            { "id": "blog_published", "type": "STEP", "label": "Published" },
            { "id": "blog_rejected", "type": "STEP", "label": "Rejected" },
            { "id": "blog_closed", "type": "TERMINAL", "label": "Closed", "is_terminal": true }
          ],
          "transitions": [
            { "from": "blog_intake", "to": "blog_draft", "action": "INTAKE", "task_label": "Prepare Draft", "macro_code": "ECOM_BLOG_DRAFT_OPEN", "edge_type": "DEFAULT" },
            { "from": "blog_draft", "to": "blog_published", "action": "PUBLISH", "task_label": "Publish Post", "macro_code": "ECOM_BLOG_PUBLISH", "edge_type": "DEFAULT" },
            { "from": "blog_draft", "to": "blog_rejected", "action": "REJECT", "task_label": "Reject Draft", "macro_code": "ECOM_BLOG_REJECT", "edge_type": "DEFAULT" },
            { "from": "blog_rejected", "to": "blog_draft", "action": "REOPEN", "task_label": "Reopen Draft", "macro_code": "ECOM_BLOG_REOPEN", "edge_type": "DEFAULT" },
            { "from": "blog_published", "to": "blog_closed", "action": "CANCEL", "task_label": "Archive Post", "macro_code": "ECOM_BLOG_CLOSE", "edge_type": "DEFAULT" }
          ]
        }
        $json$::jsonb,
        $json$
        {
          "module": "ecom",
          "object_type": "blog_post",
          "service_object_category": "editorial",
          "macro_layer": "explicit_graph_registry",
          "source": "v2_0010"
        }
        $json$::jsonb
      )
    ON CONFLICT (tenant_id, code, version) DO UPDATE
      SET name = EXCLUDED.name,
          is_active = EXCLUDED.is_active,
          graph = EXCLUDED.graph,
          attrs = EXCLUDED.attrs,
          updated_at = now();
  END LOOP;
END $$;

COMMIT;
