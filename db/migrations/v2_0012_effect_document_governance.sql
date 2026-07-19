BEGIN;

-- 1) Effect governance metadata: canonical mapping and minimal parameter contract.
WITH effect_list AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND is_active = true
    AND tenant_id IS NULL
  ORDER BY version DESC
  LIMIT 1
)
UPDATE eip_core.dropdown_value dv
SET attrs = COALESCE(dv.attrs, '{}'::jsonb) || src.attrs::jsonb,
    updated_at = now()
FROM effect_list,
(
  VALUES
    ('STATUS_SET',                  '{"canonical_effect_code":"STATUS_SET","runtime_handler":"statusSet","allowed_targets":["service_object","task"],"required_fields":["to"]}'),
    ('TASK_CREATE',                 '{"canonical_effect_code":"TASK_CREATE","runtime_handler":"taskCreate","required_fields":["task_type"]}'),
    ('TASK_UPDATE',                 '{"canonical_effect_code":"TASK_UPDATE","runtime_handler":"taskUpdate","required_fields":["task_id"]}'),
    ('LINK_CREATE',                 '{"canonical_effect_code":"LINK_CREATE","runtime_handler":"linkCreate","required_fields":["src_kind","src_id","dst_kind","dst_id","relation_type"]}'),
    ('LINK_REMOVE',                 '{"canonical_effect_code":"LINK_REMOVE","runtime_handler":"linkRemove","required_fields":["src_kind","src_id","dst_kind","dst_id","relation_type"]}'),
    ('JSON_MERGE',                  '{"canonical_effect_code":"JSON_MERGE","runtime_handler":"jsonMerge","allowed_targets":["service_object","material","process_instance"],"required_fields":["target"]}'),
    ('CHILD_SERVICE_OBJECT_CREATE', '{"canonical_effect_code":"CHILD_SERVICE_OBJECT_CREATE","runtime_handler":"childServiceObjectCreate","required_any":[["items","object_type","objectType"]]}'),
    ('INFO_RECORD_WRITE',           '{"canonical_effect_code":"INFO_RECORD_WRITE","runtime_handler":"infoRecordWrite","required_fields":["record_type"]}'),
    ('HTTP_REQUEST',                '{"canonical_effect_code":"HTTP_REQUEST","runtime_handler":"httpRequest","required_any":[["connection_code","gateway_connection_code","connection"],["url","endpoint"]]}'),
    ('ACCESS_GRANT_CREATE',         '{"canonical_effect_code":"ACCESS_GRANT_CREATE","runtime_handler":"accessGrantCreate","required_fields":["grant_type"]}'),
    ('ACCESS_GRANT_UPDATE',         '{"canonical_effect_code":"ACCESS_GRANT_UPDATE","runtime_handler":"accessGrantUpdate","required_any":[["grant_id","token_hash"]]}'),
    ('INSTANCE_START',              '{"canonical_effect_code":"INSTANCE_START","runtime_handler":"instanceStart"}'),
    ('INVENTORY_MOVE',              '{"canonical_effect_code":"INVENTORY_MOVE","runtime_handler":"inventoryMove","required_any":[["material_lot_id","lot_id","material_lot_code","lot_code"]]}'),
    ('INVENTORY_CONSUME',           '{"canonical_effect_code":"INVENTORY_CONSUME","runtime_handler":"inventoryConsume","required_any":[["material_lot_id","lot_id","material_lot_code","lot_code"]]}'),
    ('INVENTORY_PRODUCE',           '{"canonical_effect_code":"INVENTORY_PRODUCE","runtime_handler":"inventoryProduce","required_any":[["material_id","material_code"]],"required_fields":["quantity"]}'),
    ('INVENTORY_CONVERT',           '{"canonical_effect_code":"INVENTORY_CONVERT","runtime_handler":"inventoryConvert","required_any":[["input_lot_id","material_lot_id","lot_id"],["output_material_id","output_material_code"]],"required_fields":["output_quantity"]}'),
    ('VARIANT_INVENTORY_VALIDATE',  '{"canonical_effect_code":"VARIANT_INVENTORY_VALIDATE","runtime_handler":"variantInventoryValidate","required_any":[["material_id","material_code"]]}'),
    ('SO_UPDATE',                   '{"canonical_effect_code":"SO_UPDATE","runtime_handler":"serviceObjectUpdate"}'),
    ('SO_CREATE',                   '{"deprecated":true,"canonical_effect_code":"CHILD_SERVICE_OBJECT_CREATE","runtime_handler":"childServiceObjectCreate"}'),
    ('SO_STATUS',                   '{"deprecated":true,"canonical_effect_code":"STATUS_SET","runtime_handler":"statusSet"}'),
    ('TASK_STATUS',                 '{"deprecated":true,"canonical_effect_code":"TASK_UPDATE","runtime_handler":"taskUpdate"}'),
    ('LINK',                        '{"deprecated":true,"canonical_effect_code":"LINK_CREATE","runtime_handler":"linkCreate"}'),
    ('ATTRS_MERGE',                 '{"deprecated":true,"canonical_effect_code":"JSON_MERGE","runtime_handler":"jsonMerge"}'),
    ('API_CALL',                    '{"deprecated":true,"canonical_effect_code":"HTTP_REQUEST","runtime_handler":"httpRequest"}')
) AS src(code, attrs)
WHERE dv.list_id = effect_list.id
  AND dv.code = src.code;

