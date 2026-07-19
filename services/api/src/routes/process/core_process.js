// services/api/src/routes/core_process.js
import {
  createDef,
  createInstance,
  advanceInstance,
  findActiveInstance
} from "../../core/core_process_engine.js";

const MAX_LIMIT = 200;
const PROCESS_NODE_TYPE_LIST = "PROCESS_NODE_TYPE";
const PROCESS_EDGE_TYPE_LIST = "PROCESS_EDGE_TYPE";
const PROCESS_EFFECT_TYPE_LIST = "PROCESS_EFFECT_TYPE";
const PROCESS_ACTION_LIST = "PROCESS_ACTION";
const TASK_ACTION_LIST = "TASK_ACTION";
const SERVICE_OBJECT_TYPE_LIST = "SERVICE_OBJECT_TYPE";
const SERVICE_OBJECT_CATEGORY_LIST = "SERVICE_OBJECT_CATEGORY";
const DOCUMENT_CATEGORY_LIST = "DOCUMENT_CATEGORY";
const DOCUMENT_HEADER_KEY_LIST = "DOCUMENT_HEADER_KEY";
const PROCESS_TABLES_REQUIRED = [
  "eip_core.dropdown_list",
  "eip_core.dropdown_value",
  "eip_core.process_def",
  "eip_core.process_binding",
  "eip_core.process_instance",
  "eip_core.process_task_template",
  "eip_core.service_object",
  "eip_core.task"
];

function clampLimit(value) {
  const n = Number(value || 50);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOptionalText(value) {
  const trimmed = normalizeText(value);
  return trimmed.length ? trimmed : null;
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

async function ensureProcessSchema(app) {
  const cached = app.processSchemaStatus;
  if (cached && Date.now() - cached.checkedAt < 10_000) {
    return cached;
  }

  const selectors = PROCESS_TABLES_REQUIRED.map(
    (tableName, index) => `to_regclass('${tableName}')::text AS t${index}`
  ).join(",\n        ");

  const result = await app.db.query(`
    SELECT
      ${selectors}
  `);

  const row = result.rows[0] || {};
  const missing = [];
  PROCESS_TABLES_REQUIRED.forEach((tableName, index) => {
    if (!row[`t${index}`]) missing.push(tableName);
  });

  const status = {
    ok: missing.length === 0,
    missing,
    checkedAt: Date.now()
  };

  app.processSchemaStatus = status;
  return status;
}

async function requirePerm(app, req, reply, permCodes) {
  const authz = await app.requirePermission(req, permCodes, { realm: "EIP" });
  if (!authz.ok) {
    const body = { ok: false, error: authz.error };
    if (Array.isArray(authz.required_permissions) && authz.required_permissions.length > 0) {
      body.required_permissions = authz.required_permissions;
    }
    reply.code(authz.status).send(body);
    return null;
  }

  const c = await app.requireCsrf(req);
  if (!c.ok) {
    reply.code(c.status).send({ ok: false, error: c.error });
    return null;
  }

  const schema = await ensureProcessSchema(app);
  if (!schema.ok) {
    reply.code(503).send({
      ok: false,
      error: "PROCESS_SCHEMA_UNAVAILABLE",
      missing: schema.missing
    });
    return null;
  }

  return authz.session;
}

async function resolveTenantScope(_app, session, requestedTenantId) {
  const targetTenantId =
    normalizeOptionalText(requestedTenantId) || session.tenant_id;
  if (targetTenantId === session.tenant_id) {
    return { ok: true, tenantId: targetTenantId };
  }
  // Wave 3A keeps tenant scope fail-closed until centralized cross-tenant authz is migrated.
  return { ok: false, error: "TENANT_ACCESS_REQUIRED" };
}

async function loadDropdownListId(app, tenantId, code) {
  const r = await app.db.query(
    `
    SELECT id
    FROM eip_core.dropdown_list
    WHERE code=$1
      AND is_active=true
      AND (tenant_id=$2 OR tenant_id IS NULL)
    ORDER BY (tenant_id IS NOT NULL) DESC, version DESC
    LIMIT 1
    `,
    [code, tenantId]
  );
  return r.rows[0]?.id ?? null;
}

async function loadDropdownValues(app, tenantId, code) {
  const listId = await loadDropdownListId(app, tenantId, code);
  if (!listId) return [];
  const r = await app.db.query(
    `
    SELECT code, label, attrs
    FROM eip_core.dropdown_value
    WHERE list_id=$1 AND is_active=true
    ORDER BY sort_order ASC, code ASC
    `,
    [listId]
  );
  return r.rows || [];
}

function buildDropdownCodeMap(values) {
  const map = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const code = normalizeUpper(value?.code);
    if (!code) continue;
    map.set(code, value);
  }
  return map;
}

function hasEffectValue(effect, fieldName) {
  const value = effect?.[fieldName];
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return normalizeOptionalText(value) !== null;
  return true;
}

function resolveCanonicalEffectType(type, effectMetaMap) {
  const meta = effectMetaMap.get(type);
  const attrs = meta?.attrs && typeof meta.attrs === "object" ? meta.attrs : {};
  const canonical = normalizeUpper(
    attrs.canonical_effect_code ||
      attrs.canonicalEffectCode ||
      attrs.alias_of ||
      attrs.aliasOf ||
      type
  );
  return canonical || type;
}

function applyGovernedEffectRequirements(effect, source, effectMeta, errors) {
  const attrs = effectMeta?.attrs && typeof effectMeta.attrs === "object" ? effectMeta.attrs : {};
  const requiredFields = Array.isArray(attrs.required_fields) ? attrs.required_fields : [];
  for (const field of requiredFields) {
    if (!hasEffectValue(effect, field)) {
      errors.push(`EFFECT_FIELD_REQUIRED:${source}:${field}`);
    }
  }

  const requiredAnyGroups = Array.isArray(attrs.required_any) ? attrs.required_any : [];
  for (const group of requiredAnyGroups) {
    if (!Array.isArray(group) || group.length === 0) continue;
    const satisfied = group.some((field) => hasEffectValue(effect, field));
    if (!satisfied) {
      errors.push(`EFFECT_FIELD_ANY_REQUIRED:${source}:${group.join("|")}`);
    }
  }

  const allowedTargets = Array.isArray(attrs.allowed_targets) ? attrs.allowed_targets : [];
  if (allowedTargets.length > 0 && hasEffectValue(effect, "target")) {
    const target = normalizeOptionalText(effect?.target);
    if (target && !allowedTargets.includes(target)) {
      errors.push(`EFFECT_TARGET_INVALID:${source}:${target}`);
    }
  }
}

function buildNodeMap(graph) {
  const nodes = graph && typeof graph === "object" ? graph.nodes : null;
  if (!nodes) return {};
  if (Array.isArray(nodes)) {
    const map = {};
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const id = normalizeOptionalText(node.id || node.key || node.name);
      if (id) map[id] = { ...node, id };
    }
    return map;
  }
  if (typeof nodes === "object") {
    const map = {};
    for (const [key, node] of Object.entries(nodes)) {
      if (!node || typeof node !== "object") continue;
      const id = normalizeOptionalText(node.id || key);
      if (id) map[id] = { ...node, id };
    }
    return map;
  }
  return {};
}

function collectTransitions(graph) {
  return Array.isArray(graph?.transitions) ? graph.transitions : [];
}

function buildAdjacency(nodes, transitions) {
  const outgoing = {};
  const incoming = {};
  Object.keys(nodes).forEach((id) => {
    outgoing[id] = [];
    incoming[id] = [];
  });
  for (const t of transitions) {
    if (!t) continue;
    const from = normalizeOptionalText(t.from);
    const to = normalizeOptionalText(t.to || t.target);
    if (!from || !to || !nodes[from] || !nodes[to]) continue;
    outgoing[from].push(to);
    incoming[to].push(from);
  }
  return { outgoing, incoming };
}

