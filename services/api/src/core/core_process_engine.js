// services/api/src/core/core_process_engine.js
import { randomUUID } from "crypto";
import { sha256Hex } from "../auth/crypto.js";
import {
  executeProcessMacroReasoning,
  resolveCalculatedRef
} from "./reasoning/processMacroBridge.js";
import { patchServiceObjectAttrs } from "./serviceObjectJsonPatch.js";
import { patchObjectLinkAttrs } from "./objectLinkJsonPatch.js";

const TASK_STATUS_LIST_CODE = "TASK_STATUS";
const DEFAULT_SO_STATUS_LIST_CODE = "SERVICE_OBJECT_STATUS";
const PROCESS_EFFECT_TYPE_LIST_CODE = "PROCESS_EFFECT_TYPE";
const SERVICE_OBJECT_TYPE_LIST_CODE = "SERVICE_OBJECT_TYPE";
const DOCUMENT_CATEGORY_LIST_CODE = "DOCUMENT_CATEGORY";
const DOCUMENT_HEADER_KEY_LIST_CODE = "DOCUMENT_HEADER_KEY";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOptionalText(value) {
  const trimmed = normalizeText(value);
  return trimmed.length ? trimmed : null;
}

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

const EFFECT_HANDLER_REGISTRY = {
  SERVICE_OBJECT_CREATE: "serviceObjectCreate",
  SERVICE_OBJECT_PATCH: "serviceObjectPatch",
  SERVICE_OBJECT_STATE_TRANSITION: "serviceObjectStateTransition",
  TASK_CREATE: "taskCreate",
  TASK_PATCH: "taskPatch",
  TASK_STATE_TRANSITION: "taskStateTransition",
  LINK_CREATE: "linkCreate",
  LINK_PATCH: "linkPatch",
  LINK_REMOVE: "linkRemove",
  INFO_RECORD_CREATE: "infoRecordCreate",
  PROCESS_START: "processStart",
  ACCESS_GRANT_CREATE: "accessGrantCreate",
  ACCESS_GRANT_PATCH: "accessGrantPatch",

  // Temporary generic compatibility executable identities. These are not public
  // primitive authority; governed metadata marks them hidden/deprecated.
  CHILD_SERVICE_OBJECT_CREATE: "serviceObjectCreateLegacy",
  STATUS_SET: "stateTransitionLegacy",
  SO_UPDATE: "serviceObjectPatchLegacy",
  TASK_UPDATE: "taskPatchLegacy",
  INFO_RECORD_WRITE: "infoRecordCreateLegacy",
  ACCESS_GRANT_UPDATE: "accessGrantPatchLegacy",
  INSTANCE_START: "processStartLegacy"
};

function normalizeEffectCode(value) {
  const raw = normalizeOptionalText(value);
  if (!raw) return null;
  return raw.toUpperCase();
}

function readEffectGovernanceAttrs(attrs) {
  return attrs && typeof attrs === "object" ? attrs : {};
}

function resolveCanonicalEffectCode(attrs, fallbackCode) {
  const canonical = normalizeEffectCode(
    attrs?.canonical_effect_code ||
      attrs?.canonicalEffectCode ||
      attrs?.alias_of ||
      attrs?.aliasOf
  );
  return canonical || fallbackCode;
}

async function loadEffectGovernanceMap(client, tenantId) {
  const result = await client.query(
    `
    SELECT DISTINCT ON (dv.code)
      dv.code,
      dv.is_active,
      dv.attrs
    FROM eip_core.dropdown_list dl
    JOIN eip_core.dropdown_value dv
      ON dv.list_id = dl.id
    WHERE dl.code = $1
      AND dl.is_active = true
      AND (dl.tenant_id = $2 OR dl.tenant_id IS NULL)
    ORDER BY
      dv.code,
      (dl.tenant_id IS NOT NULL) DESC,
      dl.version DESC,
      dv.updated_at DESC
    `,
    [PROCESS_EFFECT_TYPE_LIST_CODE, tenantId]
  );

  const map = {};
  for (const row of result.rows || []) {
    const code = normalizeEffectCode(row.code);
    if (!code) continue;
    const attrs = readEffectGovernanceAttrs(row.attrs);
    map[code] = {
      code,
      is_active: row.is_active === true,
      attrs,
      canonical_effect_code: resolveCanonicalEffectCode(attrs, code),
      deprecated: attrs.deprecated === true
    };
  }
  return map;
}

function resolveGovernedEffectType(effectGovernanceMap, rawType) {
  const requestedCode = normalizeEffectCode(rawType);
  if (!requestedCode) {
    return { ok: false, error: "EFFECT_TYPE_REQUIRED" };
  }

  const requested = effectGovernanceMap[requestedCode];
  if (!requested || requested.is_active !== true) {
    return { ok: false, error: "EFFECT_TYPE_NOT_GOVERNED", requested_code: requestedCode };
  }

  const canonicalCode = requested.canonical_effect_code || requestedCode;
  const canonical = effectGovernanceMap[canonicalCode];
  if (!canonical || canonical.is_active !== true) {
    return {
      ok: false,
      error: "EFFECT_CANONICAL_NOT_GOVERNED",
      requested_code: requestedCode,
      canonical_code: canonicalCode
    };
  }

  return {
    ok: true,
    requested_code: requestedCode,
    effect_code: canonicalCode,
    deprecated_alias: requestedCode !== canonicalCode || requested.deprecated === true
  };
}

const COMMON_EFFECT_CONTRACT_FIELDS = new Set([
  "type",
  "effect_instance",
  "service_object_type",
  "service_object_category",
  "object_type",
  "object_category"
]);

function validateGovernedEffectRuntimeContract(effectGovernanceMap, resolvedEffect, effect) {
  // Legacy compatibility aliases keep their historical contract until migrated.
  // Canonical public Effect identities fail closed on unsupported parameters.
  if (resolvedEffect.requested_code !== resolvedEffect.effect_code) return;
  const governance = effectGovernanceMap[resolvedEffect.effect_code];
  const attrs = governance?.attrs && typeof governance.attrs === "object" ? governance.attrs : {};
  const allowedFields = Array.isArray(attrs.allowed_fields) ? attrs.allowed_fields : null;
  if (!allowedFields || allowedFields.length === 0) return;
  const allowed = new Set(allowedFields.map((field) => String(field)));
  for (const key of Object.keys(effect || {})) {
    if (COMMON_EFFECT_CONTRACT_FIELDS.has(key) || allowed.has(key)) continue;
    throw new Error("EFFECT_FIELD_UNSUPPORTED:" + resolvedEffect.effect_code + ":" + key);
  }
}

function getPayloadPath(payload, path) {
  if (!payload || !path) return null;
  return String(path)
    .split(".")
    .reduce((acc, key) => (acc ? acc[key] : undefined), payload);
}

function buildNodeMap(graph) {
  const nodes = graph && typeof graph === "object" ? graph.nodes : null;
  if (!nodes) return {};
  if (Array.isArray(nodes)) {
    const map = {};
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const id = normalizeOptionalText(node.id || node.key || node.name);
      if (id) map[id] = node;
    }
    return map;
  }
  return nodes && typeof nodes === "object" ? nodes : {};
}

function buildMacroMap(graph) {
  const macros = graph && typeof graph === "object" ? graph.macros : null;
  if (!macros) return {};

  if (Array.isArray(macros)) {
    const map = {};
    for (const macro of macros) {
      if (!macro || typeof macro !== "object") continue;
      const code = normalizeOptionalText(macro.code || macro.id || macro.key || macro.name);
      if (!code) continue;
      map[code] = { ...macro, code };
    }
    return map;
  }

  if (typeof macros === "object") {
    const map = {};
    for (const [key, macro] of Object.entries(macros)) {
      if (!macro || typeof macro !== "object") continue;
      const code = normalizeOptionalText(macro.code || key);
      if (!code) continue;
      map[code] = { ...macro, code };
    }
    return map;
  }

  return {};
}

function resolveTransitionMacro(graph, transition) {
  const macroCode = normalizeOptionalText(transition?.macro_code || transition?.macroCode);
  if (!macroCode) {
    return { ok: false, error: "MACRO_CODE_REQUIRED" };
  }

  const macroMap = buildMacroMap(graph);
  const macro = macroMap[macroCode];
  if (!macro) {
    return { ok: false, error: "MACRO_NOT_FOUND", macro_code: macroCode };
  }
  const effects = Array.isArray(macro.effects) ? macro.effects : [];
  if (effects.length === 0) {
    return { ok: false, error: "MACRO_EFFECTS_REQUIRED", macro_code: macroCode };
  }
  return {
    ok: true,
    macro_code: macroCode,
    macro_source: "graph_registry",
    macro,
    effects
  };
}

function ensureHistory(cursor, initialNode) {
  const base = cursor && typeof cursor === "object" ? cursor : {};
  if (!Array.isArray(base.history)) base.history = [];
  if (!base.node && initialNode) base.node = initialNode;
  return base;
}

function findHistoryByKey(cursor, idempotencyKey) {
  if (!cursor || !Array.isArray(cursor.history)) return null;
  return cursor.history.find((entry) => entry.idempotency_key === idempotencyKey) || null;
}

function resolveGraphObjectType(graph, attrs) {
  const graphType = graph && typeof graph === "object" ? graph.object_type : null;
  const attrType = attrs && typeof attrs === "object" ? attrs.object_type : null;
  return graphType || attrType || null;
}

