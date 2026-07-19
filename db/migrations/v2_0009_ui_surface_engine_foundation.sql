BEGIN;

CREATE TABLE IF NOT EXISTS eip_core.ui_surface (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid REFERENCES kernel.tenants (tenant_id) ON DELETE CASCADE,
    code text NOT NULL,
    title text,
    version integer NOT NULL DEFAULT 1,
    is_active boolean NOT NULL DEFAULT true,
    is_published boolean NOT NULL DEFAULT false,
    is_public boolean NOT NULL DEFAULT false,
    tree jsonb NOT NULL DEFAULT '{}'::jsonb,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ui_surface_unique UNIQUE NULLS NOT DISTINCT (tenant_id, code, version),
    CONSTRAINT ui_surface_code_not_blank_ck CHECK (btrim(code) <> ''),
    CONSTRAINT ui_surface_version_positive_ck CHECK (version > 0),
    CONSTRAINT ui_surface_tree_object_ck CHECK (jsonb_typeof(tree) = 'object'),
    CONSTRAINT ui_surface_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS ui_surface_lookup_idx
    ON eip_core.ui_surface (tenant_id, code, is_active, is_published, version);

CREATE INDEX IF NOT EXISTS ui_surface_public_idx
    ON eip_core.ui_surface (code, version)
    WHERE is_active = true AND is_published = true AND is_public = true;

CREATE INDEX IF NOT EXISTS ui_surface_tree_gin
    ON eip_core.ui_surface USING gin (tree);

CREATE INDEX IF NOT EXISTS ui_surface_attrs_gin
    ON eip_core.ui_surface USING gin (attrs);

COMMENT ON TABLE eip_core.ui_surface IS
  'Governed UI engine surface definitions. Routes expose metadata only; business lifecycle authority remains in process engine.';

INSERT INTO eip_core.ui_surface
  (tenant_id, code, title, version, is_active, is_published, is_public, tree, attrs)
VALUES
  (
    NULL,
    'ecom_process_workbench',
    'Ecom Process Workbench',
    1,
    true,
    true,
    false,
    $json$
    {
      "type": "SurfaceRoot",
      "props": {
        "module": "ecom",
        "surface_kind": "workbench"
      },
      "children": [
        {
          "id": "lifecycle_header",
          "type": "PanelHeader",
          "props": {
            "title": "Ecom Lifecycle Workbench",
            "subtitle": "Process-engine-managed lifecycle surfaces"
          }
        },
        {
          "id": "process_catalog",
          "type": "ProcessDefinitionCatalog",
          "props": {
            "codes": [
              "ECOM_STOREFRONT_CONTENT_FLOW",
              "ECOM_PRODUCT_REVIEW_FLOW",
              "ECOM_BLOG_POST_FLOW"
            ],
            "service_object_types": [
              "storefront_content",
              "product_review",
              "blog_post"
            ]
          }
        }
      ]
    }
    $json$::jsonb,
    '{"module":"ecom","surface_kind":"workbench","renderer_contract":"metadata_tree_v1","source":"v2_0009"}'::jsonb
  ),
  (
    NULL,
    'ecom_review_console',
    'Ecom Review Console',
    1,
    true,
    true,
    true,
    $json$
    {
      "type": "SurfaceRoot",
      "props": {
        "module": "ecom",
        "surface_kind": "review_console"
      },
      "children": [
        {
          "id": "review_header",
          "type": "PanelHeader",
          "props": {
            "title": "Review Moderation Console",
            "subtitle": "Governed surface for product-review lifecycle states"
          }
        },
        {
          "id": "review_filters",
          "type": "FilterBlock",
          "props": {
            "service_object_type": "product_review",
            "allowed_statuses": [
              "pending_review",
              "visible",
              "hidden",
              "rejected"
            ]
          }
        }
      ]
    }
    $json$::jsonb,
    '{"module":"ecom","surface_kind":"review_console","renderer_contract":"metadata_tree_v1","source":"v2_0009"}'::jsonb
  )
ON CONFLICT (tenant_id, code, version) DO UPDATE
SET title = EXCLUDED.title,
    is_active = EXCLUDED.is_active,
    is_published = EXCLUDED.is_published,
    is_public = EXCLUDED.is_public,
    tree = EXCLUDED.tree,
    attrs = EXCLUDED.attrs,
    updated_at = now();

COMMIT;
