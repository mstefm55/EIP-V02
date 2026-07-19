BEGIN;

WITH target AS (
  SELECT surface.code, surface.tree
  FROM eip_core.ui_surface AS surface
  WHERE surface.tenant_id IS NULL
    AND surface.version = 1
    AND surface.code IN ('core_process_workbench', 'ecom_process_workbench')
    AND jsonb_path_exists(
      surface.tree,
      '$.children[1].children[1].type ? (@ == "ContractDetailEditor")'
    )
), rewritten AS (
  SELECT
    target.code,
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            target.tree,
            '{children,1,children,1,props,authoring_tabs}',
            jsonb_build_object(
              'enabled', true,
              'default_tab', 'definition',
              'tabs',
              jsonb_build_array(
                jsonb_build_object('id', 'definition', 'label', 'Definition', 'icon', 'DF'),
                jsonb_build_object('id', 'flow', 'label', 'Flow Builder', 'icon', 'FL'),
                jsonb_build_object('id', 'effects', 'label', 'Macro Effects', 'icon', 'FX'),
                jsonb_build_object('id', 'advanced', 'label', 'Advanced', 'icon', 'AD')
              )
            ),
            true
          ),
          '{children,1,children,1,props,flow_tree}',
          jsonb_build_object(
            'enabled', true,
            'title', 'Top-down Flow Tree',
            'subtitle', 'Progression of tasks from the initial node.',
            'start_label', 'Start Node',
            'level_label', 'Level',
            'no_nodes_message', 'Add tasks to render the flow tree.'
          ),
          true
        ),
        '{children,1,children,1,props,visual_builder}',
        jsonb_build_object(
          'enabled', true,
          'title', 'Visual Flow Canvas',
          'subtitle', 'Use visual task cards and transitions. Graph JSON updates in the background.',
          'add_node_label', 'Add Task',
          'node_type_label', 'Task Type',
          'remove_node_label', 'Remove Task',
          'no_nodes_message', 'No tasks yet. Apply a starter template or add the first task.',
          'template_title', 'Starter Templates',
          'template_subtitle', 'Start from a predefined process skeleton and refine it.',
          'template_apply_label', 'Apply'
        ),
        true
      ),
      '{children,1,children,1,props,starter_templates}',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'intake_review_close',
          'label', 'Intake -> Review -> Close',
          'description', 'Fast baseline flow for request handling.',
          'object_type', 'ServiceObject',
          'initial_node', 'intake',
          'nodes', jsonb_build_array(
            jsonb_build_object('id', 'intake', 'type', 'TRIGGER', 'label', 'Intake'),
            jsonb_build_object('id', 'review', 'type', 'HUMAN_TASK', 'label', 'Review'),
            jsonb_build_object('id', 'closed', 'type', 'TERMINAL', 'label', 'Closed', 'is_terminal', true)
          ),
          'transitions', jsonb_build_array(
            jsonb_build_object('from', 'intake', 'to', 'review', 'task_label', 'Review request', 'macro_code', 'macro_review'),
            jsonb_build_object('from', 'review', 'to', 'closed', 'task_label', 'Close request', 'macro_code', 'macro_close')
          ),
          'macros', jsonb_build_object(
            'macro_review', jsonb_build_object('label', 'Review', 'effects', jsonb_build_array()),
            'macro_close', jsonb_build_object('label', 'Close', 'effects', jsonb_build_array())
          )
        ),
        jsonb_build_object(
          'id', 'approve_reject',
          'label', 'Approve / Reject',
          'description', 'Decision flow with explicit approve/reject outcomes.',
          'object_type', 'ServiceObject',
          'initial_node', 'submitted',
          'nodes', jsonb_build_array(
            jsonb_build_object('id', 'submitted', 'type', 'TRIGGER', 'label', 'Submitted'),
            jsonb_build_object('id', 'decision', 'type', 'HUMAN_TASK', 'label', 'Decision'),
            jsonb_build_object('id', 'approved', 'type', 'TERMINAL', 'label', 'Approved', 'is_terminal', true),
            jsonb_build_object('id', 'rejected', 'type', 'TERMINAL', 'label', 'Rejected', 'is_terminal', true)
          ),
          'transitions', jsonb_build_array(
            jsonb_build_object('from', 'submitted', 'to', 'decision', 'task_label', 'Assess', 'macro_code', 'macro_assess'),
            jsonb_build_object('from', 'decision', 'to', 'approved', 'task_label', 'Approve', 'macro_code', 'macro_approve'),
            jsonb_build_object('from', 'decision', 'to', 'rejected', 'task_label', 'Reject', 'macro_code', 'macro_reject')
          ),
          'macros', jsonb_build_object(
            'macro_assess', jsonb_build_object('label', 'Assess', 'effects', jsonb_build_array()),
            'macro_approve', jsonb_build_object('label', 'Approve', 'effects', jsonb_build_array()),
            'macro_reject', jsonb_build_object('label', 'Reject', 'effects', jsonb_build_array())
          )
        ),
        jsonb_build_object(
          'id', 'create_review_amend',
          'label', 'Create -> Review -> Amend',
          'description', 'Simple lifecycle with amend stage and closure.',
          'object_type', 'Assets',
          'service_object_category', 'default',
          'initial_node', 'create',
          'nodes', jsonb_build_array(
            jsonb_build_object('id', 'create', 'type', 'TRIGGER', 'label', 'Create'),
            jsonb_build_object('id', 'review', 'type', 'STEP', 'label', 'Review'),
            jsonb_build_object('id', 'amend', 'type', 'STEP', 'label', 'Amend'),
            jsonb_build_object('id', 'done', 'type', 'TERMINAL', 'label', 'Done', 'is_terminal', true)
          ),
          'transitions', jsonb_build_array(
            jsonb_build_object('from', 'create', 'to', 'review', 'task_label', 'Validate', 'macro_code', 'macro_validate'),
            jsonb_build_object('from', 'review', 'to', 'amend', 'task_label', 'Amend inventory', 'macro_code', 'macro_amend'),
            jsonb_build_object('from', 'amend', 'to', 'done', 'task_label', 'Finalize', 'macro_code', 'macro_finalize')
          ),
          'macros', jsonb_build_object(
            'macro_validate', jsonb_build_object('label', 'Validate', 'effects', jsonb_build_array()),
            'macro_amend', jsonb_build_object('label', 'Inventory amend', 'effects', jsonb_build_array()),
            'macro_finalize', jsonb_build_object('label', 'Finalize', 'effects', jsonb_build_array())
          )
        )
      ),
      true
    ) AS next_tree
  FROM target
)
UPDATE eip_core.ui_surface AS surface
SET tree = rewritten.next_tree,
    attrs = COALESCE(surface.attrs, '{}'::jsonb) || jsonb_build_object(
      'ui_composition_model', 'generic_primitives_v7',
      'source', 'v2_0025'
    ),
    updated_at = now()
FROM rewritten
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND surface.code = rewritten.code;

COMMIT;
