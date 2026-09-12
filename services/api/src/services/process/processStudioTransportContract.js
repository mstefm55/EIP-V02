export const PROCESS_STUDIO_CONTRACT_VERSION = "process-studio-v1";

function operation({
  studio,
  method,
  path,
  permission,
  implemented = true,
  lifecycle = null,
}) {
  return Object.freeze({
    studio,
    method,
    path,
    permission: Object.freeze([...permission]),
    tenant_authority: "session",
    implemented,
    ...(lifecycle ? { lifecycle } : {}),
  });
}

export const PROCESS_STUDIO_TRANSPORT_V1 = Object.freeze({
  version: PROCESS_STUDIO_CONTRACT_VERSION,
  tenant_authority: "session",
  raw_tenant_id_allowed: false,
  operations: Object.freeze({
    list_processes: operation({
      studio: "library",
      method: "GET",
      path: "/api/eip/process/workbench/catalog",
      permission: ["PROCESS_DEF_READ", "CRM_PROCESS_DEF_READ"],
    }),
    get_process: operation({
      studio: "process",
      method: "GET",
      path: "/api/eip/process/workbench/defs/:id",
      permission: ["PROCESS_DEF_READ", "CRM_PROCESS_DEF_READ"],
    }),
    create_process_draft: operation({
      studio: "process",
      method: "POST",
      path: "/api/eip/process/defs",
      permission: ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
      lifecycle: "draft",
    }),
    update_process_draft: operation({
      studio: "process",
      method: "PATCH",
      path: "/api/eip/process/defs/:id",
      permission: ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
      lifecycle: "draft-only-target",
    }),
    validate_process: operation({
      studio: "process",
      method: "POST",
      path: "/api/eip/process/defs/:id/validate",
      permission: ["PROCESS_DEF_READ", "CRM_PROCESS_DEF_READ"],
    }),
    publish_process: operation({
      studio: "process",
      method: "POST",
      path: "/api/eip/process/defs/:id/publish",
      permission: ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
      lifecycle: "draft-to-published",
    }),
    create_draft_revision: operation({
      studio: "process",
      method: "POST",
      path: "/api/eip/process/defs/:id/revisions",
      permission: ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
      lifecycle: "published-to-new-draft",
    }),
    archive_process: operation({
      studio: "process",
      method: "POST",
      path: "/api/eip/process/defs/:id/archive",
      permission: ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
      lifecycle: "draft-or-published-to-archived",
    }),
    list_task_templates: operation({
      studio: "process",
      method: "GET",
      path: "/api/eip/process/task-templates",
      permission: ["PROCESS_DEF_READ", "CRM_PROCESS_DEF_READ"],
    }),
    create_task_template: operation({
      studio: "process",
      method: "POST",
      path: "/api/eip/process/task-templates",
      permission: ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
      lifecycle: "draft-only-target",
    }),
    list_bindings: operation({
      studio: "process",
      method: "GET",
      path: "/api/eip/process/bindings",
      permission: ["PROCESS_DEF_READ", "CRM_PROCESS_DEF_READ"],
    }),
    create_binding: operation({
      studio: "process",
      method: "POST",
      path: "/api/eip/process/bindings",
      permission: ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
      lifecycle: "published-target-when-active",
    }),
    list_instances: operation({
      studio: "operator",
      method: "GET",
      path: "/api/eip/process/instances",
      permission: ["PROCESS_INSTANCE_READ", "CRM_PROCESS_DEF_READ", "CRM_PROCESS_DEF_WRITE"],
    }),
    get_instance: operation({
      studio: "operator",
      method: "GET",
      path: "/api/eip/process/instances/:id",
      permission: ["PROCESS_INSTANCE_READ", "CRM_PROCESS_DEF_READ", "CRM_PROCESS_DEF_WRITE"],
    }),
    start_process: operation({
      studio: "operator",
      method: "POST",
      path: "/api/eip/process/instances",
      permission: ["PROCESS_INSTANCE_WRITE", "CRM_PROCESS_DEF_WRITE"],
      lifecycle: "published-active-only",
    }),
    advance_process: operation({
      studio: "operator",
      method: "POST",
      path: "/api/eip/process/instances/:id/advance",
      permission: ["PROCESS_INSTANCE_WRITE", "CRM_PROCESS_DEF_WRITE"],
      lifecycle: "pinned-instance-definition",
    }),
    process_taxonomy: operation({
      studio: "process",
      method: "GET",
      path: "/api/eip/process/taxonomy",
      permission: ["PROCESS_DEF_READ", "CRM_PROCESS_DEF_READ"],
    }),
  }),
});

export function listProcessStudioOperations({ includePlanned = false } = {}) {
  return Object.entries(PROCESS_STUDIO_TRANSPORT_V1.operations)
    .filter(([, entry]) => includePlanned || entry.implemented === true)
    .map(([code, entry]) => ({ code, ...entry }));
}

export function getProcessStudioOperation(code) {
  return PROCESS_STUDIO_TRANSPORT_V1.operations[String(code || "")] || null;
}