function detectCycles(nodes, outgoing) {
  const visited = new Set();
  const stack = new Set();
  const errors = [];

  function dfs(nodeId) {
    if (stack.has(nodeId)) {
      errors.push(`CYCLE_DETECTED:${nodeId}`);
      return;
    }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    stack.add(nodeId);
    for (const next of outgoing[nodeId] || []) {
      dfs(next);
    }
    stack.delete(nodeId);
  }

  for (const nodeId of Object.keys(nodes)) {
    if (!visited.has(nodeId)) dfs(nodeId);
  }
  return errors;
}

function reachableJoinNodes(startId, nodes, outgoing, cache) {
  if (cache[startId]) return cache[startId];
  const joinIds = new Set();
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const nodeType = normalizeUpper(nodes[current]?.type);
    if (nodeType === "JOIN") joinIds.add(current);
    for (const next of outgoing[current] || []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  cache[startId] = joinIds;
  return joinIds;
}

function buildMacroMap(graph) {
  const macros = graph && typeof graph === "object" ? graph.macros : null;
  if (!macros) return {};

  if (Array.isArray(macros)) {
    const map = {};
    for (const macro of macros) {
      if (!macro || typeof macro !== "object") continue;
      const code = normalizeOptionalText(macro.code || macro.id || macro.key || macro.name);
      if (code) map[code] = { ...macro, code };
    }
    return map;
  }

  if (typeof macros === "object") {
    const map = {};
    for (const [key, macro] of Object.entries(macros)) {
      if (!macro || typeof macro !== "object") continue;
      const code = normalizeOptionalText(macro.code || key);
      if (code) map[code] = { ...macro, code };
    }
    return map;
  }

  return {};
}

function normalizeIsoTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildProcessWorkbenchProjection(row, effectMetaMap, options = {}) {
  const graph = row?.graph && typeof row.graph === "object" ? row.graph : {};
  const attrs = row?.attrs && typeof row.attrs === "object" ? row.attrs : {};
  const includeGraph = options.includeGraph === true;

  const nodes = buildNodeMap(graph);
  const transitions = collectTransitions(graph);
  const macroMap = buildMacroMap(graph);

  const effectRefMap = new Map();
  const macroSummaries = [];

  for (const [macroCode, macro] of Object.entries(macroMap)) {
    const effects = Array.isArray(macro?.effects) ? macro.effects : [];
    const macroEffectCodes = new Set();
    const macroEffectItems = [];

    for (const effect of effects) {
      const requestedType = normalizeUpper(effect?.type);
      if (!requestedType) continue;
      const canonicalType = resolveCanonicalEffectType(requestedType, effectMetaMap);
      const referenceKey = canonicalType || requestedType;

      const serviceObjectType = normalizeOptionalText(
        effect?.service_object_type || effect?.object_type || effect?.objectType
      );
      const serviceObjectCategory = normalizeOptionalText(
        effect?.service_object_category || effect?.object_category || effect?.objectCategory
      );

      if (!effectRefMap.has(referenceKey)) {
        effectRefMap.set(referenceKey, {
          canonical_effect_code: referenceKey,
          requested_codes: new Set(),
          macro_codes: new Set(),
          service_object_types: new Set(),
          service_object_categories: new Set(),
          effect_count: 0
        });
      }

      const effectRef = effectRefMap.get(referenceKey);
      effectRef.effect_count += 1;
      effectRef.requested_codes.add(requestedType);
      effectRef.macro_codes.add(macroCode);
      if (serviceObjectType) effectRef.service_object_types.add(serviceObjectType);
      if (serviceObjectCategory) effectRef.service_object_categories.add(serviceObjectCategory);

      macroEffectCodes.add(referenceKey);
      macroEffectItems.push({
        effect_type: requestedType,
        canonical_effect_code: referenceKey,
        service_object_type: serviceObjectType,
        service_object_category: serviceObjectCategory
      });
    }

    macroSummaries.push({
      macro_code: macroCode,
      label: normalizeOptionalText(macro?.label || macro?.name || macroCode),
      effect_count: effects.length,
      effect_codes: Array.from(macroEffectCodes).sort(),
      effects: macroEffectItems
    });
  }

  const taskLabelSet = new Set();
  const transitionSummaries = transitions.map((transition, index) => {
    const from = normalizeOptionalText(transition?.from);
    const to = normalizeOptionalText(transition?.to || transition?.target);
    const action = normalizeOptionalText(transition?.action);
    const edgeType = normalizeUpper(transition?.edge_type || transition?.edgeType || "DEFAULT");
    const taskLabel = normalizeOptionalText(transition?.task_label || transition?.taskLabel);
    const macroCode = normalizeOptionalText(transition?.macro_code || transition?.macroCode);
    const macro = macroCode ? macroMap[macroCode] : null;
    const macroEffects = Array.isArray(macro?.effects) ? macro.effects : [];
    const effectCodes = Array.from(
      new Set(
        macroEffects
          .map((effect) => normalizeUpper(effect?.type))
          .filter(Boolean)
          .map((effectType) => resolveCanonicalEffectType(effectType, effectMetaMap))
      )
    ).sort();

    if (taskLabel) taskLabelSet.add(taskLabel);

    return {
      transition_key: `${from || "?"}:${action || "?"}:${to || "?"}:${index}`,
      from,
      to,
      action,
      edge_type: edgeType,
      task_label: taskLabel,
      macro_code: macroCode,
      macro_defined: Boolean(macro),
      effect_codes: effectCodes
    };
  });

  const nodeSummaries = Object.values(nodes)
    .map((node) => ({
      node_id: normalizeOptionalText(node.id || node.key || node.name),
      node_type: normalizeUpper(node.type || node.node_type),
      label: normalizeOptionalText(node.label || node.title),
      is_terminal:
        node?.is_terminal === true ||
        node?.isTerminal === true ||
        node?.terminal === true
    }))
    .filter((node) => Boolean(node.node_id));

  const terminalNodes = nodeSummaries
    .filter((node) => node.is_terminal)
    .map((node) => node.node_id);

  const effectReferences = Array.from(effectRefMap.values())
    .map((entry) => ({
      canonical_effect_code: entry.canonical_effect_code,
      requested_codes: Array.from(entry.requested_codes).sort(),
      macro_codes: Array.from(entry.macro_codes).sort(),
      service_object_types: Array.from(entry.service_object_types).sort(),
      service_object_categories: Array.from(entry.service_object_categories).sort(),
      effect_count: entry.effect_count
    }))
    .sort((a, b) => a.canonical_effect_code.localeCompare(b.canonical_effect_code));

  const objectType = normalizeOptionalText(
    graph?.object_type || graph?.objectType || attrs?.object_type || attrs?.objectType
  );
  const serviceObjectCategory = normalizeOptionalText(
    attrs?.service_object_category || attrs?.serviceObjectCategory || graph?.service_object_category
  );
  const module = normalizeOptionalText(attrs?.module || attrs?.module_code);
  const isPublished = attrs?.is_published === true || attrs?.isPublished === true;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    version: row.version,
    is_active: row.is_active === true,
    is_published: isPublished,
    module,
    object_type: objectType,
    service_object_category: serviceObjectCategory,
    created_at: normalizeIsoTimestamp(row.created_at),
    updated_at: normalizeIsoTimestamp(row.updated_at),
    graph_summary: {
      initial_node: normalizeOptionalText(graph?.initial_node || graph?.initialNode),
      node_count: nodeSummaries.length,
      transition_count: transitionSummaries.length,
      macro_count: macroSummaries.length,
      terminal_nodes: terminalNodes
    },
    graph_inspection: {
      nodes: nodeSummaries,
      transitions: transitionSummaries,
      task_labels: Array.from(taskLabelSet).sort(),
      macros: macroSummaries.sort((a, b) => a.macro_code.localeCompare(b.macro_code)),
      effect_references: effectReferences
    },
    attrs,
    ...(includeGraph ? { graph } : {})
  };
}