function resolveRef(value, ctx, payload) {
  if (value === "$service_object_id") return ctx.serviceObjectId;
  if (value === "$process_instance_id") return ctx.instanceId;
  if (value === "$created_last") {
    return ctx.createdServiceObjects?.[ctx.createdServiceObjects.length - 1] || null;
  }
  if (typeof value === "string") {
    if (value === "$calc" || value.startsWith("$calc.")) {
      return resolveCalculatedRef(value, ctx.calc || {});
    }
    const payloadMatch = value.match(/^\$payload\.(.+)$/);
    if (payloadMatch) return getPayloadPath(payload, payloadMatch[1]);
    const match = value.match(/^\$created\.(.+)$/);
    if (match) return ctx.createdByKey?.[match[1]] || null;
  }
  return value;
}

function buildIdempotencyDigest(input) {
  return sha256Hex(JSON.stringify(input || {}));
}

async function getPrimaryAgentId(client, tenantId, identityId) {
  try {
    const r = await client.query(
      `
      SELECT agent_id
      FROM eip_auth.auth_identity_agent
      WHERE tenant_id=$1
        AND identity_id=$2
        AND is_primary=true
        AND is_active=true
      LIMIT 1
      `,
      [tenantId, identityId]
    );
    return r.rows[0]?.agent_id ?? null;
  } catch (error) {
    if (error?.code === "42P01") {
      return null;
    }
    throw error;
  }
}

async function resolveDropdownListId(client, tenantId, listCode) {
  const r = await client.query(
    `
    SELECT id
    FROM eip_core.dropdown_list
    WHERE code=$1
      AND is_active=true
      AND (tenant_id=$2 OR tenant_id IS NULL)
    ORDER BY (tenant_id IS NOT NULL) DESC, version DESC
    LIMIT 1
    `,
    [listCode, tenantId]
  );
  return r.rows[0]?.id ?? null;
}

async function resolveDropdownCodeRow(client, tenantId, listCode, code) {
  const listId = await resolveDropdownListId(client, tenantId, listCode);
  if (!listId) {
    return { list_exists: false, value: null };
  }

  const r = await client.query(
    `
    SELECT code, attrs
    FROM eip_core.dropdown_value
    WHERE list_id=$1
      AND lower(code)=lower($2)
      AND is_active=true
    LIMIT 1
    `,
    [listId, code]
  );
  return { list_exists: true, value: r.rows[0] || null };
}

async function loadDropdownCodeSet(client, tenantId, listCode) {
  const listId = await resolveDropdownListId(client, tenantId, listCode);
  if (!listId) {
    return { governed: false, codes: new Set() };
  }

  const r = await client.query(
    `
    SELECT code
    FROM eip_core.dropdown_value
    WHERE list_id=$1
      AND is_active=true
    `,
    [listId]
  );

  return {
    governed: true,
    codes: new Set((r.rows || []).map((row) => normalizeEffectCode(row.code)))
  };
}

async function validateServiceObjectTypeGovernance(client, tenantId, objectType) {
  const governed = await resolveDropdownCodeRow(
    client,
    tenantId,
    SERVICE_OBJECT_TYPE_LIST_CODE,
    objectType
  );
  if (!governed.list_exists) {
    return { ok: true, governed: false, attrs: {} };
  }
  if (!governed.value) {
    return { ok: false, error: "SERVICE_OBJECT_TYPE_INVALID" };
  }
  return {
    ok: true,
    governed: true,
    attrs: governed.value.attrs && typeof governed.value.attrs === "object" ? governed.value.attrs : {}
  };
}

async function validateDocumentAttrsGovernance(client, tenantId, objectTypeAttrs, attrs) {
  const businessClass = normalizeOptionalText(
    objectTypeAttrs?.business_class || objectTypeAttrs?.businessClass
  );
  if (!businessClass || businessClass.toLowerCase() !== "document") {
    return { ok: true };
  }

  const documentCategory = normalizeOptionalText(
    attrs?.document_category || attrs?.documentCategory || attrs?.category
  );
  if (documentCategory) {
    const categorySet = await loadDropdownCodeSet(client, tenantId, DOCUMENT_CATEGORY_LIST_CODE);
    if (categorySet.governed && !categorySet.codes.has(normalizeEffectCode(documentCategory))) {
      return { ok: false, error: `DOCUMENT_CATEGORY_INVALID:${documentCategory}` };
    }
  }

  const headers =
    attrs?.document_headers && typeof attrs.document_headers === "object" && !Array.isArray(attrs.document_headers)
      ? attrs.document_headers
      : attrs?.documentHeaders &&
          typeof attrs.documentHeaders === "object" &&
          !Array.isArray(attrs.documentHeaders)
        ? attrs.documentHeaders
        : attrs?.headers && typeof attrs.headers === "object" && !Array.isArray(attrs.headers)
          ? attrs.headers
          : null;

  if (headers) {
    const headerSet = await loadDropdownCodeSet(client, tenantId, DOCUMENT_HEADER_KEY_LIST_CODE);
    if (headerSet.governed) {
      for (const key of Object.keys(headers)) {
        if (!headerSet.codes.has(normalizeEffectCode(key))) {
          return { ok: false, error: `DOCUMENT_HEADER_KEY_INVALID:${key}` };
        }
      }
    }
  }

  return { ok: true };
}

async function resolveMaterialId(client, tenantId, value) {
  const raw = normalizeOptionalText(value);
  if (!raw) return null;
  if (looksLikeUuid(raw)) return raw;

  const r = await client.query(
    `
    SELECT id
    FROM eip_core.material
    WHERE tenant_id=$1 AND code=$2
    LIMIT 1
    `,
    [tenantId, raw]
  );
  return r.rows[0]?.id ?? null;
}

async function insertInfoRecord(client, ctx, input) {
  const recordType = normalizeOptionalText(input?.record_type);
  if (!recordType) throw new Error("INFO_RECORD_TYPE_REQUIRED");

  const payloadValue = input?.payload && typeof input.payload === "object" ? input.payload : {};
  const attrsValue = input?.attrs && typeof input.attrs === "object" ? input.attrs : {};

  const infoRes = await client.query(
    `
    INSERT INTO eip_core.info_record
      (tenant_id, record_type, title, description, payload, attrs, created_by_agent_id)
    VALUES
      ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
    RETURNING id
    `,
    [
      ctx.tenantId,
      recordType,
      normalizeOptionalText(input?.title),
      normalizeOptionalText(input?.description),
      JSON.stringify(payloadValue || {}),
      JSON.stringify(attrsValue || {}),
      ctx.actorAgentId
    ]
  );

  const recordId = infoRes.rows[0]?.id || null;
  const links = Array.isArray(input?.links) ? input.links : [];
  for (const link of links) {
    const srcKind = normalizeOptionalText(link?.src_kind);
    const dstKind = normalizeOptionalText(link?.dst_kind);
    const relationType = normalizeOptionalText(link?.relation_type);
    const srcId = normalizeOptionalText(link?.src_id);
    const dstId = normalizeOptionalText(link?.dst_id) || recordId;

    if (!srcKind || !dstKind || !relationType || !srcId || !dstId) continue;

    await client.query(
      `
      INSERT INTO eip_core.object_link
        (tenant_id, src_kind, src_id, dst_kind, dst_id, relation_type, attrs)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7::jsonb)
      ON CONFLICT DO NOTHING
      `,
      [ctx.tenantId, srcKind, srcId, dstKind, dstId, relationType, JSON.stringify(link?.attrs || {})]
    );
  }

  return recordId;
}

async function validateStatus(client, tenantId, listCode, statusCode) {
  const listId = await resolveDropdownListId(client, tenantId, listCode);
  if (!listId) return { ok: false, error: "STATUS_LIST_MISSING" };

  const r = await client.query(
    `
    SELECT 1
    FROM eip_core.dropdown_value
    WHERE list_id=$1 AND code=$2 AND is_active=true
    LIMIT 1
    `,
    [listId, statusCode]
  );
  if (r.rowCount === 0) return { ok: false, error: "INVALID_STATUS" };
  return { ok: true };
}

async function resolveAgentId(client, tenantId, spec) {
  if (!spec) return null;
  if (typeof spec === "string") return normalizeOptionalText(spec);

  const id = normalizeOptionalText(spec.id);
  if (id) return id;

  const code = normalizeOptionalText(spec.code);
  if (code) {
    const byCode = await client.query(
      `
      SELECT id
      FROM eip_core.agent
      WHERE tenant_id=$1 AND code=$2
      LIMIT 1
      `,
      [tenantId, code]
    );
    if (byCode.rowCount > 0) return byCode.rows[0].id;
  }

  const agentType = normalizeOptionalText(spec.agent_type || spec.agentType);
  const attrs = spec.attrs && typeof spec.attrs === "object" ? spec.attrs : {};
  const email = normalizeOptionalText(attrs.email);

  if (agentType && email) {
    const byEmail = await client.query(
      `
      SELECT id
      FROM eip_core.agent
      WHERE tenant_id=$1
        AND agent_type=$2
        AND attrs->>'email' = $3
      LIMIT 1
      `,
      [tenantId, agentType, email]
    );
    if (byEmail.rowCount > 0) return byEmail.rows[0].id;
  }

  if (!agentType) return null;

  const name = normalizeOptionalText(spec.name);
  const insertRes = await client.query(
    `
    INSERT INTO eip_core.agent
      (tenant_id, agent_type, code, name, attrs)
    VALUES
      ($1,$2,$3,$4,$5::jsonb)
    RETURNING id
    `,
    [tenantId, agentType, code, name, JSON.stringify(attrs)]
  );
  return insertRes.rows[0]?.id || null;
}