-- 2) Service-object/document governance lists (no new tables; governed metadata only).
WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'SERVICE_OBJECT_TYPE', 'Service Object Type', 1, true, '{"ui":{"applies_to":["service_object.object_type","process_def.graph.object_type"]}}'::jsonb)
  ON CONFLICT (tenant_id, module, code, version) DO UPDATE
    SET name = EXCLUDED.name,
        is_active = EXCLUDED.is_active,
        updated_at = now()
  RETURNING id
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT
  upsert_list.id,
  src.code,
  src.label,
  src.sort_order,
  true,
  src.attrs::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('storefront_content', 'Storefront Content',  10, '{"business_class":"document","service_object_category":"content_slot"}'),
    ('product_review',     'Product Review',      20, '{"business_class":"document","service_object_category":"moderation"}'),
    ('blog_post',          'Blog Post',           30, '{"business_class":"document","service_object_category":"editorial"}'),
    ('sales_order',        'Sales Order',         40, '{"business_class":"document","service_object_category":"sales"}'),
    ('purchase_order',     'Purchase Order',      50, '{"business_class":"document","service_object_category":"procurement"}'),
    ('invoice',            'Invoice',             60, '{"business_class":"document","service_object_category":"financial"}'),
    ('delivery_note',      'Delivery Note',       70, '{"business_class":"document","service_object_category":"logistics"}'),
    ('material_lot',       'Material Lot',        80, '{"business_class":"material","service_object_category":"inventory"}'),
    ('asset_register',     'Asset Register',      90, '{"business_class":"asset","service_object_category":"asset_control"}'),
    ('agent_profile',      'Agent Profile',      100, '{"business_class":"agent_entity","service_object_category":"identity"}'),
    ('money_movement',     'Money Movement',     110, '{"business_class":"money","service_object_category":"financial"}')
) AS src(code, label, sort_order, attrs)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    attrs = EXCLUDED.attrs,
    updated_at = now();

WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'SERVICE_OBJECT_CATEGORY', 'Service Object Category', 1, true, '{"ui":{"applies_to":["process_def.attrs.service_object_category"]}}'::jsonb)
  ON CONFLICT (tenant_id, module, code, version) DO UPDATE
    SET name = EXCLUDED.name,
        is_active = EXCLUDED.is_active,
        updated_at = now()
  RETURNING id
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT
  upsert_list.id,
  src.code,
  src.label,
  src.sort_order,
  true,
  '{}'::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('content_slot',  'Content Slot',  10),
    ('moderation',    'Moderation',    20),
    ('editorial',     'Editorial',     30),
    ('sales',         'Sales',         40),
    ('procurement',   'Procurement',   50),
    ('financial',     'Financial',     60),
    ('logistics',     'Logistics',     70),
    ('inventory',     'Inventory',     80),
    ('asset_control', 'Asset Control', 90),
    ('identity',      'Identity',     100),
    ('governance',    'Governance',   110)
) AS src(code, label, sort_order)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'DOCUMENT_CATEGORY', 'Document Category', 1, true, '{"ui":{"applies_to":["service_object.attrs.document_category"]}}'::jsonb)
  ON CONFLICT (tenant_id, module, code, version) DO UPDATE
    SET name = EXCLUDED.name,
        is_active = EXCLUDED.is_active,
        updated_at = now()
  RETURNING id
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT
  upsert_list.id,
  src.code,
  src.label,
  src.sort_order,
  true,
  '{}'::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('sales_order',            'Sales Order',            10),
    ('purchase_order',         'Purchase Order',         20),
    ('invoice',                'Invoice',                30),
    ('delivery_note',          'Delivery Note',          40),
    ('goods_receipt',          'Goods Receipt',          50),
    ('routing_sheet',          'Routing Sheet',          60),
    ('quantity_sheet',         'Quantity Sheet',         70),
    ('compliance_certificate', 'Compliance Certificate', 80),
    ('payment_instruction',    'Payment Instruction',    90),
    ('work_order',             'Work Order',            100)
) AS src(code, label, sort_order)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'DOCUMENT_STATUS', 'Document Status', 1, true, '{"ui":{"applies_to":["service_object.attrs.document_status"]}}'::jsonb)
  ON CONFLICT (tenant_id, module, code, version) DO UPDATE
    SET name = EXCLUDED.name,
        is_active = EXCLUDED.is_active,
        updated_at = now()
  RETURNING id
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT
  upsert_list.id,
  src.code,
  src.label,
  src.sort_order,
  true,
  '{}'::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('draft',     'Draft',     10),
    ('submitted', 'Submitted', 20),
    ('approved',  'Approved',  30),
    ('rejected',  'Rejected',  40),
    ('issued',    'Issued',    50),
    ('void',      'Void',      60),
    ('archived',  'Archived',  70)
) AS src(code, label, sort_order)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'DOCUMENT_HEADER_KEY', 'Document Header Key', 1, true, '{"ui":{"applies_to":["service_object.attrs.document_headers"]}}'::jsonb)
  ON CONFLICT (tenant_id, module, code, version) DO UPDATE
    SET name = EXCLUDED.name,
        is_active = EXCLUDED.is_active,
        updated_at = now()
  RETURNING id
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT
  upsert_list.id,
  src.code,
  src.label,
  src.sort_order,
  true,
  src.attrs::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('document_number',  'Document Number', 10, '{"value_type":"string"}'),
    ('document_date',    'Document Date',   20, '{"value_type":"date"}'),
    ('counterparty_id',  'Counterparty',    30, '{"value_type":"uuid"}'),
    ('currency_code',    'Currency Code',   40, '{"value_type":"string"}'),
    ('net_amount',       'Net Amount',      50, '{"value_type":"numeric"}'),
    ('tax_amount',       'Tax Amount',      60, '{"value_type":"numeric"}'),
    ('total_amount',     'Total Amount',    70, '{"value_type":"numeric"}'),
    ('effective_at',     'Effective At',    80, '{"value_type":"timestamp"}'),
    ('due_at',           'Due At',          90, '{"value_type":"timestamp"}'),
    ('reference_number', 'Reference Number',100, '{"value_type":"string"}'),
    ('status_code',      'Status Code',    110, '{"value_type":"string"}')
) AS src(code, label, sort_order, attrs)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    attrs = EXCLUDED.attrs,
    updated_at = now();

COMMIT;