async function loadProcessWorkbenchCounts(app, tenantId, processDefIds) {
  const ids = Array.isArray(processDefIds)
    ? processDefIds.filter((id) => normalizeOptionalText(id))
    : [];
  if (ids.length === 0) return {};

  const templateRes = await app.db.query(
    `
    SELECT process_def_id, count(*)::int AS task_template_count
    FROM eip_core.task_template
    WHERE tenant_id=$1
      AND process_def_id = ANY($2::uuid[])
    GROUP BY process_def_id
    `,
    [tenantId, ids]
  );

  const bindingRes = await app.db.query(
    `
    SELECT process_def_id, count(*)::int AS binding_count
    FROM eip_core.process_binding
    WHERE tenant_id=$1
      AND process_def_id = ANY($2::uuid[])
    GROUP BY process_def_id
    `,
    [tenantId, ids]
  );

  const instanceRes = await app.db.query(
    `
    SELECT
      process_def_id,
      count(*)::int AS instance_total_count,
      count(*) FILTER (WHERE status='active')::int AS instance_active_count
    FROM eip_core.process_instance
    WHERE tenant_id=$1
      AND process_def_id = ANY($2::uuid[])
    GROUP BY process_def_id
    `,
    [tenantId, ids]
  );

  const counts = {};
  for (const id of ids) {
    counts[id] = {
      task_template_count: 0,
      binding_count: 0,
      instance_total_count: 0,
      instance_active_count: 0
    };
  }

  for (const row of templateRes.rows || []) {
    if (!counts[row.process_def_id]) continue;
    counts[row.process_def_id].task_template_count = Number(row.task_template_count || 0);
  }

  for (const row of bindingRes.rows || []) {
    if (!counts[row.process_def_id]) continue;
    counts[row.process_def_id].binding_count = Number(row.binding_count || 0);
  }

  for (const row of instanceRes.rows || []) {
    if (!counts[row.process_def_id]) continue;
    counts[row.process_def_id].instance_total_count = Number(row.instance_total_count || 0);
    counts[row.process_def_id].instance_active_count = Number(row.instance_active_count || 0);
  }

  return counts;
}

function validateEffectDefinition(effect, source, effectTypeSet, effectMetaMap, errors) {
  const typeRaw = normalizeOptionalText(effect?.type);
  if (!typeRaw) {
    errors.push(`EFFECT_TYPE_REQUIRED:${source}`);
    return;
  }

  const type = normalizeUpper(typeRaw);
  if (!effectTypeSet.has(type)) {
    errors.push(`EFFECT_TYPE_INVALID:${source}:${type}`);
    return;
  }

  const effectMeta = effectMetaMap.get(type);
  const canonicalType = resolveCanonicalEffectType(type, effectMetaMap);
  if (!effectTypeSet.has(canonicalType)) {
    errors.push(`EFFECT_CANONICAL_INVALID:${source}:${type}`);
    return;
  }

  applyGovernedEffectRequirements(effect, source, effectMeta, errors);

  if (canonicalType === "STATUS_SET") {
    const toStatus = normalizeOptionalText(effect?.to);
    if (!toStatus) errors.push(`STATUS_SET_TO_REQUIRED:${source}`);
  }
  if (canonicalType === "TASK_CREATE") {
    if (!normalizeOptionalText(effect?.task_type)) errors.push(`TASK_CREATE_TASK_TYPE_REQUIRED:${source}`);
  }
  if (canonicalType === "TASK_UPDATE") {
    if (!normalizeOptionalText(effect?.task_id)) errors.push(`TASK_UPDATE_TASK_ID_REQUIRED:${source}`);
  }
  if (canonicalType === "LINK_CREATE" || canonicalType === "LINK_REMOVE") {
    if (!normalizeOptionalText(effect?.src_kind)) errors.push(`LINK_SRC_KIND_REQUIRED:${source}`);
    if (!normalizeOptionalText(effect?.dst_kind)) errors.push(`LINK_DST_KIND_REQUIRED:${source}`);
    if (!normalizeOptionalText(effect?.relation_type)) errors.push(`LINK_RELATION_REQUIRED:${source}`);
    if (!normalizeOptionalText(effect?.src_id)) errors.push(`LINK_SRC_ID_REQUIRED:${source}`);
    if (!normalizeOptionalText(effect?.dst_id)) errors.push(`LINK_DST_ID_REQUIRED:${source}`);
  }
  if (canonicalType === "JSON_MERGE") {
    if (!normalizeOptionalText(effect?.target)) errors.push(`JSON_MERGE_TARGET_REQUIRED:${source}`);
    const value = effect?.value ?? effect?.attrs;
    if (!value || typeof value !== "object") errors.push(`JSON_MERGE_VALUE_REQUIRED:${source}`);
  }
  if (canonicalType === "CHILD_SERVICE_OBJECT_CREATE") {
    const item = Array.isArray(effect?.items) ? effect.items[0] : effect;
    if (!normalizeOptionalText(item?.object_type || item?.objectType)) {
      errors.push(`SO_CREATE_OBJECT_TYPE_REQUIRED:${source}`);
    }
  }
  if (canonicalType === "INFO_RECORD_WRITE") {
    if (!normalizeOptionalText(effect?.record_type)) errors.push(`INFO_RECORD_TYPE_REQUIRED:${source}`);
  }
  if (canonicalType === "HTTP_REQUEST") {
    if (
      !normalizeOptionalText(effect?.connection_code) &&
      !normalizeOptionalText(effect?.gateway_connection_code) &&
      !normalizeOptionalText(effect?.connection)
    ) {
      errors.push(`HTTP_REQUEST_CONNECTION_REQUIRED:${source}`);
    }
    if (!normalizeOptionalText(effect?.url) && !normalizeOptionalText(effect?.endpoint)) {
      errors.push(`HTTP_REQUEST_URL_REQUIRED:${source}`);
    }
  }
  if (canonicalType === "ACCESS_GRANT_CREATE") {
    if (!normalizeOptionalText(effect?.grant_type)) errors.push(`ACCESS_GRANT_TYPE_REQUIRED:${source}`);
    if (
      !normalizeOptionalText(effect?.token_hash) &&
      !normalizeOptionalText(effect?.token_raw) &&
      !(effect?.allow_missing === true)
    ) {
      errors.push(`ACCESS_GRANT_TOKEN_REQUIRED:${source}`);
    }
  }
  if (canonicalType === "INVENTORY_MOVE" || canonicalType === "INVENTORY_CONSUME") {
    if (
      !normalizeOptionalText(effect?.material_lot_id) &&
      !normalizeOptionalText(effect?.lot_id) &&
      !normalizeOptionalText(effect?.material_lot_code) &&
      !normalizeOptionalText(effect?.lot_code)
    ) {
      errors.push(`MATERIAL_LOT_ID_REQUIRED:${source}`);
    }
  }
  if (canonicalType === "INVENTORY_PRODUCE") {
    if (
      !normalizeOptionalText(effect?.material_id) &&
      !normalizeOptionalText(effect?.material_code)
    ) {
      errors.push(`MATERIAL_ID_REQUIRED:${source}`);
    }
    if (effect?.quantity === undefined || effect?.quantity === null) {
      errors.push(`INVENTORY_QUANTITY_REQUIRED:${source}`);
    }
  }
  if (canonicalType === "INVENTORY_CONVERT") {
    if (
      !normalizeOptionalText(effect?.input_lot_id) &&
      !normalizeOptionalText(effect?.material_lot_id) &&
      !normalizeOptionalText(effect?.lot_id)
    ) {
      errors.push(`MATERIAL_LOT_ID_REQUIRED:${source}`);
    }
    if (
      !normalizeOptionalText(effect?.output_material_id) &&
      !normalizeOptionalText(effect?.output_material_code)
    ) {
      errors.push(`OUTPUT_MATERIAL_REQUIRED:${source}`);
    }
    if (effect?.output_quantity === undefined || effect?.output_quantity === null) {
      errors.push(`INVENTORY_QUANTITY_REQUIRED:${source}`);
    }
  }
  if (canonicalType === "ACCESS_GRANT_UPDATE") {
    if (!normalizeOptionalText(effect?.grant_id) && !normalizeOptionalText(effect?.token_hash)) {
      errors.push(`ACCESS_GRANT_KEY_REQUIRED:${source}`);
    }
  }
}