async function insertTask(client, tenantId, task) {
  const r = await client.query(
    `
    INSERT INTO eip_core.task
      (tenant_id, service_object_id, process_def_id,
       task_type, status, title, description,
       assigned_agent_id, due_at, payload, attrs)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
    RETURNING id, status
    `,
    [
      tenantId,
      task.service_object_id,
      task.process_def_id || null,
      task.task_type,
      task.status || "open",
      task.title || null,
      task.description || null,
      task.assigned_agent_id || null,
      task.due_at || null,
      JSON.stringify(task.payload || {}),
      JSON.stringify(task.attrs || {})
    ]
  );
  return r.rows[0];
}

async function fetchTaskTemplateById(client, ctx, templateId) {
  const r = await client.query(
    `
    SELECT id, task_type, title, description, attrs
    FROM eip_core.task_template
    WHERE tenant_id=$1
      AND id=$2
      AND is_active=true
    LIMIT 1
    `,
    [ctx.tenantId, templateId]
  );
  return r.rows[0] || null;
}

async function fetchTaskTemplateByType(client, ctx, taskType) {
  const r = await client.query(
    `
    SELECT id, task_type, title, description, attrs
    FROM eip_core.task_template
    WHERE tenant_id=$1
      AND process_def_id=$2
      AND task_type=$3
      AND is_active=true
      AND (service_object_type=$4 OR service_object_type IS NULL)
    ORDER BY (service_object_type IS NOT NULL) DESC, sort_order ASC
    LIMIT 1
    `,
    [ctx.tenantId, ctx.processDefId, taskType, ctx.serviceObject?.object_type || ""]
  );
  return r.rows[0] || null;
}

function buildTemplateFromRow(row) {
  if (!row) return null;
  return {
    task_type: row.task_type,
    title: row.title,
    description: row.description,
    attrs: row.attrs || {}
  };
}

async function applyTaskTemplates(client, ctx, templates) {
  if (!Array.isArray(templates)) return [];

  const tasks = [];
  for (const template of templates) {
    if (!template) continue;

    let resolved = null;
    if (typeof template === "string") {
      const row = await fetchTaskTemplateByType(client, ctx, normalizeText(template));
      if (!row) throw new Error("TASK_TEMPLATE_NOT_FOUND");
      resolved = buildTemplateFromRow(row);
    } else if (typeof template === "object") {
      const templateId = normalizeOptionalText(template?.task_template_id || template?.template_id);
      const templateType = normalizeOptionalText(template?.task_type || template?.taskType);
      if (templateId) {
        const row = await fetchTaskTemplateById(client, ctx, templateId);
        if (!row) throw new Error("TASK_TEMPLATE_NOT_FOUND");
        resolved = buildTemplateFromRow(row);
      } else if (templateType && (template.title || template.description || template.payload || template.attrs)) {
        resolved = template;
      } else if (templateType) {
        const row = await fetchTaskTemplateByType(client, ctx, templateType);
        if (!row) throw new Error("TASK_TEMPLATE_NOT_FOUND");
        resolved = buildTemplateFromRow(row);
      }
    }

    if (!resolved) continue;
    const taskType = normalizeOptionalText(resolved?.task_type || resolved?.taskType);
    if (!taskType) continue;

    let assignedAgentId = null;
    const templateAttrs = resolved?.attrs && typeof resolved.attrs === "object" ? resolved.attrs : {};
    const assignRule = normalizeOptionalText(resolved?.assign || templateAttrs.assign);
    if (assignRule === "owner") assignedAgentId = ctx.serviceObject?.owner_agent_id || null;
    if (assignRule === "actor") assignedAgentId = ctx.actorAgentId || null;
    if (resolved?.assigned_agent_id) assignedAgentId = resolved.assigned_agent_id;

    let dueAt = null;
    const dueInDays = Number.isFinite(resolved?.due_in_days)
      ? Number(resolved.due_in_days)
      : Number.isFinite(templateAttrs?.due_in_days)
        ? Number(templateAttrs.due_in_days)
        : null;
    if (Number.isFinite(dueInDays)) {
      dueAt = new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000).toISOString();
    }

    const taskRow = await insertTask(client, ctx.tenantId, {
      service_object_id: ctx.serviceObjectId,
      process_def_id: ctx.processDefId,
      task_type: taskType,
      status: "open",
      title: normalizeOptionalText(resolved?.title),
      description: normalizeOptionalText(resolved?.description),
      assigned_agent_id: assignedAgentId,
      due_at: dueAt,
      payload: resolved?.payload || templateAttrs?.payload || {},
      attrs: resolved?.attrs || {}
    });

    tasks.push({ id: taskRow.id, status: taskRow.status, task_type: taskType });
  }
  return tasks;
}

function resolveDynamicValue(value, ctx, payload) {
  if (typeof value === "string") {
    return resolveRef(value, ctx, payload);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveDynamicValue(item, ctx, payload));
  }
  if (value && typeof value === "object") {
    const resolved = {};
    for (const [key, val] of Object.entries(value)) {
      resolved[key] = resolveDynamicValue(val, ctx, payload);
    }
    return resolved;
  }
  return value;
}

