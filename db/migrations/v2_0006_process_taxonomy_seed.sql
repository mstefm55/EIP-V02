BEGIN;

WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'SERVICE_OBJECT_STATUS', 'Service Object Status', 1, true, '{"ui":{"applies_to":["service_object.status"]}}'::jsonb)
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
  values_src.code,
  values_src.label,
  values_src.sort_order,
  true,
  '{}'::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('new',         'New',         10),
    ('in_progress', 'In progress', 20),
    ('on_hold',     'On hold',     30),
    ('done',        'Done',        40),
    ('cancelled',   'Cancelled',   90)
) AS values_src(code, label, sort_order)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'TASK_STATUS', 'Task Status', 1, true, '{"ui":{"applies_to":["task.status"]}}'::jsonb)
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
  values_src.code,
  values_src.label,
  values_src.sort_order,
  true,
  '{}'::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('open',        'Open',        10),
    ('assigned',    'Assigned',    20),
    ('in_progress', 'In progress', 30),
    ('blocked',     'Blocked',     40),
    ('done',        'Done',        80),
    ('cancelled',   'Cancelled',   90)
) AS values_src(code, label, sort_order)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'MATERIAL_LOT_STATUS', 'Material Lot Status', 1, true, '{"ui":{"applies_to":["material_lot.status"]}}'::jsonb)
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
  values_src.code,
  values_src.label,
  values_src.sort_order,
  true,
  '{}'::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('new',         'New',         10),
    ('available',   'Available',   20),
    ('reserved',    'Reserved',    30),
    ('in_process',  'In process',  40),
    ('qa_hold',     'QA hold',     50),
    ('consumed',    'Consumed',    80),
    ('scrapped',    'Scrapped',    90)
) AS values_src(code, label, sort_order)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'PROCESS_NODE_TYPE', 'Process Node Type', 1, true, '{"ui":{"applies_to":["process_def.graph.nodes"]}}'::jsonb)
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
  values_src.code,
  values_src.label,
  values_src.sort_order,
  true,
  '{}'::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('TRIGGER',    'Trigger',    10),
    ('STEP',       'Step',       20),
    ('HUMAN_TASK', 'Human Task', 30),
    ('ROUTER',     'Router',     40),
    ('JOIN',       'Join',       50),
    ('TERMINAL',   'Terminal',   90)
) AS values_src(code, label, sort_order)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'PROCESS_EDGE_TYPE', 'Process Edge Type', 1, true, '{"ui":{"applies_to":["process_def.graph.transitions"]}}'::jsonb)
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
  values_src.code,
  values_src.label,
  values_src.sort_order,
  true,
  '{}'::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('DEFAULT',     'Default',     10),
    ('ON_SUCCESS',  'On Success',  20),
    ('ON_FAIL',     'On Fail',     30),
    ('CONDITIONAL', 'Conditional', 40)
) AS values_src(code, label, sort_order)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'PROCESS_EFFECT_TYPE', 'Process Effect Type', 1, true, '{"ui":{"applies_to":["process_def.graph.transitions.effects"]}}'::jsonb)
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
  values_src.code,
  values_src.label,
  values_src.sort_order,
  true,
  values_src.attrs::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('STATUS_SET',                  'Status Set',                    10, '{}' ),
    ('TASK_CREATE',                 'Task Create',                   20, '{}' ),
    ('TASK_UPDATE',                 'Task Update',                   30, '{}' ),
    ('LINK_CREATE',                 'Link Create',                   40, '{}' ),
    ('LINK_REMOVE',                 'Link Remove',                   50, '{}' ),
    ('JSON_MERGE',                  'JSON Merge',                    60, '{}' ),
    ('CHILD_SERVICE_OBJECT_CREATE', 'Child Service Object Create',   70, '{}' ),
    ('INFO_RECORD_WRITE',           'Info Record Write',             80, '{}' ),
    ('HTTP_REQUEST',                'HTTP Request',                  90, '{}' ),
    ('ACCESS_GRANT_CREATE',         'Access Grant Create',          100, '{}' ),
    ('ACCESS_GRANT_UPDATE',         'Access Grant Update',          110, '{}' ),
    ('INSTANCE_START',              'Instance Start',               120, '{}' ),
    ('INVENTORY_MOVE',              'Inventory Move',               130, '{}' ),
    ('INVENTORY_CONSUME',           'Inventory Consume',            140, '{}' ),
    ('INVENTORY_PRODUCE',           'Inventory Produce',            150, '{}' ),
    ('INVENTORY_CONVERT',           'Inventory Convert',            160, '{}' ),
    ('VARIANT_INVENTORY_VALIDATE',  'Variant Inventory Validate',   170, '{}' ),
    ('SO_CREATE',                   'Legacy: Service Object Create',200, '{"deprecated":true}' ),
    ('SO_STATUS',                   'Legacy: Service Object Status',210, '{"deprecated":true}' ),
    ('SO_UPDATE',                   'Legacy: Service Object Update',220, '{"deprecated":true}' ),
    ('TASK_STATUS',                 'Legacy: Task Status',          230, '{"deprecated":true}' ),
    ('LINK',                        'Legacy: Link Create',          240, '{"deprecated":true}' ),
    ('ATTRS_MERGE',                 'Legacy: JSON Merge',           250, '{"deprecated":true}' ),
    ('API_CALL',                    'Legacy: API Call',             260, '{"deprecated":true}' )
) AS values_src(code, label, sort_order, attrs)
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
    (NULL, 'core', 'PROCESS_ACTION', 'Process Action', 1, true, '{"ui":{"applies_to":["process_def.graph.transitions.action"]}}'::jsonb)
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
  values_src.code,
  values_src.label,
  values_src.sort_order,
  true,
  '{}'::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('INTAKE',      'Intake',      10),
    ('START',       'Start',       20),
    ('SUBMIT',      'Submit',      30),
    ('DRAFT_READY', 'Draft Ready', 40),
    ('APPROVE',     'Approve',     50),
    ('REJECT',      'Reject',      60),
    ('PUBLISH',     'Publish',     70),
    ('PAUSE',       'Pause',       80),
    ('RESUME',      'Resume',      90),
    ('COMPLETE',    'Complete',   100),
    ('CANCEL',      'Cancel',     110),
    ('REOPEN',      'Reopen',     120),
    ('ESCALATE',    'Escalate',   130),
    ('CLOSE',       'Close',      140)
) AS values_src(code, label, sort_order)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (NULL, 'core', 'TASK_ACTION', 'Task Action', 1, true, '{"ui":{"applies_to":["task.actions","task_template.attrs.allowed_actions"]}}'::jsonb)
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
  values_src.code,
  values_src.label,
  values_src.sort_order,
  true,
  '{}'::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    ('TASK_START',           'Start',            10),
    ('TASK_PAUSE',           'Pause',            20),
    ('TASK_RESUME',          'Resume',           30),
    ('TASK_COMPLETE',        'Complete',         40),
    ('TASK_CANCEL',          'Cancel',           50),
    ('TASK_BLOCK',           'Block',            60),
    ('TASK_UNBLOCK',         'Unblock',          70),
    ('TASK_FAIL',            'Fail',             80),
    ('TASK_ASSIGN',          'Assign',           90),
    ('TASK_UNASSIGN',        'Unassign',         100),
    ('TASK_REASSIGN',        'Reassign',         110),
    ('TASK_CLAIM',           'Claim',            120),
    ('TASK_RELEASE',         'Release',          130),
    ('TASK_APPROVE',         'Approve',          140),
    ('TASK_REJECT',          'Reject',           150),
    ('TASK_REQUEST_CHANGES', 'Request Changes',  160),
    ('TASK_ADD_NOTE',        'Add Note',         170),
    ('TASK_ADD_ATTACHMENT',  'Add Attachment',   180),
    ('TASK_ADD_LINK',        'Add Link',         190),
    ('TASK_ESCALATE',        'Escalate',         200),
    ('TASK_DEADLINE_EXTEND', 'Extend Deadline',  210),
    ('TASK_ADVANCE_PROCESS', 'Advance Process',  220)
) AS values_src(code, label, sort_order)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

COMMIT;