async function validateTaskTemplateAttrs(app, tenantId, attrs) {
  const errors = [];
  const allowedActions = await loadDropdownValues(app, tenantId, TASK_ACTION_LIST);
  const actionSet = new Set(allowedActions.map((item) => item.code));

  const actions =
    Array.isArray(attrs?.allowed_actions)
      ? attrs.allowed_actions
      : Array.isArray(attrs?.allowedActions)
        ? attrs.allowedActions
        : [];
  for (const action of actions) {
    if (!actionSet.has(String(action || "").trim())) {
      errors.push(`INVALID_TASK_ACTION:${action}`);
    }
  }

  const completion = normalizeOptionalText(attrs?.completion_action || attrs?.completionAction);
  if (completion && !actionSet.has(completion)) {
    errors.push(`INVALID_COMPLETION_ACTION:${completion}`);
  }

  return errors;
}

async function validateProcessGraph(app, tenantId, processDefId, graph, attrs) {
  const errors = [];

  if (!graph || typeof graph !== "object") {
    return { ok: false, errors: ["GRAPH_REQUIRED"] };
  }

  const nodes = buildNodeMap(graph);
  if (Object.keys(nodes).length === 0) errors.push("NODES_REQUIRED");

  const initialNode = normalizeOptionalText(graph.initial_node || graph.initialNode);
  if (!initialNode) errors.push("INITIAL_NODE_REQUIRED");
  if (initialNode && !nodes[initialNode]) errors.push("INITIAL_NODE_NOT_FOUND");

  const transitions = collectTransitions(graph);
  const { outgoing, incoming } = buildAdjacency(nodes, transitions);

  const nodeTypes = await loadDropdownValues(app, tenantId, PROCESS_NODE_TYPE_LIST);
  const edgeTypes = await loadDropdownValues(app, tenantId, PROCESS_EDGE_TYPE_LIST);
  const effectTypes = await loadDropdownValues(app, tenantId, PROCESS_EFFECT_TYPE_LIST);
  const actionTypes = await loadDropdownValues(app, tenantId, PROCESS_ACTION_LIST);
  const serviceObjectTypes = await loadDropdownValues(app, tenantId, SERVICE_OBJECT_TYPE_LIST);
  const serviceObjectCategories = await loadDropdownValues(app, tenantId, SERVICE_OBJECT_CATEGORY_LIST);
  const documentCategories = await loadDropdownValues(app, tenantId, DOCUMENT_CATEGORY_LIST);
  const documentHeaderKeys = await loadDropdownValues(app, tenantId, DOCUMENT_HEADER_KEY_LIST);

  const nodeTypeSet = new Set(nodeTypes.map((item) => normalizeUpper(item.code)));
  const edgeTypeSet = new Set(edgeTypes.map((item) => normalizeUpper(item.code)));
  const effectMetaMap = buildDropdownCodeMap(effectTypes);
  const effectTypeSet = new Set(effectMetaMap.keys());
  const actionTypeSet = new Set(actionTypes.map((item) => normalizeUpper(item.code)));
  const serviceObjectTypeMap = buildDropdownCodeMap(serviceObjectTypes);
  const serviceObjectCategorySet = new Set(serviceObjectCategories.map((item) => normalizeUpper(item.code)));
  const documentCategorySet = new Set(documentCategories.map((item) => normalizeUpper(item.code)));
  const documentHeaderKeySet = new Set(documentHeaderKeys.map((item) => normalizeUpper(item.code)));

  for (const node of Object.values(nodes)) {
    const type = normalizeUpper(node.type || node.node_type);
    if (!type) {
      errors.push(`NODE_TYPE_REQUIRED:${node.id}`);
    } else if (!nodeTypeSet.has(type)) {
      errors.push(`NODE_TYPE_INVALID:${node.id}:${type}`);
    }
  }

  const macroMap = buildMacroMap(graph);
  for (const [macroCode, macro] of Object.entries(macroMap)) {
    const effects = Array.isArray(macro?.effects) ? macro.effects : [];
    if (effects.length === 0) {
      errors.push(`MACRO_EFFECTS_REQUIRED:${macroCode}`);
      continue;
    }
    for (const effect of effects) {
      validateEffectDefinition(effect, `macro:${macroCode}`, effectTypeSet, effectMetaMap, errors);
    }
  }

  for (const t of transitions) {
    if (!t) continue;
    const from = normalizeOptionalText(t.from);
    const to = normalizeOptionalText(t.to || t.target);
    const action = normalizeOptionalText(t.action);
    const edgeType = normalizeUpper(t.edge_type || t.edgeType || "DEFAULT");
    const macroCode = normalizeOptionalText(t.macro_code || t.macroCode);
    const effects = Array.isArray(t.effects) ? t.effects : [];

    if (!from || !nodes[from]) errors.push(`TRANSITION_FROM_INVALID:${from || "?"}`);
    if (!to || !nodes[to]) errors.push(`TRANSITION_TO_INVALID:${to || "?"}`);
    if (!action) errors.push(`TRANSITION_ACTION_REQUIRED:${from || "?"}`);
    if (action && actionTypeSet.size > 0 && !actionTypeSet.has(normalizeUpper(action))) {
      errors.push(`ACTION_TYPE_INVALID:${from || "?"}:${action}`);
    }
    if (!edgeTypeSet.has(edgeType)) errors.push(`EDGE_TYPE_INVALID:${from || "?"}:${edgeType}`);

    if (!macroCode) {
      errors.push(`TRANSITION_MACRO_REQUIRED:${from || "?"}`);
    } else if (!macroMap[macroCode]) {
      errors.push(`TRANSITION_MACRO_NOT_FOUND:${from || "?"}:${macroCode}`);
    }

    if (effects.length > 0) {
      errors.push(`TRANSITION_EFFECTS_INLINE_FORBIDDEN:${from || "?"}`);
    }
  }

  // Branching rules
  for (const [nodeId, targets] of Object.entries(outgoing)) {
    if (targets.length <= 1) continue;
    const nodeType = normalizeUpper(nodes[nodeId]?.type || nodes[nodeId]?.node_type);
    if (nodeType !== "ROUTER") {
      errors.push(`BRANCH_REQUIRES_ROUTER:${nodeId}`);
    }
  }

  for (const [nodeId, sources] of Object.entries(incoming)) {
    const nodeType = normalizeUpper(nodes[nodeId]?.type || nodes[nodeId]?.node_type);
    if (nodeType === "JOIN" && sources.length < 2) {
      errors.push(`JOIN_REQUIRES_MULTIPLE_INCOMING:${nodeId}`);
    }
  }

  // Router join enforcement (no implicit merges)
  const joinCache = {};
  for (const [nodeId, targets] of Object.entries(outgoing)) {
    const nodeType = normalizeUpper(nodes[nodeId]?.type || nodes[nodeId]?.node_type);
    if (nodeType !== "ROUTER" || targets.length <= 1) continue;

    const branchJoins = targets.map((target) =>
      reachableJoinNodes(target, nodes, outgoing, joinCache)
    );
    const intersection = branchJoins.reduce((acc, set) => {
      if (!acc) return new Set(set);
      return new Set([...acc].filter((id) => set.has(id)));
    }, null);
    if (!intersection || intersection.size === 0) {
      errors.push(`ROUTER_NO_JOIN:${nodeId}`);
    }
  }

  const cycles = detectCycles(nodes, outgoing);
  errors.push(...cycles);

  // Task template references
  const graphObjectType =
    normalizeOptionalText(graph.object_type) ||
    normalizeOptionalText(attrs?.object_type);
  const graphObjectTypeKey = normalizeUpper(graphObjectType);
  if (graphObjectType && serviceObjectTypeMap.size > 0 && !serviceObjectTypeMap.has(graphObjectTypeKey)) {
    errors.push(`SERVICE_OBJECT_TYPE_INVALID:${graphObjectType}`);
  }

  const serviceObjectCategory = normalizeOptionalText(
    attrs?.service_object_category || graph?.service_object_category
  );
  if (
    serviceObjectCategory &&
    serviceObjectCategorySet.size > 0 &&
    !serviceObjectCategorySet.has(normalizeUpper(serviceObjectCategory))
  ) {
    errors.push(`SERVICE_OBJECT_CATEGORY_INVALID:${serviceObjectCategory}`);
  }

  const graphObjectTypeMeta = serviceObjectTypeMap.get(graphObjectTypeKey);
  const graphObjectTypeAttrs =
    graphObjectTypeMeta?.attrs && typeof graphObjectTypeMeta.attrs === "object"
      ? graphObjectTypeMeta.attrs
      : {};
  const graphBusinessClass = normalizeOptionalText(
    graphObjectTypeAttrs.business_class || graphObjectTypeAttrs.businessClass
  );

  if (graphBusinessClass && graphBusinessClass.toLowerCase() === "document") {
    const documentCategory = normalizeOptionalText(
      attrs?.document_category || attrs?.documentCategory || graph?.document_category
    );
    if (
      documentCategory &&
      documentCategorySet.size > 0 &&
      !documentCategorySet.has(normalizeUpper(documentCategory))
    ) {
      errors.push(`DOCUMENT_CATEGORY_INVALID:${documentCategory}`);
    }

    const documentHeaders =
      attrs?.document_headers &&
      typeof attrs.document_headers === "object" &&
      !Array.isArray(attrs.document_headers)
        ? attrs.document_headers
        : attrs?.documentHeaders &&
            typeof attrs.documentHeaders === "object" &&
            !Array.isArray(attrs.documentHeaders)
          ? attrs.documentHeaders
          : null;
    if (documentHeaders && documentHeaderKeySet.size > 0) {
      for (const headerKey of Object.keys(documentHeaders)) {
        if (!documentHeaderKeySet.has(normalizeUpper(headerKey))) {
          errors.push(`DOCUMENT_HEADER_KEY_INVALID:${headerKey}`);
        }
      }
    }
  }

  const templateRes = await app.db.query(
    `
    SELECT task_type, service_object_type
    FROM eip_core.task_template
    WHERE tenant_id=$1 AND process_def_id=$2 AND is_active=true
    `,
    [tenantId, processDefId]
  );
  const templateRows = templateRes.rows || [];

  function templateExists(taskType) {
    return templateRows.some((row) => {
      if (row.task_type !== taskType) return false;
      if (!graphObjectType) return true;
      if (!row.service_object_type) return true;
      return row.service_object_type === graphObjectType;
    });
  }

  for (const node of Object.values(nodes)) {
    const nodeType = normalizeUpper(node.type || node.node_type);
    if (nodeType !== "HUMAN_TASK") continue;
    const onEnter = node.on_enter || node.onEnter || {};
    const refs = [];
    if (Array.isArray(onEnter.task_template_types)) {
      refs.push(...onEnter.task_template_types);
    }
    if (Array.isArray(onEnter.task_template_ids)) {
      // IDs are validated by existence below
      refs.push(...onEnter.task_template_ids);
    }
    if (Array.isArray(onEnter.task_templates)) {
      for (const entry of onEnter.task_templates) {
        if (typeof entry === "string") refs.push(entry);
        if (entry && typeof entry === "object" && entry.task_type) refs.push(entry.task_type);
      }
    }

    if (refs.length === 0) {
      errors.push(`HUMAN_TASK_MISSING_TEMPLATE:${node.id}`);
      continue;
    }

    for (const ref of refs) {
      const taskType = normalizeOptionalText(ref);
      if (!taskType) continue;
      if (!templateExists(taskType)) {
        errors.push(`TASK_TEMPLATE_MISSING:${node.id}:${taskType}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export default async function coreProcessRoutes(app) {
  const DEF_READ = ["PROCESS_DEF_READ", "CRM_PROCESS_DEF_READ"];
  const DEF_WRITE = ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"];
  const INSTANCE_READ = ["PROCESS_INSTANCE_READ", "CRM_PROCESS_DEF_READ", "CRM_PROCESS_DEF_WRITE"];
  const INSTANCE_WRITE = ["PROCESS_INSTANCE_WRITE", "CRM_PROCESS_DEF_WRITE"];

  // ==========================================================
  // Process definitions
  // ==========================================================
  app.get("/process/taxonomy", async (req, reply) => {
    const session = await requirePerm(app, req, reply, DEF_READ);
    if (!session) return;

    const scope = await resolveTenantScope(app, session, req.query?.tenant_id);
    if (!scope.ok) {
      return reply.code(403).send({ ok: false, error: scope.error });
    }
    const tenantId = scope.tenantId;

    const codes = String(req.query?.codes || "").split(",").map((c) => c.trim()).filter(Boolean);
    const targetCodes = codes.length
      ? codes
      : [
          PROCESS_NODE_TYPE_LIST,
          PROCESS_EDGE_TYPE_LIST,
          PROCESS_EFFECT_TYPE_LIST,
          PROCESS_ACTION_LIST,
          TASK_ACTION_LIST,
          SERVICE_OBJECT_TYPE_LIST,
          SERVICE_OBJECT_CATEGORY_LIST,
          DOCUMENT_CATEGORY_LIST,
          DOCUMENT_HEADER_KEY_LIST,
          "TASK_STATUS",
          "SERVICE_OBJECT_STATUS"
        ];

    const lists = {};
    for (const code of targetCodes) {
      lists[code] = await loadDropdownValues(app, tenantId, code);
    }
    return reply.send({ ok: true, lists });
  });
  app.get(
    "/process/defs",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            module: { type: "string", maxLength: 50 },
            object_type: { type: "string", maxLength: 64 },
            is_published: { type: "string", maxLength: 10 },
            tenant_id: { type: "string", minLength: 36, maxLength: 36 },
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_READ);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const tenantId = scope.tenantId;
      const module = normalizeOptionalText(req.query?.module);
      const objectType = normalizeOptionalText(req.query?.object_type);
      const isPublished = normalizeOptionalText(req.query?.is_published);
      const limit = clampLimit(req.query?.limit);
      const offset = Number(req.query?.offset || 0);

      const params = [tenantId];
      const filters = ["tenant_id=$1"];

      if (module) {
        params.push(module);
        filters.push(`attrs->>'module' = $${params.length}`);
      }
      if (objectType) {
        params.push(objectType);
        filters.push(
          `COALESCE(graph->>'object_type', attrs->>'object_type') = $${params.length}`
        );
      }
      if (isPublished !== null) {
        params.push(isPublished.toLowerCase() === "true");
        filters.push(
          `COALESCE((attrs->>'is_published')::boolean,false) = $${params.length}`
        );
      }

      params.push(limit);
      params.push(offset);

      const r = await app.db.query(
        `
        SELECT id, code, name, version, is_active, graph, attrs, created_at, updated_at
        FROM eip_core.process_def
        WHERE ${filters.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );

      return reply.send({ ok: true, items: r.rows, limit, offset });
    }
  );

  app.post(
    "/process/defs",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code", "name"],
          properties: {
            module: { type: "string", maxLength: 50 },
            code: { type: "string", minLength: 2, maxLength: 64 },
            name: { type: "string", minLength: 2, maxLength: 200 },
            version: { type: "integer", minimum: 1 },
            is_active: { type: "boolean" },
            is_published: { type: "boolean" },
            object_type: { type: "string", maxLength: 64 },
            graph: { type: "object" },
            attrs: { type: "object" },
            tenant_id: { type: "string", minLength: 36, maxLength: 36 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_WRITE);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.body?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const item = await createDef(app.db, scope.tenantId, req.body || {});
      return reply.send({ ok: true, item });
    }
  );

  app.get(
    "/process/defs/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_READ);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const r = await app.db.query(
        `
        SELECT id, code, name, version, is_active, graph, attrs, created_at, updated_at
        FROM eip_core.process_def
        WHERE tenant_id=$1 AND id=$2
        `,
        [scope.tenantId, req.params.id]
      );
      if (r.rowCount === 0) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
      return reply.send({ ok: true, item: r.rows[0] });
    }
  );

  app.patch(
    "/process/defs/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            module: { type: "string", maxLength: 50 },
            name: { type: "string", maxLength: 200 },
            is_active: { type: "boolean" },
            is_published: { type: "boolean" },
            object_type: { type: "string", maxLength: 64 },
            graph: { type: "object" },
            attrs: { type: "object" },
            tenant_id: { type: "string", minLength: 36, maxLength: 36 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_WRITE);
      if (!session) return;

      const scope = await resolveTenantScope(
        app,
        session,
        req.body?.tenant_id || req.query?.tenant_id
      );
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const body = req.body || {};
      const module = normalizeOptionalText(body.module);
      const objectType = normalizeOptionalText(body.object_type);
      const attrs = body.attrs && typeof body.attrs === "object" ? body.attrs : null;
      const graph = body.graph && typeof body.graph === "object" ? body.graph : null;

      const mergedAttrs = {
        ...(module ? { module } : {}),
        ...(objectType ? { object_type: objectType } : {}),
        ...(body.is_published !== undefined ? { is_published: body.is_published === true } : {})
      };

      const r = await app.db.query(
        `
        UPDATE eip_core.process_def
        SET name = COALESCE($3, name),
            is_active = COALESCE($4, is_active),
            graph = COALESCE($5::jsonb, graph),
            attrs = COALESCE(attrs,'{}'::jsonb) || COALESCE($6::jsonb, '{}'::jsonb) || COALESCE($7::jsonb, '{}'::jsonb),
            updated_at = now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING id, code, name, version, is_active, graph, attrs, created_at, updated_at
        `,
        [
          scope.tenantId,
          req.params.id,
          normalizeOptionalText(body.name),
          body.is_active !== undefined ? body.is_active : null,
          graph ? JSON.stringify(graph) : null,
          attrs ? JSON.stringify(attrs) : null,
          Object.keys(mergedAttrs).length ? JSON.stringify(mergedAttrs) : null
        ]
      );
      if (r.rowCount === 0) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
      return reply.send({ ok: true, item: r.rows[0] });
    }
  );

  app.post(
    "/process/defs/:id/publish",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_WRITE);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const defRes = await app.db.query(
        `
        SELECT id, graph, attrs
        FROM eip_core.process_def
        WHERE tenant_id=$1 AND id=$2
        `,
        [scope.tenantId, req.params.id]
      );
      if (defRes.rowCount === 0) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });

      const validation = await validateProcessGraph(
        app,
        scope.tenantId,
        req.params.id,
        defRes.rows[0].graph || {},
        defRes.rows[0].attrs || {}
      );
      if (!validation.ok) {
        return reply.code(409).send({ ok: false, error: "VALIDATION_FAILED", details: validation.errors });
      }

      const r = await app.db.query(
        `
        UPDATE eip_core.process_def
        SET attrs = COALESCE(attrs,'{}'::jsonb) || jsonb_build_object('is_published', true),
            updated_at = now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING id, code, name, version, is_active, graph, attrs, created_at, updated_at
        `,
        [scope.tenantId, req.params.id]
      );
      if (r.rowCount === 0) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
      return reply.send({ ok: true, item: r.rows[0] });
    }
  );

  app.post(
    "/process/defs/:id/validate",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_READ);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const defRes = await app.db.query(
        `
        SELECT id, graph, attrs
        FROM eip_core.process_def
        WHERE tenant_id=$1 AND id=$2
        `,
        [scope.tenantId, req.params.id]
      );
      if (defRes.rowCount === 0) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });

      const validation = await validateProcessGraph(
        app,
        scope.tenantId,
        req.params.id,
        defRes.rows[0].graph || {},
        defRes.rows[0].attrs || {}
      );
      return reply.send({ ok: true, valid: validation.ok, errors: validation.errors });
    }
  );

  app.get(
    "/process/workbench/catalog",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            module: { type: "string", maxLength: 50 },
            object_type: { type: "string", maxLength: 64 },
            code: { type: "string", maxLength: 64 },
            is_published: { type: "string", maxLength: 10 },
            is_active: { type: "string", maxLength: 10 },
            include_graph: { type: "string", maxLength: 10 },
            tenant_id: { type: "string", minLength: 36, maxLength: 36 },
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_READ);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const tenantId = scope.tenantId;
      const module = normalizeOptionalText(req.query?.module);
      const objectType = normalizeOptionalText(req.query?.object_type);
      const code = normalizeOptionalText(req.query?.code);
      const isPublished = normalizeOptionalText(req.query?.is_published);
      const isActive = normalizeOptionalText(req.query?.is_active);
      const includeGraph = normalizeBoolean(req.query?.include_graph, false);
      const limit = clampLimit(req.query?.limit);
      const offset = Number(req.query?.offset || 0);

      const params = [tenantId];
      const filters = ["tenant_id=$1"];

      if (module) {
        params.push(module);
        filters.push(`attrs->>'module' = $${params.length}`);
      }
      if (objectType) {
        params.push(objectType);
        filters.push(`COALESCE(graph->>'object_type', attrs->>'object_type') = $${params.length}`);
      }
      if (code) {
        params.push(code);
        filters.push(`code = $${params.length}`);
      }
      if (isPublished !== null) {
        params.push(isPublished.toLowerCase() === "true");
        filters.push(`COALESCE((attrs->>'is_published')::boolean,false) = $${params.length}`);
      }
      if (isActive !== null) {
        params.push(isActive.toLowerCase() === "true");
        filters.push(`is_active = $${params.length}`);
      }

      params.push(limit);
      params.push(offset);

      const defsRes = await app.db.query(
        `
        SELECT id, code, name, version, is_active, graph, attrs, created_at, updated_at
        FROM eip_core.process_def
        WHERE ${filters.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );

      const effectTypes = await loadDropdownValues(app, tenantId, PROCESS_EFFECT_TYPE_LIST);
      const effectMetaMap = buildDropdownCodeMap(effectTypes);

      const items = defsRes.rows.map((row) =>
        buildProcessWorkbenchProjection(row, effectMetaMap, { includeGraph })
      );

      const counts = await loadProcessWorkbenchCounts(
        app,
        tenantId,
        items.map((item) => item.id)
      );
      for (const item of items) {
        item.workbench_counts = counts[item.id] || {
          task_template_count: 0,
          binding_count: 0,
          instance_total_count: 0,
          instance_active_count: 0
        };
      }

      return reply.send({ ok: true, items, limit, offset });
    }
  );

  app.get(
    "/process/workbench/defs/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } }
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            tenant_id: { type: "string", minLength: 36, maxLength: 36 },
            include_graph: { type: "string", maxLength: 10 },
            include_recent_instances: { type: "string", maxLength: 10 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_READ);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const tenantId = scope.tenantId;
      const includeGraph = normalizeBoolean(req.query?.include_graph, true);
      const includeRecentInstances = normalizeBoolean(req.query?.include_recent_instances, true);

      const defRes = await app.db.query(
        `
        SELECT id, code, name, version, is_active, graph, attrs, created_at, updated_at
        FROM eip_core.process_def
        WHERE tenant_id=$1 AND id=$2
        `,
        [tenantId, req.params.id]
      );
      if (defRes.rowCount === 0) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });

      const effectTypes = await loadDropdownValues(app, tenantId, PROCESS_EFFECT_TYPE_LIST);
      const effectMetaMap = buildDropdownCodeMap(effectTypes);
      const item = buildProcessWorkbenchProjection(defRes.rows[0], effectMetaMap, { includeGraph });

      const templateRes = await app.db.query(
        `
        SELECT id, process_def_id, service_object_type, task_type, title, description,
               is_active, sort_order, attrs, created_at, updated_at
        FROM eip_core.task_template
        WHERE tenant_id=$1 AND process_def_id=$2
        ORDER BY sort_order ASC, created_at ASC
        `,
        [tenantId, req.params.id]
      );

      const bindingRes = await app.db.query(
        `
        SELECT id, service_object_type, process_def_id, task_type, is_active, priority, attrs,
               created_at, updated_at
        FROM eip_core.process_binding
        WHERE tenant_id=$1 AND process_def_id=$2
        ORDER BY priority ASC, created_at ASC
        `,
        [tenantId, req.params.id]
      );

      let recentInstances = [];
      if (includeRecentInstances) {
        const instanceRes = await app.db.query(
          `
          SELECT id, service_object_id, process_def_id, status, started_at, ended_at, cursor_json, attrs, created_at, updated_at
          FROM eip_core.process_instance
          WHERE tenant_id=$1 AND process_def_id=$2
          ORDER BY created_at DESC
          LIMIT 20
          `,
          [tenantId, req.params.id]
        );
        recentInstances = instanceRes.rows || [];
      }

      item.workbench_counts = (
        await loadProcessWorkbenchCounts(app, tenantId, [item.id])
      )[item.id] || {
        task_template_count: 0,
        binding_count: 0,
        instance_total_count: 0,
        instance_active_count: 0
      };

      return reply.send({
        ok: true,
        item,
        task_templates: templateRes.rows,
        bindings: bindingRes.rows,
        recent_instances: recentInstances
      });
    }
  );

  // ==========================================================
  // Process instances
  // ==========================================================
  app.get(
    "/process/instances",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            service_object_id: { type: "string", minLength: 36, maxLength: 36 },
            tenant_id: { type: "string", minLength: 36, maxLength: 36 },
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, INSTANCE_READ);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const tenantId = scope.tenantId;
      const serviceObjectId = normalizeOptionalText(req.query?.service_object_id);
      const limit = clampLimit(req.query?.limit);
      const offset = Number(req.query?.offset || 0);

      const params = [tenantId];
      const filters = ["tenant_id=$1"];
      if (serviceObjectId) {
        params.push(serviceObjectId);
        filters.push(`service_object_id=$${params.length}`);
      }

      params.push(limit);
      params.push(offset);

      const r = await app.db.query(
        `
        SELECT id, service_object_id, process_def_id, status, started_at, ended_at, cursor_json, attrs, created_at, updated_at
        FROM eip_core.process_instance
        WHERE ${filters.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );

      return reply.send({ ok: true, items: r.rows, limit, offset });
    }
  );

  app.get(
    "/process/instances/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, INSTANCE_READ);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const r = await app.db.query(
        `
        SELECT id, service_object_id, process_def_id, status, started_at, ended_at, cursor_json, attrs, created_at, updated_at
        FROM eip_core.process_instance
        WHERE tenant_id=$1 AND id=$2
        `,
        [scope.tenantId, req.params.id]
      );
      if (r.rowCount === 0) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
      return reply.send({ ok: true, item: r.rows[0] });
    }
  );

  app.post(
    "/process/instances",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["service_object_id"],
          properties: {
            service_object_id: { type: "string", minLength: 36, maxLength: 36 },
            process_def_id: { type: "string", minLength: 36, maxLength: 36 },
            task_type: { type: "string", maxLength: 100 },
            module: { type: "string", maxLength: 50 },
            code: { type: "string", maxLength: 64 },
            version: { type: "integer", minimum: 1 },
            idempotency_key: { type: "string", maxLength: 200 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, INSTANCE_WRITE);
      if (!session) return;

      const body = req.body || {};

      const client = await app.db.connect();
      try {
        await client.query("BEGIN");

        const result = await createInstance(client, {
          tenantId: session.tenant_id,
          identityId: session.identity_id,
          serviceObjectId: normalizeText(body.service_object_id),
          processDefId: normalizeOptionalText(body.process_def_id),
          taskType: normalizeOptionalText(body.task_type),
          module: normalizeOptionalText(body.module),
          code: normalizeOptionalText(body.code),
          version: Number.isFinite(body.version) ? body.version : null,
          idempotencyKey: normalizeOptionalText(body.idempotency_key)
        });

        if (!result.ok) {
          await client.query("ROLLBACK");
          const status = result.error === "SERVICE_OBJECT_NOT_FOUND" ||
            result.error === "PROCESS_DEF_NOT_FOUND" ||
            result.error === "PROCESS_BINDING_NOT_FOUND"
            ? 404
            : result.error === "INITIAL_NODE_REQUIRED"
              ? 400
              : 409;
          return reply.code(status).send({ ok: false, error: result.error });
        }

        await client.query("COMMIT");
        return reply.send({ ok: true, item: result.item, reused: result.reused === true });
      } catch (e) {
        await client.query("ROLLBACK");
        app.log.error({ event: "core_process_instance_create_error", tenantId: session.tenant_id, error: e.message });
        return reply.code(500).send({ ok: false });
      } finally {
        client.release();
      }
    }
  );

  app.post(
    "/process/instances/:id/advance",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["action", "idempotency_key"],
          properties: {
            action: { type: "string", minLength: 1, maxLength: 50 },
            payload: { type: "object" },
            idempotency_key: { type: "string", minLength: 6, maxLength: 200 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, INSTANCE_WRITE);
      if (!session) return;

      const client = await app.db.connect();
      try {
        await client.query("BEGIN");

        const result = await advanceInstance(client, {
          tenantId: session.tenant_id,
          identityId: session.identity_id,
          instanceId: req.params.id,
          action: normalizeText(req.body.action),
          payload: req.body.payload || {},
          idempotencyKey: normalizeText(req.body.idempotency_key)
        });

        if (!result.ok) {
          await client.query("ROLLBACK");
          const status = result.error === "NOT_FOUND" ? 404 : 409;
          return reply.code(status).send({ ok: false, error: result.error });
        }

        await client.query("COMMIT");
        return reply.send({ ok: true, entry: result.entry, reused: result.reused === true });
      } catch (e) {
        await client.query("ROLLBACK");
        app.log.error({ event: "core_process_instance_advance_error", tenantId: session.tenant_id, error: e.message });
        return reply.code(500).send({ ok: false });
      } finally {
        client.release();
      }
    }
  );

  // ==========================================================
  // Task templates
  // ==========================================================
  app.get(
    "/process/task-templates",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            process_def_id: { type: "string", minLength: 36, maxLength: 36 },
            service_object_type: { type: "string", maxLength: 64 },
            is_active: { type: "string", maxLength: 10 },
            tenant_id: { type: "string", minLength: 36, maxLength: 36 },
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_READ);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const tenantId = scope.tenantId;
      const processDefId = normalizeOptionalText(req.query?.process_def_id);
      const serviceObjectType = normalizeOptionalText(req.query?.service_object_type);
      const isActive = normalizeOptionalText(req.query?.is_active);
      const limit = clampLimit(req.query?.limit);
      const offset = Number(req.query?.offset || 0);

      const params = [tenantId];
      const filters = ["tenant_id=$1"];
      if (processDefId) {
        params.push(processDefId);
        filters.push(`process_def_id=$${params.length}`);
      }
      if (serviceObjectType) {
        params.push(serviceObjectType);
        filters.push(`service_object_type=$${params.length}`);
      }
      if (isActive !== null) {
        params.push(isActive.toLowerCase() === "true");
        filters.push(`is_active=$${params.length}`);
      }

      params.push(limit);
      params.push(offset);

      const r = await app.db.query(
        `
        SELECT id, process_def_id, service_object_type, task_type, title, description,
               is_active, sort_order, attrs, created_at, updated_at
        FROM eip_core.task_template
        WHERE ${filters.join(" AND ")}
        ORDER BY sort_order ASC, created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );

      return reply.send({ ok: true, items: r.rows, limit, offset });
    }
  );

  app.post(
    "/process/task-templates",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["process_def_id", "task_type"],
          properties: {
            process_def_id: { type: "string", minLength: 36, maxLength: 36 },
            service_object_type: { type: "string", maxLength: 64 },
            task_type: { type: "string", minLength: 2, maxLength: 100 },
            title: { type: "string", maxLength: 200 },
            description: { type: "string", maxLength: 2000 },
            sort_order: { type: "integer", minimum: 0, maximum: 10000 },
            is_active: { type: "boolean" },
            attrs: { type: "object" },
            tenant_id: { type: "string", minLength: 36, maxLength: 36 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_WRITE);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.body?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const body = req.body || {};
      const attrs = body.attrs && typeof body.attrs === "object" ? body.attrs : {};
      const attrErrors = await validateTaskTemplateAttrs(app, scope.tenantId, attrs);
      if (attrErrors.length) {
        return reply.code(409).send({ ok: false, error: "INVALID_TASK_TEMPLATE", details: attrErrors });
      }

      const r = await app.db.query(
        `
        INSERT INTO eip_core.task_template
          (tenant_id, process_def_id, service_object_type, task_type, title, description,
           is_active, sort_order, attrs)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
        RETURNING id, process_def_id, service_object_type, task_type, title, description,
                  is_active, sort_order, attrs, created_at, updated_at
        `,
        [
          scope.tenantId,
          normalizeText(body.process_def_id),
          normalizeOptionalText(body.service_object_type),
          normalizeText(body.task_type),
          normalizeOptionalText(body.title),
          normalizeOptionalText(body.description),
          body.is_active !== false,
          Number.isFinite(body.sort_order) ? body.sort_order : 100,
          JSON.stringify(attrs)
        ]
      );
      return reply.send({ ok: true, item: r.rows[0] });
    }
  );

  app.patch(
    "/process/task-templates/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            service_object_type: { type: "string", maxLength: 64 },
            task_type: { type: "string", minLength: 2, maxLength: 100 },
            title: { type: "string", maxLength: 200 },
            description: { type: "string", maxLength: 2000 },
            sort_order: { type: "integer", minimum: 0, maximum: 10000 },
            is_active: { type: "boolean" },
            attrs: { type: "object" },
            tenant_id: { type: "string", minLength: 36, maxLength: 36 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_WRITE);
      if (!session) return;

      const scope = await resolveTenantScope(
        app,
        session,
        req.body?.tenant_id || req.query?.tenant_id
      );
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const body = req.body || {};
      const attrs = body.attrs && typeof body.attrs === "object" ? body.attrs : null;
      if (attrs) {
        const attrErrors = await validateTaskTemplateAttrs(app, scope.tenantId, attrs);
        if (attrErrors.length) {
          return reply.code(409).send({ ok: false, error: "INVALID_TASK_TEMPLATE", details: attrErrors });
        }
      }

      const r = await app.db.query(
        `
        UPDATE eip_core.task_template
        SET service_object_type = COALESCE($3, service_object_type),
            task_type = COALESCE($4, task_type),
            title = COALESCE($5, title),
            description = COALESCE($6, description),
            sort_order = COALESCE($7, sort_order),
            is_active = COALESCE($8, is_active),
            attrs = COALESCE(attrs,'{}'::jsonb) || COALESCE($9::jsonb, '{}'::jsonb),
            updated_at = now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING id, process_def_id, service_object_type, task_type, title, description,
                  is_active, sort_order, attrs, created_at, updated_at
        `,
        [
          scope.tenantId,
          req.params.id,
          normalizeOptionalText(body.service_object_type),
          normalizeOptionalText(body.task_type),
          normalizeOptionalText(body.title),
          normalizeOptionalText(body.description),
          Number.isFinite(body.sort_order) ? body.sort_order : null,
          body.is_active !== undefined ? body.is_active : null,
          attrs ? JSON.stringify(attrs) : null
        ]
      );
      if (r.rowCount === 0) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
      return reply.send({ ok: true, item: r.rows[0] });
    }
  );

  // ==========================================================
  // Process bindings
  // ==========================================================
  app.get(
    "/process/bindings",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            service_object_type: { type: "string", maxLength: 64 },
            process_def_id: { type: "string", minLength: 36, maxLength: 36 },
            is_active: { type: "string", maxLength: 10 },
            tenant_id: { type: "string", minLength: 36, maxLength: 36 },
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_READ);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const tenantId = scope.tenantId;
      const serviceObjectType = normalizeOptionalText(req.query?.service_object_type);
      const processDefId = normalizeOptionalText(req.query?.process_def_id);
      const isActive = normalizeOptionalText(req.query?.is_active);
      const limit = clampLimit(req.query?.limit);
      const offset = Number(req.query?.offset || 0);

      const params = [tenantId];
      const filters = ["tenant_id=$1"];
      if (serviceObjectType) {
        params.push(serviceObjectType);
        filters.push(`service_object_type=$${params.length}`);
      }
      if (processDefId) {
        params.push(processDefId);
        filters.push(`process_def_id=$${params.length}`);
      }
      if (isActive !== null) {
        params.push(isActive.toLowerCase() === "true");
        filters.push(`is_active=$${params.length}`);
      }

      params.push(limit);
      params.push(offset);

      const r = await app.db.query(
        `
        SELECT id, service_object_type, process_def_id, task_type, is_active, priority, attrs,
               created_at, updated_at
        FROM eip_core.process_binding
        WHERE ${filters.join(" AND ")}
        ORDER BY priority ASC, created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );
      return reply.send({ ok: true, items: r.rows, limit, offset });
    }
  );

  app.post(
    "/process/bindings",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["service_object_type", "process_def_id"],
          properties: {
            service_object_type: { type: "string", maxLength: 64 },
            process_def_id: { type: "string", minLength: 36, maxLength: 36 },
            task_type: { type: "string", maxLength: 100 },
            is_active: { type: "boolean" },
            priority: { type: "integer", minimum: 0, maximum: 10000 },
            attrs: { type: "object" },
            tenant_id: { type: "string", minLength: 36, maxLength: 36 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_WRITE);
      if (!session) return;

      const scope = await resolveTenantScope(app, session, req.body?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const body = req.body || {};
      const attrs = body.attrs && typeof body.attrs === "object" ? body.attrs : {};

      const r = await app.db.query(
        `
        INSERT INTO eip_core.process_binding
          (tenant_id, service_object_type, process_def_id, task_type, is_active, priority, attrs)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7::jsonb)
        RETURNING id, service_object_type, process_def_id, task_type, is_active, priority, attrs,
                  created_at, updated_at
        `,
        [
          scope.tenantId,
          normalizeText(body.service_object_type),
          normalizeText(body.process_def_id),
          normalizeOptionalText(body.task_type),
          body.is_active !== false,
          Number.isFinite(body.priority) ? body.priority : 100,
          JSON.stringify(attrs)
        ]
      );
      return reply.send({ ok: true, item: r.rows[0] });
    }
  );

  app.patch(
    "/process/bindings/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            service_object_type: { type: "string", maxLength: 64 },
            process_def_id: { type: "string", minLength: 36, maxLength: 36 },
            task_type: { type: "string", maxLength: 100 },
            is_active: { type: "boolean" },
            priority: { type: "integer", minimum: 0, maximum: 10000 },
            attrs: { type: "object" },
            tenant_id: { type: "string", minLength: 36, maxLength: 36 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requirePerm(app, req, reply, DEF_WRITE);
      if (!session) return;

      const scope = await resolveTenantScope(
        app,
        session,
        req.body?.tenant_id || req.query?.tenant_id
      );
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const body = req.body || {};
      const attrs = body.attrs && typeof body.attrs === "object" ? body.attrs : null;

      const r = await app.db.query(
        `
        UPDATE eip_core.process_binding
        SET service_object_type = COALESCE($3, service_object_type),
            process_def_id = COALESCE($4, process_def_id),
            task_type = COALESCE($5, task_type),
            is_active = COALESCE($6, is_active),
            priority = COALESCE($7, priority),
            attrs = COALESCE(attrs,'{}'::jsonb) || COALESCE($8::jsonb, '{}'::jsonb),
            updated_at = now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING id, service_object_type, process_def_id, task_type, is_active, priority, attrs,
                  created_at, updated_at
        `,
        [
          scope.tenantId,
          req.params.id,
          normalizeOptionalText(body.service_object_type),
          normalizeOptionalText(body.process_def_id),
          normalizeOptionalText(body.task_type),
          body.is_active !== undefined ? body.is_active : null,
          Number.isFinite(body.priority) ? body.priority : null,
          attrs ? JSON.stringify(attrs) : null
        ]
      );
      if (r.rowCount === 0) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
      return reply.send({ ok: true, item: r.rows[0] });
    }
  );
}

export {
  ensureProcessSchema,
  requirePerm,
  resolveTenantScope,
};