async function applyEffects(client, ctx, effects, payload) {
  if (!ctx.effectGovernanceMap) {
    ctx.effectGovernanceMap = await loadEffectGovernanceMap(client, ctx.tenantId);
  }
  const effectGovernanceMap = ctx.effectGovernanceMap;

  const applied = [];
  for (const effect of Array.isArray(effects) ? effects : []) {
    const resolvedEffect = resolveGovernedEffectType(effectGovernanceMap, effect?.type);
    if (!resolvedEffect.ok) {
      const debugCode = resolvedEffect.requested_code || "";
      throw new Error(debugCode ? `${resolvedEffect.error}:${debugCode}` : resolvedEffect.error);
    }
    const type = resolvedEffect.effect_code;
    if (!EFFECT_HANDLER_REGISTRY[type]) {
      throw new Error(`EFFECT_HANDLER_NOT_FOUND:${type}`);
    }
    validateGovernedEffectRuntimeContract(effectGovernanceMap, resolvedEffect, effect);

    if (type === "SERVICE_OBJECT_CREATE" || type === "CHILD_SERVICE_OBJECT_CREATE") {
      if (type === "SERVICE_OBJECT_CREATE") {
        if (Array.isArray(effect?.items)) throw new Error("SERVICE_OBJECT_CREATE_ITEMS_UNSUPPORTED");
        if (effect?.links || effect?.link) throw new Error("SERVICE_OBJECT_CREATE_LINKS_UNSUPPORTED");
      }
      const items = Array.isArray(effect?.items) ? effect.items : [effect];
      const created = [];

      for (const item of items) {
        const objectType = normalizeOptionalText(item?.object_type || item?.objectType);
        if (!objectType) throw new Error("SERVICE_OBJECT_TYPE_REQUIRED");

        const status = normalizeStatus(item?.status || "new");
        const listCode = normalizeOptionalText(item?.list_code) || DEFAULT_SO_STATUS_LIST_CODE;
        const valid = await validateStatus(client, ctx.tenantId, listCode, status);
        if (!valid.ok) throw new Error(valid.error);

        let ownerAgentId = null;
        const ownerRule = normalizeOptionalText(item?.owner);
        if (ownerRule === "actor") ownerAgentId = ctx.actorAgentId || null;
        if (ownerRule === "source_owner") ownerAgentId = ctx.serviceObject?.owner_agent_id || null;
        if (item?.owner_agent_id) ownerAgentId = item.owner_agent_id;

        const attrs = resolveDynamicValue(item?.attrs && typeof item.attrs === "object" ? item.attrs : {}, ctx, payload);
        const title = normalizeOptionalText(resolveDynamicValue(item?.title, ctx, payload));

        const soRes = await client.query(
          `
          INSERT INTO eip_core.service_object
            (tenant_id, object_type, status, title, attrs, owner_agent_id)
          VALUES
            ($1,$2,$3,$4,$5::jsonb,$6)
          RETURNING id, object_type, status, title, owner_agent_id
          `,
          [ctx.tenantId, objectType, status, title, JSON.stringify(attrs), ownerAgentId]
        );

        const createdId = soRes.rows[0].id;
        ctx.createdServiceObjects = ctx.createdServiceObjects || [];
        ctx.createdByKey = ctx.createdByKey || {};
        ctx.createdServiceObjects.push(createdId);

        const label = normalizeOptionalText(item?.as || item?.key);
        if (label) ctx.createdByKey[label] = createdId;

        const linkDefs = Array.isArray(item?.links)
          ? item.links
          : item?.link
            ? [item.link]
            : [];

        for (const link of linkDefs) {
          const srcKind = normalizeOptionalText(link?.src_kind);
          const dstKind = normalizeOptionalText(link?.dst_kind);
          const relationType = normalizeOptionalText(link?.relation_type);
          const srcId = resolveRef(link?.src_id, ctx, payload);
          const dstId = resolveRef(link?.dst_id, ctx, payload);

          if (!srcKind || !dstKind || !relationType || !srcId || !dstId) {
            throw new Error("LINK_FIELDS_REQUIRED");
          }

          await client.query(
            `
            INSERT INTO eip_core.object_link
              (tenant_id, src_kind, src_id, dst_kind, dst_id, relation_type, attrs)
            VALUES
              ($1,$2,$3,$4,$5,$6,$7::jsonb)
            ON CONFLICT DO NOTHING
            `,
            [ctx.tenantId, srcKind, srcId, dstKind, dstId, relationType, JSON.stringify(link?.attrs || {})]
          );
        }

        created.push({
          id: createdId,
          object_type: soRes.rows[0].object_type,
          status: soRes.rows[0].status
        });
      }

      applied.push({ type, created });
      continue;
    }

    if (
      type === "SERVICE_OBJECT_STATE_TRANSITION" ||
      type === "TASK_STATE_TRANSITION" ||
      type === "STATUS_SET"
    ) {
      const target =
        type === "TASK_STATE_TRANSITION"
          ? "task"
          : type === "SERVICE_OBJECT_STATE_TRANSITION"
            ? "service_object"
            : normalizeOptionalText(effect?.target) || (effect?.task_id ? "task" : "service_object");
      const toStatus = normalizeStatus(resolveDynamicValue(effect?.to, ctx, payload));
      if (!toStatus) throw new Error("STATUS_REQUIRED");

      if (target === "task") {
        const taskId = normalizeOptionalText(resolveDynamicValue(effect?.task_id, ctx, payload));
        if (!taskId) throw new Error("TASK_ID_REQUIRED");

        const valid = await validateStatus(client, ctx.tenantId, TASK_STATUS_LIST_CODE, toStatus);
        if (!valid.ok) throw new Error(valid.error);

        const taskRes = await client.query(
          `
          SELECT status
          FROM eip_core.task
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE
          `,
          [ctx.tenantId, taskId]
        );
        if (taskRes.rowCount === 0) throw new Error("TASK_NOT_FOUND");

        await client.query(
          `
          UPDATE eip_core.task
          SET status=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          `,
          [ctx.tenantId, taskId, toStatus]
        );

        await client.query(
          `
          INSERT INTO eip_core.task_status_event
            (tenant_id, task_id, from_status, to_status, reason_code, note, actor_agent_id, attrs)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb)
          `,
          [
            ctx.tenantId,
            taskId,
            taskRes.rows[0].status,
            toStatus,
            normalizeOptionalText(resolveDynamicValue(effect?.reason_code, ctx, payload)) ||
              normalizeOptionalText(payload?.reason_code),
            normalizeOptionalText(resolveDynamicValue(effect?.note, ctx, payload)) ||
              normalizeOptionalText(payload?.note),
            ctx.actorAgentId
          ]
        );

        applied.push({ type, target: "task", task_id: taskId, to_status: toStatus });
        continue;
      }

      const listCode = normalizeOptionalText(effect?.list_code) || DEFAULT_SO_STATUS_LIST_CODE;
      const valid = await validateStatus(client, ctx.tenantId, listCode, toStatus);
      if (!valid.ok) throw new Error(valid.error);

      const serviceObjectId = resolveRef(effect?.service_object_id, ctx, payload) || ctx.serviceObjectId;

      const soRes = await client.query(
        `
        SELECT status
        FROM eip_core.service_object
        WHERE tenant_id=$1 AND id=$2
        FOR UPDATE
        `,
        [ctx.tenantId, serviceObjectId]
      );
      if (soRes.rowCount === 0) throw new Error("SERVICE_OBJECT_NOT_FOUND");

      await client.query(
        `
        UPDATE eip_core.service_object
        SET status=$3, updated_at=now()
        WHERE tenant_id=$1 AND id=$2
        `,
        [ctx.tenantId, serviceObjectId, toStatus]
      );

      await client.query(
        `
        INSERT INTO eip_core.service_object_status_event
          (tenant_id, service_object_id, from_status, to_status, reason_code, note, actor_agent_id, attrs)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb)
        `,
        [
          ctx.tenantId,
          serviceObjectId,
          soRes.rows[0].status,
          toStatus,
          normalizeOptionalText(resolveDynamicValue(effect?.reason_code, ctx, payload)) ||
            normalizeOptionalText(payload?.reason_code),
          normalizeOptionalText(resolveDynamicValue(effect?.note, ctx, payload)) ||
            normalizeOptionalText(payload?.note),
          ctx.actorAgentId
        ]
      );

      applied.push({ type, target: "service_object", to_status: toStatus });
      continue;
    }

    if (type === "SERVICE_OBJECT_PATCH" || type === "SO_UPDATE") {
      const canonicalRequest = resolvedEffect.requested_code === "SERVICE_OBJECT_PATCH";
      const serviceObjectId =
        normalizeOptionalText(resolveDynamicValue(effect?.service_object_id, ctx, payload)) ||
        ctx.serviceObjectId;

      const hasCode = Object.prototype.hasOwnProperty.call(effect || {}, "code");
      const hasTitle = Object.prototype.hasOwnProperty.call(effect || {}, "title");
      const hasOwnerAgentId = Object.prototype.hasOwnProperty.call(effect || {}, "owner_agent_id");
      const codeValue = hasCode
        ? normalizeOptionalText(resolveDynamicValue(effect?.code, ctx, payload))
        : null;
      const titleValue = hasTitle
        ? normalizeOptionalText(resolveDynamicValue(effect?.title, ctx, payload))
        : null;
      const ownerAgentId = hasOwnerAgentId
        ? normalizeOptionalText(resolveDynamicValue(effect?.owner_agent_id, ctx, payload))
        : null;

      const attrsValue = resolveDynamicValue(effect?.attrs, ctx, payload);
      const attrs =
        attrsValue && typeof attrsValue === "object" && !Array.isArray(attrsValue)
          ? attrsValue
          : null;
      const patchesValue = resolveDynamicValue(effect?.patches, ctx, payload);
      const patches = Array.isArray(patchesValue) && patchesValue.length > 0 ? patchesValue : null;

      if (canonicalRequest && effect?.attrs !== undefined) {
        throw new Error("SERVICE_OBJECT_PATCH_ATTRS_MERGE_UNSUPPORTED");
      }
      if (canonicalRequest && !hasCode && !hasTitle && !hasOwnerAgentId && !patches) {
        throw new Error("SERVICE_OBJECT_PATCH_EMPTY");
      }
      if (!canonicalRequest && !hasCode && !hasTitle && !hasOwnerAgentId && !attrs && !patches) {
        throw new Error("SO_UPDATE_EMPTY");
      }

      if (hasOwnerAgentId && ownerAgentId) {
        const ownerRes = await client.query(
          `
          SELECT 1
          FROM eip_core.agent
          WHERE tenant_id=$1 AND id=$2 AND is_active=true
          LIMIT 1
          `,
          [ctx.tenantId, ownerAgentId]
        );
        if (ownerRes.rowCount === 0) throw new Error("OWNER_AGENT_NOT_FOUND");
      }

      const relationalMutation = hasCode || hasTitle || hasOwnerAgentId;
      const legacyAttrsMerge = !canonicalRequest && attrs !== null;
      if (relationalMutation || legacyAttrsMerge) {
        const result = await client.query(
          `
          UPDATE eip_core.service_object
          SET code = CASE WHEN $3::boolean THEN $4 ELSE code END,
              title = CASE WHEN $5::boolean THEN $6 ELSE title END,
              owner_agent_id = CASE WHEN $7::boolean THEN $8::uuid ELSE owner_agent_id END,
              attrs = CASE
                WHEN $9::boolean THEN COALESCE(attrs,'{}'::jsonb) || $10::jsonb
                ELSE attrs
              END,
              updated_at = now()
          WHERE tenant_id=$1 AND id=$2
          `,
          [
            ctx.tenantId,
            serviceObjectId,
            hasCode,
            codeValue,
            hasTitle,
            titleValue,
            hasOwnerAgentId,
            ownerAgentId,
            legacyAttrsMerge,
            legacyAttrsMerge ? JSON.stringify(attrs) : null
          ]
        );
        if (result.rowCount === 0) throw new Error("SERVICE_OBJECT_NOT_FOUND");
      }

      let patchResult = null;
      if (patches) {
        patchResult = await patchServiceObjectAttrs(client, {
          tenantId: ctx.tenantId,
          serviceObjectId,
          patches
        });
      }

      applied.push({
        type,
        service_object_id: serviceObjectId,
        relational_fields: [
          ...(hasCode ? ["code"] : []),
          ...(hasTitle ? ["title"] : []),
          ...(hasOwnerAgentId ? ["owner_agent_id"] : [])
        ],
        patch_count: patchResult?.patch_count || 0
      });
      continue;
    }

    if (type === "TASK_CREATE") {
      const taskType = normalizeOptionalText(
        resolveDynamicValue(effect?.task_type, ctx, payload)
      );
      if (!taskType) throw new Error("TASK_TYPE_REQUIRED");

      let assignedAgentId = null;
      const assignRule = normalizeOptionalText(effect?.assign);
      if (assignRule === "owner") assignedAgentId = ctx.serviceObject?.owner_agent_id || null;
      if (assignRule === "actor") assignedAgentId = ctx.actorAgentId || null;
      if (effect?.assigned_agent_id) {
        assignedAgentId = resolveDynamicValue(effect.assigned_agent_id, ctx, payload);
      }

      const dueAt = normalizeOptionalText(resolveDynamicValue(effect?.due_at, ctx, payload));

      const taskPayload = resolveDynamicValue(effect?.payload || {}, ctx, payload);
      const taskAttrs = resolveDynamicValue(effect?.attrs || {}, ctx, payload);

      const taskRow = await insertTask(client, ctx.tenantId, {
        service_object_id: ctx.serviceObjectId,
        process_def_id: ctx.processDefId,
        task_type: taskType,
        status: "open",
        title: normalizeOptionalText(resolveDynamicValue(effect?.title, ctx, payload)),
        description: normalizeOptionalText(resolveDynamicValue(effect?.description, ctx, payload)),
        assigned_agent_id: assignedAgentId,
        due_at: dueAt,
        payload: taskPayload,
        attrs: taskAttrs
      });

      applied.push({ type, task_id: taskRow.id, task_type: taskType });
      continue;
    }

    if (type === "TASK_PATCH" || type === "TASK_STATE_TRANSITION" || type === "TASK_UPDATE") {
      if (type === "TASK_PATCH" && (effect?.to !== undefined || effect?.status !== undefined)) {
        throw new Error("TASK_PATCH_STATE_UNSUPPORTED");
      }
      if (type === "TASK_STATE_TRANSITION") {
        for (const field of ["title", "description", "assigned_agent_id", "due_at", "payload", "attrs"]) {
          if (effect?.[field] !== undefined) throw new Error("TASK_STATE_TRANSITION_FIELD_UNSUPPORTED:" + field);
        }
      }
      const taskId = normalizeOptionalText(
        resolveDynamicValue(effect?.task_id, ctx, payload)
      );
      if (!taskId) throw new Error("TASK_ID_REQUIRED");

      const toStatusRaw = resolveDynamicValue(effect?.to ?? effect?.status, ctx, payload);
      const toStatus = toStatusRaw ? normalizeStatus(toStatusRaw) : null;
      if (type === "TASK_STATE_TRANSITION" && !toStatus) throw new Error("TASK_STATE_REQUIRED");
      if (toStatus) {
        const valid = await validateStatus(client, ctx.tenantId, TASK_STATUS_LIST_CODE, toStatus);
        if (!valid.ok) throw new Error(valid.error);
      }

      const taskRes = await client.query(
        `
        SELECT status
        FROM eip_core.task
        WHERE tenant_id=$1 AND id=$2
        FOR UPDATE
        `,
        [ctx.tenantId, taskId]
      );
      if (taskRes.rowCount === 0) throw new Error("TASK_NOT_FOUND");

      const title = normalizeOptionalText(resolveDynamicValue(effect?.title, ctx, payload));
      const description = normalizeOptionalText(resolveDynamicValue(effect?.description, ctx, payload));
      const assignedAgentId = normalizeOptionalText(resolveDynamicValue(effect?.assigned_agent_id, ctx, payload));
      const dueAt = normalizeOptionalText(resolveDynamicValue(effect?.due_at, ctx, payload));
      const payloadValue = resolveDynamicValue(effect?.payload, ctx, payload);
      const attrsValue = resolveDynamicValue(effect?.attrs, ctx, payload);
      const payloadObject =
        payloadValue && typeof payloadValue === "object" && !Array.isArray(payloadValue)
          ? payloadValue
          : null;
      const attrsObject =
        attrsValue && typeof attrsValue === "object" && !Array.isArray(attrsValue)
          ? attrsValue
          : null;

      await client.query(
        `
        UPDATE eip_core.task
        SET status = COALESCE($3, status),
            title = COALESCE($4, title),
            description = COALESCE($5, description),
            assigned_agent_id = COALESCE($6, assigned_agent_id),
            due_at = COALESCE($7, due_at),
            payload = COALESCE(payload,'{}'::jsonb) || COALESCE($8::jsonb, '{}'::jsonb),
            attrs = COALESCE(attrs,'{}'::jsonb) || COALESCE($9::jsonb, '{}'::jsonb),
            updated_at=now()
        WHERE tenant_id=$1 AND id=$2
        `,
        [
          ctx.tenantId,
          taskId,
          toStatus,
          title,
          description,
          assignedAgentId,
          dueAt,
          payloadObject ? JSON.stringify(payloadObject) : null,
          attrsObject ? JSON.stringify(attrsObject) : null
        ]
      );

      if (toStatus) {
        await client.query(
          `
          INSERT INTO eip_core.task_status_event
            (tenant_id, task_id, from_status, to_status, reason_code, note, actor_agent_id, attrs)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb)
          `,
          [
            ctx.tenantId,
            taskId,
            taskRes.rows[0].status,
            toStatus,
            normalizeOptionalText(resolveDynamicValue(effect?.reason_code, ctx, payload)) ||
              normalizeOptionalText(payload?.reason_code),
            normalizeOptionalText(resolveDynamicValue(effect?.note, ctx, payload)) ||
              normalizeOptionalText(payload?.note),
            ctx.actorAgentId
          ]
        );
      }

      applied.push({ type, task_id: taskId, to_status: toStatus || taskRes.rows[0].status });
      continue;
    }

    if (type === "LINK_CREATE") {
      const srcKind = normalizeOptionalText(effect?.src_kind);
      const dstKind = normalizeOptionalText(effect?.dst_kind);
      const relationType = normalizeOptionalText(effect?.relation_type);
      const srcId = resolveRef(effect?.src_id, ctx, payload);
      const dstId = resolveRef(effect?.dst_id, ctx, payload);

      if (!srcKind || !dstKind || !relationType || !srcId || !dstId) {
        throw new Error("LINK_FIELDS_REQUIRED");
      }

      await client.query(
        `
        INSERT INTO eip_core.object_link
          (tenant_id, src_kind, src_id, dst_kind, dst_id, relation_type, attrs)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7::jsonb)
        ON CONFLICT DO NOTHING
        `,
        [
          ctx.tenantId,
          srcKind,
          srcId,
          dstKind,
          dstId,
          relationType,
          JSON.stringify(resolveDynamicValue(effect?.attrs || {}, ctx, payload))
        ]
      );

      applied.push({ type, relation_type: relationType });
      continue;
    }

    if (type === "LINK_PATCH") {
      const srcKind = normalizeOptionalText(resolveDynamicValue(effect?.src_kind, ctx, payload));
      const dstKind = normalizeOptionalText(resolveDynamicValue(effect?.dst_kind, ctx, payload));
      const relationType = normalizeOptionalText(resolveDynamicValue(effect?.relation_type, ctx, payload));
      const srcId = resolveRef(effect?.src_id, ctx, payload);
      const dstId = resolveRef(effect?.dst_id, ctx, payload);
      const patches = resolveDynamicValue(effect?.patches, ctx, payload);

      if (!srcKind || !dstKind || !relationType || !srcId || !dstId) {
        throw new Error("LINK_FIELDS_REQUIRED");
      }

      const patchResult = await patchObjectLinkAttrs(client, {
        tenantId: ctx.tenantId,
        srcKind,
        srcId,
        dstKind,
        dstId,
        relationType,
        patches
      });

      applied.push({ type, relation_type: relationType, patch_count: patchResult.patch_count });
      continue;
    }

    if (type === "LINK_REMOVE") {
      const srcKind = normalizeOptionalText(effect?.src_kind);
      const dstKind = normalizeOptionalText(effect?.dst_kind);
      const relationType = normalizeOptionalText(effect?.relation_type);
      const srcId = resolveRef(effect?.src_id, ctx, payload);
      const dstId = resolveRef(effect?.dst_id, ctx, payload);

      if (!srcKind || !dstKind || !relationType || !srcId || !dstId) {
        throw new Error("LINK_FIELDS_REQUIRED");
      }

      await client.query(
        `
        DELETE FROM eip_core.object_link
        WHERE tenant_id=$1
          AND src_kind=$2
          AND src_id=$3
          AND dst_kind=$4
          AND dst_id=$5
          AND relation_type=$6
        `,
        [ctx.tenantId, srcKind, srcId, dstKind, dstId, relationType]
      );

      applied.push({ type, relation_type: relationType });
      continue;
    }

    if (type === "INFO_RECORD_CREATE" || type === "INFO_RECORD_WRITE") {
      if (type === "INFO_RECORD_CREATE" && (effect?.links || effect?.link)) {
        throw new Error("INFO_RECORD_CREATE_LINKS_UNSUPPORTED");
      }
      const recordType = normalizeOptionalText(
        resolveDynamicValue(effect?.record_type, ctx, payload)
      );
      if (!recordType) throw new Error("INFO_RECORD_TYPE_REQUIRED");

      const title = normalizeOptionalText(resolveDynamicValue(effect?.title, ctx, payload));
      const description = normalizeOptionalText(resolveDynamicValue(effect?.description, ctx, payload));
      const payloadValue = resolveDynamicValue(effect?.payload || {}, ctx, payload);
      const attrsValue = resolveDynamicValue(effect?.attrs || {}, ctx, payload);

      const infoRes = await client.query(
        `
        INSERT INTO eip_core.info_record
          (tenant_id, record_type, title, description, payload, attrs, created_by_agent_id)
        VALUES
          ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
        RETURNING id
        `,
        [
          ctx.tenantId,
          recordType,
          title,
          description,
          JSON.stringify(payloadValue || {}),
          JSON.stringify(attrsValue || {}),
          ctx.actorAgentId
        ]
      );

      const linkDefs = Array.isArray(effect?.links)
        ? effect.links
        : effect?.link
          ? [effect.link]
          : [];

      for (const link of linkDefs) {
        const srcKind = normalizeOptionalText(link?.src_kind);
        const dstKind = normalizeOptionalText(link?.dst_kind);
        const relationType = normalizeOptionalText(link?.relation_type);
        const srcId = resolveRef(link?.src_id, ctx, payload);
        const dstId = resolveRef(link?.dst_id, ctx, payload) || infoRes.rows[0].id;

        if (!srcKind || !dstKind || !relationType || !srcId || !dstId) {
          throw new Error("LINK_FIELDS_REQUIRED");
        }

        await client.query(
          `
          INSERT INTO eip_core.object_link
            (tenant_id, src_kind, src_id, dst_kind, dst_id, relation_type, attrs)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7::jsonb)
          ON CONFLICT DO NOTHING
          `,
          [ctx.tenantId, srcKind, srcId, dstKind, dstId, relationType, JSON.stringify(link?.attrs || {})]
        );
      }

      applied.push({ type, info_record_id: infoRes.rows[0].id });
      continue;
    }

    if (type === "ACCESS_GRANT_CREATE") {
      const grantType = normalizeOptionalText(resolveDynamicValue(effect?.grant_type, ctx, payload));
      if (!grantType) throw new Error("ACCESS_GRANT_TYPE_REQUIRED");

      const rawToken = normalizeOptionalText(resolveDynamicValue(effect?.token_raw, ctx, payload));
      let tokenHash = normalizeOptionalText(resolveDynamicValue(effect?.token_hash, ctx, payload));
      if (!tokenHash && rawToken) tokenHash = sha256Hex(rawToken);
      const allowMissing = resolveDynamicValue(effect?.allow_missing, ctx, payload) === true;
      if (!tokenHash && allowMissing) {
        applied.push({ type, skipped: true, reason: "TOKEN_MISSING" });
        continue;
      }
      if (!tokenHash) throw new Error("ACCESS_GRANT_TOKEN_REQUIRED");

      const tokenHint = normalizeOptionalText(resolveDynamicValue(effect?.token_hint, ctx, payload));
      const serviceObjectId =
        normalizeOptionalText(resolveDynamicValue(effect?.service_object_id, ctx, payload)) ||
        ctx.serviceObjectId;
      const agentId = normalizeOptionalText(resolveDynamicValue(effect?.agent_id, ctx, payload));
      const contentObjectId = normalizeOptionalText(resolveDynamicValue(effect?.content_object_id, ctx, payload));
      const contentVersionId = normalizeOptionalText(resolveDynamicValue(effect?.content_version_id, ctx, payload));
      const state = normalizeOptionalText(resolveDynamicValue(effect?.state, ctx, payload)) || "active";
      const expiresAt = normalizeOptionalText(resolveDynamicValue(effect?.expires_at, ctx, payload));
      const maxUsesRaw = resolveDynamicValue(effect?.max_uses, ctx, payload);
      const maxUses = Number.isFinite(Number(maxUsesRaw)) ? Number(maxUsesRaw) : 1;
      const attrsValue = resolveDynamicValue(effect?.attrs || {}, ctx, payload);
      const attrs =
        attrsValue && typeof attrsValue === "object" && !Array.isArray(attrsValue)
          ? attrsValue
          : {};

      const allowReuse = resolveDynamicValue(effect?.allow_reuse, ctx, payload) === true;
      if (allowReuse) {
        const existing = await client.query(
          `
          SELECT id
          FROM eip_core.access_grant
          WHERE tenant_id=$1 AND token_hash=$2
          LIMIT 1
          `,
          [ctx.tenantId, tokenHash]
        );
        if (existing.rowCount > 0) {
          applied.push({ type, grant_id: existing.rows[0].id, reused: true });
          continue;
        }
      }

      const hintValue =
        tokenHint ||
        (rawToken ? rawToken.slice(-6) : randomUUID().split("-").pop());

      const grantRes = await client.query(
        `
        INSERT INTO eip_core.access_grant
          (tenant_id, grant_type, token_hash, token_hint, content_object_id, content_version_id,
           service_object_id, agent_id, state, expires_at, max_uses, attrs)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
        RETURNING id
        `,
        [
          ctx.tenantId,
          grantType,
          tokenHash,
          hintValue,
          contentObjectId,
          contentVersionId,
          serviceObjectId,
          agentId,
          state,
          expiresAt,
          maxUses,
          JSON.stringify(attrs)
        ]
      );

      applied.push({ type, grant_id: grantRes.rows[0].id });
      continue;
    }

    if (type === "ACCESS_GRANT_PATCH" || type === "ACCESS_GRANT_UPDATE") {
      const grantId = normalizeOptionalText(
        resolveDynamicValue(effect?.grant_id, ctx, payload)
      );
      const tokenHash = normalizeOptionalText(
        resolveDynamicValue(effect?.token_hash, ctx, payload)
      );
      if (!grantId && !tokenHash) throw new Error("ACCESS_GRANT_KEY_REQUIRED");

      const desiredState = normalizeOptionalText(
        resolveDynamicValue(effect?.state, ctx, payload)
      );
      const requireStates = Array.isArray(effect?.require_states)
        ? effect.require_states
            .map((value) => normalizeOptionalText(resolveDynamicValue(value, ctx, payload)))
            .filter(Boolean)
        : [];
      const incrementUses = resolveDynamicValue(effect?.increment_uses, ctx, payload) === true;
      const setLastRedeemed = resolveDynamicValue(effect?.set_last_redeemed, ctx, payload) === true;

      const keyValue = grantId || tokenHash;
      const keyColumn = grantId ? "id" : "token_hash";

      const grantRes = await client.query(
        `
        SELECT id, state, uses
        FROM eip_core.access_grant
        WHERE tenant_id=$1 AND ${keyColumn}=$2
        FOR UPDATE
        `,
        [ctx.tenantId, keyValue]
      );
      if (grantRes.rowCount === 0) throw new Error("ACCESS_GRANT_NOT_FOUND");

      const grantRow = grantRes.rows[0];
      if (requireStates.length > 0 && !requireStates.includes(grantRow.state)) {
        throw new Error("ACCESS_GRANT_STATE_MISMATCH");
      }

      const nextUses = incrementUses ? grantRow.uses + 1 : grantRow.uses;

      await client.query(
        `
        UPDATE eip_core.access_grant
        SET state = COALESCE($3, state),
            uses = $4,
            last_redeemed_at = CASE WHEN $5::boolean THEN now() ELSE last_redeemed_at END,
            updated_at = now()
        WHERE tenant_id=$1 AND id=$2
        `,
        [ctx.tenantId, grantRow.id, desiredState, nextUses, setLastRedeemed]
      );

      applied.push({
        type,
        grant_id: grantRow.id,
        state: desiredState || grantRow.state,
        uses: nextUses
      });
      continue;
    }

    if (type === "PROCESS_START" || type === "INSTANCE_START") {
      if (type === "PROCESS_START" && Array.isArray(effect?.service_object_ids)) {
        throw new Error("PROCESS_START_MULTI_TARGET_UNSUPPORTED");
      }
      const targetsRaw = Array.isArray(effect?.service_object_ids)
        ? effect.service_object_ids
        : effect?.service_object_id
          ? [effect.service_object_id]
          : [ctx.serviceObjectId];

      const processDefId = normalizeOptionalText(effect?.process_def_id);
      const module = normalizeOptionalText(effect?.module);
      const code = normalizeOptionalText(effect?.code);
      const version = effect?.version;

      const idempotencyKey = normalizeOptionalText(effect?.idempotency_key);
      const idempotencyPrefix = normalizeOptionalText(effect?.idempotency_key_prefix);

      const instances = [];
      for (const rawId of targetsRaw) {
        const serviceObjectId = resolveRef(rawId, ctx, payload);
        if (!serviceObjectId) throw new Error("SERVICE_OBJECT_ID_REQUIRED");

        const key = idempotencyPrefix ? `${idempotencyPrefix}:${serviceObjectId}` : idempotencyKey;
        const result = await createInstance(client, {
          tenantId: ctx.tenantId,
          identityId: ctx.identityId,
          serviceObjectId,
          processDefId,
          module,
          code,
          version,
          idempotencyKey: key
        });
        if (!result.ok) throw new Error(result.error);

        instances.push({
          id: result.item?.id || null,
          service_object_id: serviceObjectId,
          reused: result.reused === true
        });
      }

      applied.push({ type, instances });
      continue;
    }
  }
  return applied;
}

async function createDef(db, tenantId, input) {
  const module = normalizeOptionalText(input.module);
  const objectType = normalizeOptionalText(input.object_type);
  const isPublished = input.is_published === true;
  const graph = input.graph && typeof input.graph === "object" ? { ...input.graph } : {};
  const attrs = input.attrs && typeof input.attrs === "object" ? input.attrs : {};

  if (objectType && !graph.object_type) {
    graph.object_type = objectType;
  }

  const mergedAttrs = {
    ...attrs,
    ...(module ? { module } : {}),
    ...(objectType ? { object_type: objectType } : {}),
    is_published: isPublished
  };

  const r = await db.query(
    `
    INSERT INTO eip_core.process_def
      (tenant_id, code, name, version, is_active, graph, attrs)
    VALUES
      ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
    RETURNING id, code, name, version, is_active, graph, attrs, created_at, updated_at
    `,
    [
      tenantId,
      normalizeText(input.code),
      normalizeText(input.name),
      input.version || 1,
      input.is_active !== false,
      JSON.stringify(graph),
      JSON.stringify(mergedAttrs)
    ]
  );

  return r.rows[0];
}

async function findActiveInstance(client, tenantId, serviceObjectId) {
  const r = await client.query(
    `
    SELECT id, process_def_id, status, cursor_json, ended_at
    FROM eip_core.process_instance
    WHERE tenant_id=$1
      AND service_object_id=$2
      AND ended_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [tenantId, serviceObjectId]
  );
  return r.rows[0] || null;
}

async function resolveBoundProcessDef(client, opts) {
  const tenantId = normalizeOptionalText(opts?.tenantId);
  const serviceObjectType = normalizeOptionalText(opts?.serviceObjectType);
  const taskType = normalizeOptionalText(opts?.taskType);
  if (!tenantId || !serviceObjectType) return null;

  const r = await client.query(
    `
    SELECT
      pd.id,
      pd.graph,
      pd.attrs,
      pb.id AS binding_id,
      pb.task_type AS binding_task_type,
      pb.priority AS binding_priority
    FROM eip_core.process_binding pb
    JOIN eip_core.process_def pd
      ON pd.id = pb.process_def_id
     AND pd.tenant_id = pb.tenant_id
    WHERE pb.tenant_id=$1
      AND pb.service_object_type=$2
      AND pb.is_active=true
      AND pd.is_active=true
      AND ($3::text IS NULL OR pb.task_type=$3 OR pb.task_type IS NULL)
    ORDER BY
      CASE
        WHEN $3::text IS NULL THEN 0
        WHEN pb.task_type=$3 THEN 0
        WHEN pb.task_type IS NULL THEN 1
        ELSE 2
      END ASC,
      pb.priority ASC,
      pd.version DESC
    LIMIT 1
    `,
    [tenantId, serviceObjectType, taskType]
  );
  return r.rows[0] || null;
}

async function createInstance(client, opts) {
  const {
    tenantId,
    identityId,
    serviceObjectId: inputServiceObjectId,
    serviceObject,
    processDefId,
    module,
    code,
    version,
    idempotencyKey,
    taskType
  } = opts;

  let serviceObjectId = normalizeOptionalText(inputServiceObjectId);
  let serviceObjectRow = null;
  const serviceObjectSpec = serviceObject && typeof serviceObject === "object" ? serviceObject : null;

  if (!serviceObjectId) {
    if (!serviceObjectSpec) return { ok: false, error: "SERVICE_OBJECT_REQUIRED" };

    const objectType = normalizeOptionalText(
      serviceObjectSpec.object_type || serviceObjectSpec.objectType
    );
    if (!objectType) return { ok: false, error: "SERVICE_OBJECT_TYPE_REQUIRED" };

    const objectTypeGovernance = await validateServiceObjectTypeGovernance(
      client,
      tenantId,
      objectType
    );
    if (!objectTypeGovernance.ok) return { ok: false, error: objectTypeGovernance.error };

    const status = normalizeStatus(serviceObjectSpec.status || "new");
    const listCode = normalizeOptionalText(serviceObjectSpec.list_code) || DEFAULT_SO_STATUS_LIST_CODE;
    const valid = await validateStatus(client, tenantId, listCode, status);
    if (!valid.ok) return { ok: false, error: valid.error };

    const codeValue = normalizeOptionalText(serviceObjectSpec.code);
    const title = normalizeOptionalText(serviceObjectSpec.title);
    const attrs =
      serviceObjectSpec.attrs && typeof serviceObjectSpec.attrs === "object"
        ? serviceObjectSpec.attrs
        : {};

    const documentGovernance = await validateDocumentAttrsGovernance(
      client,
      tenantId,
      objectTypeGovernance.attrs,
      attrs
    );
    if (!documentGovernance.ok) return { ok: false, error: documentGovernance.error };

    let ownerAgentId = normalizeOptionalText(serviceObjectSpec.owner_agent_id);
    if (!ownerAgentId && serviceObjectSpec.owner_agent) {
      ownerAgentId = await resolveAgentId(client, tenantId, serviceObjectSpec.owner_agent);
    }

    const soRes = await client.query(
      `
      INSERT INTO eip_core.service_object
        (tenant_id, object_type, status, code, title, attrs, owner_agent_id)
      VALUES
        ($1,$2,$3,$4,$5,$6::jsonb,$7)
      RETURNING id, object_type, status, title, attrs, owner_agent_id
      `,
      [
        tenantId,
        objectType,
        status,
        codeValue,
        title,
        JSON.stringify(attrs),
        ownerAgentId
      ]
    );

    serviceObjectRow = soRes.rows[0];
    serviceObjectId = serviceObjectRow.id;

    const parties = Array.isArray(serviceObjectSpec.parties) ? serviceObjectSpec.parties : [];
    for (const party of parties) {
      const role = normalizeOptionalText(party?.role);
      if (!role) return { ok: false, error: "PARTY_ROLE_REQUIRED" };

      let agentId = normalizeOptionalText(party?.agent_id);
      if (!agentId && party?.agent) {
        agentId = await resolveAgentId(client, tenantId, party.agent);
      }
      if (!agentId) return { ok: false, error: "PARTY_AGENT_REQUIRED" };

      const partyAttrs = party?.attrs && typeof party.attrs === "object" ? party.attrs : {};
      await client.query(
        `
        INSERT INTO eip_core.service_object_party
          (tenant_id, service_object_id, agent_id, role, attrs)
        VALUES
          ($1,$2,$3,$4,$5::jsonb)
        ON CONFLICT DO NOTHING
        `,
        [tenantId, serviceObjectId, agentId, role, JSON.stringify(partyAttrs)]
      );
    }

    const links = Array.isArray(serviceObjectSpec.links) ? serviceObjectSpec.links : [];
    for (const link of links) {
      const srcKind = normalizeOptionalText(link?.src_kind);
      const dstKind = normalizeOptionalText(link?.dst_kind);
      const relationType = normalizeOptionalText(link?.relation_type);
      const rawSrcId = normalizeOptionalText(link?.src_id) || "$service_object_id";
      const rawDstId = normalizeOptionalText(link?.dst_id);

      const srcId = rawSrcId === "$service_object_id" ? serviceObjectId : rawSrcId;
      const dstId = rawDstId === "$service_object_id" ? serviceObjectId : rawDstId;

      if (!srcKind || !dstKind || !relationType || !srcId || !dstId) {
        return { ok: false, error: "LINK_FIELDS_REQUIRED" };
      }

      const linkAttrs = link?.attrs && typeof link.attrs === "object" ? link.attrs : {};
      await client.query(
        `
        INSERT INTO eip_core.object_link
          (tenant_id, src_kind, src_id, dst_kind, dst_id, relation_type, attrs)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7::jsonb)
        ON CONFLICT DO NOTHING
        `,
        [tenantId, srcKind, srcId, dstKind, dstId, relationType, JSON.stringify(linkAttrs)]
      );
    }
  } else {
    const soRes = await client.query(
      `
      SELECT id, object_type, owner_agent_id
      FROM eip_core.service_object
      WHERE tenant_id=$1 AND id=$2
      `,
      [tenantId, serviceObjectId]
    );
    if (soRes.rowCount === 0) return { ok: false, error: "SERVICE_OBJECT_NOT_FOUND" };
    serviceObjectRow = soRes.rows[0];
  }

  const processDefRef = normalizeOptionalText(processDefId);
  const processCode = normalizeOptionalText(code);
  const processModule = normalizeOptionalText(module);
  const processTaskType = normalizeOptionalText(taskType);

  let def = null;
  if (processDefRef) {
    const defRes = await client.query(
      `
      SELECT id, graph, attrs
      FROM eip_core.process_def
      WHERE tenant_id=$1 AND id=$2
      `,
      [tenantId, processDefRef]
    );
    def = defRes.rows[0] || null;
  } else if (processCode) {
    const params = [tenantId, processCode];
    const filters = ["tenant_id=$1", "code=$2"];
    if (processModule) {
      params.push(processModule);
      filters.push(`attrs->>'module' = $${params.length}`);
    }
    if (version) {
      params.push(version);
      filters.push(`version = $${params.length}`);
    }

    const defRes = await client.query(
      `
      SELECT id, graph, attrs
      FROM eip_core.process_def
      WHERE ${filters.join(" AND ")}
      ORDER BY version DESC
      LIMIT 1
      `,
      params
    );
    def = defRes.rows[0] || null;
  } else {
    def = await resolveBoundProcessDef(client, {
      tenantId,
      serviceObjectType: serviceObjectRow.object_type,
      taskType: processTaskType
    });
    if (!def) return { ok: false, error: "PROCESS_BINDING_NOT_FOUND" };
  }

  if (!def) return { ok: false, error: "PROCESS_DEF_NOT_FOUND" };

  const graph = def.graph || {};
  const initialNode = graph.initial_node || graph.initialNode || null;
  if (!initialNode) return { ok: false, error: "INITIAL_NODE_REQUIRED" };

  const objectType = resolveGraphObjectType(graph, def.attrs);
  if (objectType && objectType !== serviceObjectRow.object_type) {
    return { ok: false, error: "OBJECT_TYPE_MISMATCH" };
  }

  if (idempotencyKey) {
    const existing = await client.query(
      `
      SELECT id, service_object_id, process_def_id, status, started_at, ended_at, cursor_json
      FROM eip_core.process_instance
      WHERE tenant_id=$1
        AND service_object_id=$2
        AND ended_at IS NULL
        AND status='active'
        AND cursor_json->>'idempotency_key' = $3
      LIMIT 1
      `,
      [tenantId, serviceObjectId, idempotencyKey]
    );
    if (existing.rowCount > 0) {
      return { ok: true, reused: true, item: existing.rows[0] };
    }
  }

  const cursor = {
    node: initialNode,
    history: [],
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {})
  };

  const instRes = await client.query(
    `
    INSERT INTO eip_core.process_instance
      (tenant_id, service_object_id, process_def_id, status, cursor_json, attrs)
    VALUES
      ($1,$2,$3,'active',$4::jsonb,'{}'::jsonb)
    RETURNING id, service_object_id, process_def_id, status, started_at, ended_at, cursor_json, attrs, created_at, updated_at
    `,
    [tenantId, serviceObjectId, def.id, JSON.stringify(cursor)]
  );

  const actorAgentId = await getPrimaryAgentId(client, tenantId, identityId);
  const ctx = {
    tenantId,
    identityId,
    actorAgentId,
    instanceId: instRes.rows[0].id,
    processDefId: def.id,
    serviceObjectId,
    serviceObject: serviceObjectRow,
    cursor
  };

  const nodes = buildNodeMap(graph);
  const onEnter = nodes[initialNode]?.on_enter || nodes[initialNode]?.onEnter;
  const templateRefs = [];
  if (onEnter?.task_templates || onEnter?.taskTemplates) {
    templateRefs.push(...(onEnter.task_templates || onEnter.taskTemplates));
  }
  if (Array.isArray(onEnter?.task_template_types)) {
    templateRefs.push(...onEnter.task_template_types);
  }
  if (Array.isArray(onEnter?.task_template_ids)) {
    templateRefs.push(...onEnter.task_template_ids.map((id) => ({ task_template_id: id })));
  }
  if (templateRefs.length > 0) {
    await applyTaskTemplates(client, ctx, templateRefs);
  }

  return { ok: true, item: instRes.rows[0], service_object: serviceObjectRow };
}

async function advanceInstance(client, opts) {
  const {
    tenantId,
    identityId,
    instanceId,
    action,
    payload,
    idempotencyKey
  } = opts;

  const instRes = await client.query(
    `
    SELECT id, service_object_id, process_def_id, status, ended_at, cursor_json
    FROM eip_core.process_instance
    WHERE tenant_id=$1 AND id=$2
    FOR UPDATE
    `,
    [tenantId, instanceId]
  );
  if (instRes.rowCount === 0) return { ok: false, error: "NOT_FOUND" };

  const inst = instRes.rows[0];
  if (inst.ended_at || inst.status !== "active") {
    return { ok: false, error: "INSTANCE_CLOSED" };
  }

  if (!idempotencyKey) return { ok: false, error: "IDEMPOTENCY_REQUIRED" };

  const defRes = await client.query(
    `
    SELECT id, graph, attrs
    FROM eip_core.process_def
    WHERE tenant_id=$1 AND id=$2
    `,
    [tenantId, inst.process_def_id]
  );
  if (defRes.rowCount === 0) return { ok: false, error: "PROCESS_DEF_NOT_FOUND" };

  const graph = defRes.rows[0].graph || {};
  const initialNode = graph.initial_node || graph.initialNode || null;
  const cursor = ensureHistory(inst.cursor_json || {}, initialNode);

  const existing = findHistoryByKey(cursor, idempotencyKey);
  if (existing) return { ok: true, reused: true, entry: existing };

  const node = cursor.node || initialNode;
  if (!node) return { ok: false, error: "NODE_MISSING" };

  const transitions = Array.isArray(graph.transitions) ? graph.transitions : [];
  const transition = transitions.find(
    (t) => t && t.from === node && t.action === action
  );
  if (!transition) return { ok: false, error: "INVALID_TRANSITION" };

  const macroResolution = resolveTransitionMacro(graph, transition);
  if (!macroResolution.ok) {
    return { ok: false, error: macroResolution.error };
  }

  const soRes = await client.query(
    `
    SELECT id, object_type, status, owner_agent_id
    FROM eip_core.service_object
    WHERE tenant_id=$1 AND id=$2
    FOR UPDATE
    `,
    [tenantId, inst.service_object_id]
  );
  if (soRes.rowCount === 0) return { ok: false, error: "SERVICE_OBJECT_NOT_FOUND" };

  const actorAgentId = await getPrimaryAgentId(client, tenantId, identityId);

  const ctx = {
    tenantId,
    identityId,
    actorAgentId,
    instanceId: inst.id,
    processDefId: inst.process_def_id,
    serviceObjectId: inst.service_object_id,
    serviceObject: soRes.rows[0],
    cursor,
    createdServiceObjects: [],
    createdByKey: {}
  };

  const macroParamsRaw =
    (macroResolution.macro && typeof macroResolution.macro === "object"
      ? macroResolution.macro.params || macroResolution.macro.macro_params
      : null) ||
    transition?.macro_params ||
    transition?.macroParams ||
    null;
  const macroParams =
    macroParamsRaw && typeof macroParamsRaw === "object"
      ? resolveDynamicValue(macroParamsRaw, ctx, payload)
      : {};

  const executionPayload =
    macroParams && Object.keys(macroParams).length > 0
      ? { ...(payload || {}), _macro_params: macroParams }
      : payload || {};

  const reasoningResult = await executeProcessMacroReasoning(client, {
    tenantId,
    serviceObjectId: inst.service_object_id,
    serviceObject: ctx.serviceObject,
    macro: macroResolution.macro,
    input: executionPayload,
    policy: macroResolution.macro?.policy || {},
    context: {
      process_instance_id: inst.id,
      process_def_id: inst.process_def_id,
      service_object_id: inst.service_object_id
    }
  });
  ctx.calc = reasoningResult.calc || {};

  const effectsApplied = await applyEffects(
    client,
    ctx,
    macroResolution.effects,
    executionPayload
  );

  const toNode = transition.to || node;
  cursor.node = toNode;

  const historyEntry = {
    at: new Date().toISOString(),
    from: node,
    to: toNode,
    action,
    macro_code: macroResolution.macro_code,
    macro_source: macroResolution.macro_source,
    macro_params: macroParams,
    ...(reasoningResult.executed
      ? {
          calculation: {
            calc_digest: reasoningResult.calc_digest,
            parent_attr_paths: reasoningResult.parent_attr_paths,
            projection_queries: reasoningResult.projection_queries,
            audit: reasoningResult.audit
          }
        }
      : {}),
    idempotency_key: idempotencyKey,
    effects_applied: effectsApplied,
    actor_agent_id: actorAgentId,
    payload_digest: buildIdempotencyDigest(payload)
  };
  cursor.history.push(historyEntry);

  const nodes = buildNodeMap(graph);
  const nodeDef = nodes[toNode] || null;
  const isTerminal =
    nodeDef?.is_terminal === true ||
    nodeDef?.isTerminal === true ||
    nodeDef?.terminal === true;

  const onEnter = nodes[toNode]?.on_enter || nodes[toNode]?.onEnter;
  const templateRefs = [];
  if (onEnter?.task_templates || onEnter?.taskTemplates) {
    templateRefs.push(...(onEnter.task_templates || onEnter.taskTemplates));
  }
  if (Array.isArray(onEnter?.task_template_types)) {
    templateRefs.push(...onEnter.task_template_types);
  }
  if (Array.isArray(onEnter?.task_template_ids)) {
    templateRefs.push(...onEnter.task_template_ids.map((id) => ({ task_template_id: id })));
  }
  if (templateRefs.length > 0) {
    await applyTaskTemplates(client, ctx, templateRefs);
  }

  await client.query(
    `
    UPDATE eip_core.process_instance
    SET cursor_json=$3::jsonb,
        status = CASE WHEN $4::boolean THEN 'completed' ELSE status END,
        ended_at = CASE WHEN $4::boolean THEN now() ELSE ended_at END,
        updated_at=now()
    WHERE tenant_id=$1 AND id=$2
    `,
    [tenantId, inst.id, JSON.stringify(cursor), isTerminal]
  );

  return { ok: true, entry: historyEntry };
}

async function updateTaskStatus(client, input) {
  const tenantId = normalizeOptionalText(input?.tenantId);
  const identityId = normalizeOptionalText(input?.identityId);
  const taskId = normalizeOptionalText(input?.taskId);
  const toStatus = normalizeStatus(input?.toStatus);
  const reasonCode = normalizeOptionalText(input?.reasonCode);
  const note = normalizeOptionalText(input?.note);
  const attrs = input?.attrs && typeof input.attrs === "object" ? input.attrs : {};

  if (!tenantId) throw new Error("TENANT_ID_REQUIRED");
  if (!identityId) throw new Error("IDENTITY_ID_REQUIRED");
  if (!taskId) throw new Error("TASK_ID_REQUIRED");

  const valid = await validateStatus(client, tenantId, TASK_STATUS_LIST_CODE, toStatus);
  if (!valid.ok) throw new Error(valid.error);

  const taskRes = await client.query(
    `
    SELECT status
    FROM eip_core.task
    WHERE tenant_id=$1 AND id=$2
    FOR UPDATE
    `,
    [tenantId, taskId]
  );
  if (taskRes.rowCount === 0) throw new Error("TASK_NOT_FOUND");

  await client.query(
    `
    UPDATE eip_core.task
    SET status=$3, updated_at=now()
    WHERE tenant_id=$1 AND id=$2
    `,
    [tenantId, taskId, toStatus]
  );

  const actorAgentId = await getPrimaryAgentId(client, tenantId, identityId);

  await client.query(
    `
    INSERT INTO eip_core.task_status_event
      (tenant_id, task_id, from_status, to_status, reason_code, note, actor_agent_id, attrs)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    `,
    [tenantId, taskId, taskRes.rows[0].status, toStatus, reasonCode, note, actorAgentId, JSON.stringify(attrs)]
  );

  return { ok: true, task_id: taskId, to_status: toStatus };
}

export {
  createDef,
  createInstance,
  advanceInstance,
  findActiveInstance,
  updateTaskStatus
};
