import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Circle,
  Code,
  FileText,
  Flag,
  GitBranch,
  Layers,
  LayoutTemplate,
  Link,
  Merge,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  User,
  Workflow,
} from "lucide-react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { getPath, resolveContract, resolveValue } from "../../engine/contracts.js";
import MiniHelp from "./MiniHelp.jsx";
import StateNotice from "./StateNotice.jsx";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOptionalText(value) {
  const trimmed = normalizeText(value);
  return trimmed.length ? trimmed : "";
}

const AUTHORING_TAB_ICONS = Object.freeze({
  definition: FileText,
  flow: Workflow,
  effects: Sparkles,
  advanced: Code,
});

const FLOW_INSPECTOR_ICONS = Object.freeze({
  definition: FileText,
  node: Settings2,
  transition: ArrowRightLeft,
  templates: LayoutTemplate,
  bindings: Link,
});

function renderMappedIcon(iconMap, key, fallbackLabel = "") {
  const Icon = iconMap[key];
  if (Icon) {
    return <Icon size={12} strokeWidth={2} aria-hidden="true" />;
  }
  return (fallbackLabel || "?").slice(0, 1).toUpperCase();
}

function renderNodeTypeIcon(nodeType, isTerminal) {
  if (isTerminal) {
    return <Flag size={13} strokeWidth={2} aria-hidden="true" />;
  }

  const normalized = normalizeText(nodeType).toUpperCase();
  if (normalized.includes("TRIGGER")) return <Sparkles size={13} strokeWidth={2} aria-hidden="true" />;
  if (normalized.includes("HUMAN") || normalized.includes("TASK")) return <User size={13} strokeWidth={2} aria-hidden="true" />;
  if (normalized.includes("DECISION")) return <GitBranch size={13} strokeWidth={2} aria-hidden="true" />;
  if (normalized.includes("JOIN")) return <Merge size={13} strokeWidth={2} aria-hidden="true" />;
  if (normalized.includes("END") || normalized.includes("TERMINAL")) return <Flag size={13} strokeWidth={2} aria-hidden="true" />;
  if (normalized.includes("START")) return <Circle size={13} strokeWidth={2} aria-hidden="true" />;
  return <Layers size={13} strokeWidth={2} aria-hidden="true" />;
}

function hasAnyPermission(session, expected = []) {
  if (!Array.isArray(expected) || expected.length === 0) return true;
  const granted = Array.isArray(session?.permissions) ? session.permissions : [];
  return expected.some((permission) => granted.includes(permission));
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function prettyJson(value, fallback) {
  const source = value !== undefined && value !== null ? value : fallback;
  return JSON.stringify(source, null, 2);
}

function parseJson(text, label, fallback) {
  const source = String(text ?? "").trim();
  if (!source.length) {
    return { ok: true, value: fallback };
  }
  try {
    return { ok: true, value: JSON.parse(source) };
  } catch {
    return { ok: false, error: `${label} must be valid JSON.` };
  }
}

function parseJsonArray(text, label) {
  const result = parseJson(text, label, []);
  if (!result.ok) return { ok: false, error: result.error, value: [] };
  if (!Array.isArray(result.value)) {
    return { ok: false, error: `${label} must be a JSON array.`, value: [] };
  }
  return { ok: true, value: result.value };
}

function normalizeNodeOption(rawNode) {
  if (typeof rawNode === "string") {
    const code = normalizeOptionalText(rawNode);
    if (!code) return null;
    return { code, label: code, type: "" };
  }
  if (!rawNode || typeof rawNode !== "object") return null;
  const code =
    normalizeOptionalText(rawNode.code) ||
    normalizeOptionalText(rawNode.id) ||
    normalizeOptionalText(rawNode.key) ||
    normalizeOptionalText(rawNode.node_code) ||
    normalizeOptionalText(rawNode.name);
  if (!code) return null;
  return {
    code,
    label: normalizeOptionalText(rawNode.label) || code,
    type: normalizeOptionalText(rawNode.type || rawNode.node_type),
  };
}

function normalizeTransitionRow(rawRow) {
  if (!rawRow || typeof rawRow !== "object") {
    return { from: "", to: "", effect: "", label: "", action: "", taskLabel: "", macroCode: "" };
  }

  return {
    from:
      normalizeOptionalText(rawRow.from) ||
      normalizeOptionalText(rawRow.from_node) ||
      normalizeOptionalText(rawRow.source) ||
      normalizeOptionalText(rawRow.source_node),
    to:
      normalizeOptionalText(rawRow.to) ||
      normalizeOptionalText(rawRow.to_node) ||
      normalizeOptionalText(rawRow.target) ||
      normalizeOptionalText(rawRow.target_node),
    effect:
      normalizeOptionalText(rawRow.effect_code) ||
      normalizeOptionalText(rawRow.effect) ||
      normalizeOptionalText(rawRow.task_action) ||
      normalizeOptionalText(rawRow.action),
    action: normalizeOptionalText(rawRow.action),
    taskLabel:
      normalizeOptionalText(rawRow.task_label) || normalizeOptionalText(rawRow.taskLabel),
    macroCode:
      normalizeOptionalText(rawRow.macro_code) || normalizeOptionalText(rawRow.macroCode),
    label: normalizeOptionalText(rawRow.label),
  };
}

function normalizeMacroEffectRow(rawEffect) {
  if (!rawEffect || typeof rawEffect !== "object") {
    return {
      type: "",
      serviceObjectType: "",
      serviceObjectCategory: "",
      configText: "{}",
    };
  }

  const {
    type,
    service_object_type: serviceObjectType,
    object_type: objectTypeAlias,
    service_object_category: serviceObjectCategory,
    object_category: objectCategoryAlias,
    ...rest
  } = rawEffect;

  const normalizedType = normalizeOptionalText(type);
  const normalizedServiceObjectType =
    normalizeOptionalText(serviceObjectType) || normalizeOptionalText(objectTypeAlias);
  const normalizedServiceObjectCategory =
    normalizeOptionalText(serviceObjectCategory) || normalizeOptionalText(objectCategoryAlias);
  const configPayload =
    rest && typeof rest === "object" && !Array.isArray(rest) && Object.keys(rest).length > 0
      ? rest
      : {};

  return {
    type: normalizedType,
    serviceObjectType: normalizedServiceObjectType,
    serviceObjectCategory: normalizedServiceObjectCategory,
    configText: prettyJson(configPayload, {}),
  };
}

function normalizeMacroRow(rawMacro, fallbackCode = "") {
  const source = rawMacro && typeof rawMacro === "object" ? rawMacro : {};
  const code =
    normalizeOptionalText(source.code) ||
    normalizeOptionalText(source.id) ||
    normalizeOptionalText(source.key) ||
    normalizeOptionalText(fallbackCode);
  const label = normalizeOptionalText(source.label) || normalizeOptionalText(source.name) || code;
  const effects = Array.isArray(source.effects) ? source.effects : [];

  return {
    code,
    label,
    effects: effects.map((effect) => normalizeMacroEffectRow(effect)),
  };
}

function parseMacroRows(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((entry) => normalizeMacroRow(entry))
      .filter((entry) => normalizeOptionalText(entry.code));
  }
  if (typeof rawValue === "object") {
    return Object.entries(rawValue)
      .map(([code, entry]) => normalizeMacroRow(entry, code))
      .filter((entry) => normalizeOptionalText(entry.code));
  }
  return [];
}

function buildMacroPayload(rows) {
  const payload = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const macroCode = normalizeOptionalText(row?.code);
    if (!macroCode) continue;

    const macro = {
      label: normalizeOptionalText(row?.label) || macroCode,
      effects: [],
    };

    for (const effect of Array.isArray(row?.effects) ? row.effects : []) {
      const type = normalizeOptionalText(effect?.type);
      if (!type) continue;

      const nextEffect = { type };
      const serviceObjectType = normalizeOptionalText(effect?.serviceObjectType);
      const serviceObjectCategory = normalizeOptionalText(effect?.serviceObjectCategory);
      if (serviceObjectType) nextEffect.service_object_type = serviceObjectType;
      if (serviceObjectCategory) nextEffect.service_object_category = serviceObjectCategory;

      const parsedConfig = parseJson(
        effect?.configText,
        `Macro ${macroCode} effect ${type} config`,
        {}
      );
      if (!parsedConfig.ok) return parsedConfig;
      if (
        parsedConfig.value &&
        typeof parsedConfig.value === "object" &&
        !Array.isArray(parsedConfig.value)
      ) {
        Object.assign(nextEffect, parsedConfig.value);
      }

      macro.effects.push(nextEffect);
    }

    payload[macroCode] = macro;
  }

  return { ok: true, value: payload };
}

function normalizeTemplateList(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((entry) => normalizeOptionalText(entry))
    .filter(Boolean);
}

function toNodeCode(rawNode, fallbackCode) {
  if (typeof rawNode === "string") {
    return normalizeOptionalText(rawNode) || fallbackCode;
  }
  if (!rawNode || typeof rawNode !== "object") return fallbackCode;
  return (
    normalizeOptionalText(rawNode.id) ||
    normalizeOptionalText(rawNode.code) ||
    normalizeOptionalText(rawNode.key) ||
    normalizeOptionalText(rawNode.node_code) ||
    normalizeOptionalText(rawNode.name) ||
    fallbackCode
  );
}

function normalizeCanvasNode(rawNode, fallbackIndex = 0) {
  const fallbackCode = `node_${fallbackIndex + 1}`;
  const code = toNodeCode(rawNode, fallbackCode);
  const source = rawNode && typeof rawNode === "object" ? rawNode : {};
  const onEnter =
    source.on_enter && typeof source.on_enter === "object" ? source.on_enter : {};

  return {
    code,
    type:
      normalizeOptionalText(source.type) ||
      normalizeOptionalText(source.node_type) ||
      "STEP",
    label:
      normalizeOptionalText(source.label) ||
      normalizeOptionalText(source.name) ||
      code,
    isTerminal:
      source.is_terminal === true ||
      source.isTerminal === true ||
      source.terminal === true,
    taskTemplatesText: Array.isArray(onEnter.task_template_types)
      ? onEnter.task_template_types.join("\n")
      : "",
  };
}

function buildCanvasNodePayload(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeCanvasNode(row, index))
    .filter((row) => normalizeOptionalText(row.code))
    .map((row) => {
      const entry = {
        id: row.code,
        type: normalizeOptionalText(row.type) || "STEP",
        label: normalizeOptionalText(row.label) || row.code,
        is_terminal: row.isTerminal === true,
      };
      const taskTemplates = normalizeTemplateList(row.taskTemplatesText);
      if (taskTemplates.length > 0) {
        entry.on_enter = { task_template_types: taskTemplates };
      }
      return entry;
    });
}

function createUniqueNodeCode(existingRows, preferredType) {
  const used = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .map((row) => normalizeOptionalText(row?.code))
      .filter(Boolean)
  );
  const base = normalizeOptionalText(preferredType).toLowerCase() || "node";
  let counter = 1;
  let candidate = `${base}_${counter}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${base}_${counter}`;
  }
  return candidate;
}

function normalizeStarterTemplateNode(rawNode, index) {
  if (!rawNode || typeof rawNode !== "object") return null;
  const code = toNodeCode(rawNode, `node_${index + 1}`);
  if (!code) return null;
  const taskTemplates = Array.isArray(rawNode.task_template_types)
    ? rawNode.task_template_types
    : Array.isArray(rawNode.task_templates)
      ? rawNode.task_templates
      : [];
  return {
    code,
    type: normalizeOptionalText(rawNode.type) || "STEP",
    label: normalizeOptionalText(rawNode.label) || code,
    isTerminal:
      rawNode.is_terminal === true ||
      rawNode.isTerminal === true ||
      rawNode.terminal === true,
    taskTemplatesText: taskTemplates.join("\n"),
  };
}

function normalizeStarterTemplateTransition(rawTransition) {
  if (!rawTransition || typeof rawTransition !== "object") return null;
  return normalizeTransitionRow(rawTransition);
}

function normalizeStarterTemplate(rawTemplate) {
  if (!rawTemplate || typeof rawTemplate !== "object") return null;
  const id = normalizeOptionalText(rawTemplate.id) || normalizeOptionalText(rawTemplate.code);
  if (!id) return null;
  const label = normalizeOptionalText(rawTemplate.label) || id;
  const nodes = (Array.isArray(rawTemplate.nodes) ? rawTemplate.nodes : [])
    .map((node, index) => normalizeStarterTemplateNode(node, index))
    .filter(Boolean);
  const transitions = (Array.isArray(rawTemplate.transitions) ? rawTemplate.transitions : [])
    .map((transition) => normalizeStarterTemplateTransition(transition))
    .filter(Boolean);
  return {
    id,
    label,
    description: normalizeOptionalText(rawTemplate.description),
    objectType: normalizeOptionalText(rawTemplate.object_type),
    serviceObjectCategory: normalizeOptionalText(rawTemplate.service_object_category),
    initialNode:
      normalizeOptionalText(rawTemplate.initial_node) ||
      normalizeOptionalText(nodes[0]?.code),
    nodes,
    transitions,
    macros:
      rawTemplate.macros && typeof rawTemplate.macros === "object" && !Array.isArray(rawTemplate.macros)
        ? rawTemplate.macros
        : {},
  };
}

function buildTopDownFlowView({ nodeOptions, transitions, initialNode }) {
  const options = Array.isArray(nodeOptions) ? nodeOptions : [];
  if (options.length === 0) {
    return { startNode: "", levels: [] };
  }

  const nodeByCode = new Map(options.map((entry) => [entry.code, entry]));
  const outgoing = new Map();
  const incomingCounts = new Map();

  for (const option of options) {
    outgoing.set(option.code, []);
    incomingCounts.set(option.code, 0);
  }

  for (const transition of Array.isArray(transitions) ? transitions : []) {
    const from = normalizeOptionalText(transition?.from);
    const to = normalizeOptionalText(transition?.to);
    if (!from || !to) continue;
    if (!nodeByCode.has(from) || !nodeByCode.has(to)) continue;
    outgoing.get(from).push(transition);
    incomingCounts.set(to, (incomingCounts.get(to) || 0) + 1);
  }

  const resolvedStartNode =
    normalizeOptionalText(initialNode) && nodeByCode.has(normalizeOptionalText(initialNode))
      ? normalizeOptionalText(initialNode)
      : options[0].code;

  const visited = new Set();
  const queue = [{ code: resolvedStartNode, level: 0 }];
  const levels = new Map();
  let maxLevel = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.code)) continue;
    visited.add(current.code);
    maxLevel = Math.max(maxLevel, current.level);

    if (!levels.has(current.level)) {
      levels.set(current.level, []);
    }
    levels.get(current.level).push(current.code);

    const nextTransitions = outgoing.get(current.code) || [];
    for (const transition of nextTransitions) {
      const to = normalizeOptionalText(transition?.to);
      if (!to || visited.has(to)) continue;
      queue.push({ code: to, level: current.level + 1 });
    }
  }

  const disconnected = options
    .map((entry) => entry.code)
    .filter((code) => !visited.has(code));
  if (disconnected.length > 0) {
    const level = maxLevel + 1;
    levels.set(level, disconnected);
    maxLevel = level;
  }

  const resultLevels = [];
  for (let level = 0; level <= maxLevel; level += 1) {
    const codes = levels.get(level) || [];
    if (codes.length === 0) continue;

    resultLevels.push({
      level,
      nodes: codes.map((code) => {
        const option = nodeByCode.get(code) || { code, label: code, type: "" };
        const nodeTransitions = outgoing.get(code) || [];
        return {
          code: option.code,
          label: option.label,
          type: option.type,
          incomingCount: incomingCounts.get(code) || 0,
          outgoing: nodeTransitions.map((transition) => ({
            to: normalizeOptionalText(transition?.to),
            taskLabel: normalizeOptionalText(transition?.taskLabel),
            macroCode: normalizeOptionalText(transition?.macroCode),
            effect: normalizeOptionalText(transition?.effect),
          })),
        };
      }),
    });
  }

  return {
    startNode: resolvedStartNode,
    levels: resultLevels,
  };
}

function normalizeField(rawField) {
  if (!rawField || typeof rawField !== "object") return null;
  const key = normalizeText(rawField.key);
  if (!key) return null;

  return {
    key,
    label: normalizeOptionalText(rawField.label) || key,
    type: normalizeOptionalText(rawField.type) || "text",
    group: normalizeOptionalText(rawField.group) || "default",
    rows: Number.isFinite(rawField.rows) ? rawField.rows : undefined,
    placeholder: normalizeOptionalText(rawField.placeholder),
    disabled_when_existing: rawField.disabled_when_existing === true,
    source_path: normalizeOptionalText(rawField.source_path) || key,
    default_value: rawField.default_value,
  };
}

function normalizeGroup(rawGroup) {
  if (!rawGroup || typeof rawGroup !== "object") return null;
  const id = normalizeText(rawGroup.id);
  if (!id) return null;
  return {
    id,
    title: normalizeOptionalText(rawGroup.title),
    layout_class: normalizeOptionalText(rawGroup.layout_class) || "form-grid",
  };
}

function normalizeJsonField(rawField, fieldsByKey) {
  if (!rawField || typeof rawField !== "object") return null;
  const key = normalizeText(rawField.key);
  if (!key || !fieldsByKey.has(key)) return null;
  return {
    key,
    label: normalizeOptionalText(rawField.label) || fieldsByKey.get(key)?.label || key,
    fallback:
      rawField.fallback !== undefined
        ? rawField.fallback
        : fieldsByKey.get(key)?.type === "json"
          ? {}
          : null,
  };
}

function normalizeProjectionRow(rawRow) {
  if (!rawRow || typeof rawRow !== "object") return null;
  const label = normalizeText(rawRow.label);
  const path = normalizeText(rawRow.path);
  if (!label || !path) return null;
  return {
    label,
    path,
    format: normalizeOptionalText(rawRow.format) || "text",
    item_key: normalizeOptionalText(rawRow.item_key),
  };
}

function normalizeTaxonomyRow(rawRow) {
  if (!rawRow || typeof rawRow !== "object") return null;
  const label = normalizeText(rawRow.label);
  const code = normalizeText(rawRow.code);
  if (!label || !code) return null;
  return { label, code };
}

function toBusinessEyebrow(value, fallback) {
  const text = normalizeOptionalText(value);
  if (!text) return fallback;
  const normalized = text.toLowerCase();
  if (normalized.includes("workbench contract")) return "Process Setup";
  if (normalized.includes("ui engine")) return "Process Setup";
  return text;
}

const DEFAULT_STARTER_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "intake_review_close",
    label: "Intake -> Review -> Close",
    description: "Fast baseline flow for most request-handling processes.",
    object_type: "ServiceObject",
    nodes: [
      { id: "intake", type: "TRIGGER", label: "Intake" },
      { id: "review", type: "HUMAN_TASK", label: "Review" },
      { id: "closed", type: "TERMINAL", label: "Closed", is_terminal: true },
    ],
    transitions: [
      { from: "intake", to: "review", task_label: "Review request", macro_code: "macro_review" },
      { from: "review", to: "closed", task_label: "Close request", macro_code: "macro_close" },
    ],
    macros: {
      macro_review: { label: "Review", effects: [] },
      macro_close: { label: "Close", effects: [] },
    },
    initial_node: "intake",
  }),
  Object.freeze({
    id: "approve_reject",
    label: "Approve / Reject",
    description: "Common two-path decision process with approve and reject outcomes.",
    object_type: "ServiceObject",
    nodes: [
      { id: "submitted", type: "TRIGGER", label: "Submitted" },
      { id: "decision", type: "HUMAN_TASK", label: "Decision" },
      { id: "approved", type: "TERMINAL", label: "Approved", is_terminal: true },
      { id: "rejected", type: "TERMINAL", label: "Rejected", is_terminal: true },
    ],
    transitions: [
      { from: "submitted", to: "decision", task_label: "Assess", macro_code: "macro_assess" },
      { from: "decision", to: "approved", task_label: "Approve", macro_code: "macro_approve" },
      { from: "decision", to: "rejected", task_label: "Reject", macro_code: "macro_reject" },
    ],
    macros: {
      macro_assess: { label: "Assess", effects: [] },
      macro_approve: { label: "Approve", effects: [] },
      macro_reject: { label: "Reject", effects: [] },
    },
    initial_node: "submitted",
  }),
  Object.freeze({
    id: "create_review_amend",
    label: "Create -> Review -> Amend",
    description: "Inventory/service-object lifecycle with amendment stage.",
    object_type: "Assets",
    service_object_category: "default",
    nodes: [
      { id: "create", type: "TRIGGER", label: "Create" },
      { id: "review", type: "STEP", label: "Review" },
      { id: "amend", type: "STEP", label: "Amend" },
      { id: "done", type: "TERMINAL", label: "Done", is_terminal: true },
    ],
    transitions: [
      { from: "create", to: "review", task_label: "Validate", macro_code: "macro_validate" },
      { from: "review", to: "amend", task_label: "Amend inventory", macro_code: "macro_amend" },
      { from: "amend", to: "done", task_label: "Finalize", macro_code: "macro_finalize" },
    ],
    macros: {
      macro_validate: { label: "Validate", effects: [] },
      macro_amend: { label: "Inventory amend", effects: [] },
      macro_finalize: { label: "Finalize", effects: [] },
    },
    initial_node: "create",
  }),
]);

function normalizeAuthoringTab(rawTab) {
  if (!rawTab || typeof rawTab !== "object") return null;
  const id = normalizeOptionalText(rawTab.id);
  if (!id) return null;
  return {
    id,
    label: normalizeOptionalText(rawTab.label) || id,
    icon: normalizeOptionalText(rawTab.icon).slice(0, 2).toUpperCase(),
  };
}

function normalizeConfig(props = {}) {
  const fields = Array.isArray(props.fields)
    ? props.fields.map((field) => normalizeField(field)).filter(Boolean)
    : [];
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));

  const groups = Array.isArray(props.groups)
    ? props.groups.map((group) => normalizeGroup(group)).filter(Boolean)
    : [];

  const jsonFieldsSource = Array.isArray(props.json_fields)
    ? props.json_fields
    : fields.filter((field) => field.type === "json").map((field) => ({ key: field.key }));
  const jsonFields = jsonFieldsSource
    .map((jsonField) => normalizeJsonField(jsonField, fieldsByKey))
    .filter(Boolean);

  const taxonomyRows = Array.isArray(props.taxonomy?.rows)
    ? props.taxonomy.rows.map((row) => normalizeTaxonomyRow(row)).filter(Boolean)
    : [];

  const projectionRows = Array.isArray(props.projection?.rows)
    ? props.projection.rows.map((row) => normalizeProjectionRow(row)).filter(Boolean)
    : [];

  return {
    title: normalizeOptionalText(props.title) || "Detail Editor",
    eyebrow: toBusinessEyebrow(props.eyebrow, "Process Setup"),
    selection: {
      target: normalizeOptionalText(props.selection?.target) || "definition",
      id_key: normalizeOptionalText(props.selection?.id_key) || "id",
      label_path: normalizeOptionalText(props.selection?.label_path) || "code",
      new_label: normalizeOptionalText(props.selection?.new_label) || "New Draft",
    },
    permissions_any: Array.isArray(props.permissions_any) ? props.permissions_any : [],
    read_only_message:
      normalizeOptionalText(props.read_only_message) ||
      "This session is read-only for this editor.",
    contracts: {
      detail_contract: props.detail_source || props.detail_contract || null,
      create_contract: props.create_contract || null,
      save_contract: props.save_contract || props.update_contract || null,
      taxonomy_contract: props.taxonomy_contract || null,
      validate_contract: props.validate_contract || null,
      publish_contract: props.publish_contract || null,
    },
    groups,
    fields,
    json_fields: jsonFields,
    create_required_fields: Array.isArray(props.create_required_fields)
      ? props.create_required_fields
      : [],
    create_required_message:
      normalizeOptionalText(props.create_required_message) ||
      "Required fields are missing for create.",
    save_payload: {
      create_template: props.save_payload?.create_template || {},
      update_template: props.save_payload?.update_template || {},
      object_merges: Array.isArray(props.save_payload?.object_merges)
        ? props.save_payload.object_merges
        : [],
      omit_empty_paths: Array.isArray(props.save_payload?.omit_empty_paths)
        ? props.save_payload.omit_empty_paths
        : [],
    },
    actions: {
      new_label: normalizeOptionalText(props.actions?.new_label) || "New",
      refresh_label: normalizeOptionalText(props.actions?.refresh_label) || "Refresh",
      save_label: normalizeOptionalText(props.actions?.save_label) || "Save",
      save_busy_label: normalizeOptionalText(props.actions?.save_busy_label) || "Saving...",
      created_message:
        normalizeOptionalText(props.actions?.created_message) || "Record created.",
      saved_message:
        normalizeOptionalText(props.actions?.saved_message) || "Record saved.",
    },
    extra_actions: Array.isArray(props.extra_actions) ? props.extra_actions : [],
    taxonomy: {
      title: normalizeOptionalText(props.taxonomy?.title) || "Reference Lists",
      loading_title: normalizeOptionalText(props.taxonomy?.loading_title) || "Loading reference lists...",
      rows: taxonomyRows,
    },
    projection: {
      title: normalizeOptionalText(props.projection?.title) || "Current Summary",
      rows: projectionRows,
    },
    transition_designer: {
      enabled:
        props.transition_designer?.enabled === true ||
        (props.transition_designer === undefined &&
          fieldsByKey.has("graph_transitions_text") &&
          fieldsByKey.has("graph_nodes_text")),
      title: normalizeOptionalText(props.transition_designer?.title) || "Transition Designer",
      subtitle:
        normalizeOptionalText(props.transition_designer?.subtitle) ||
        "Use the guided editor to define handoffs between tasks.",
      transitions_field:
        normalizeOptionalText(props.transition_designer?.transitions_field) ||
        "graph_transitions_text",
      nodes_field:
        normalizeOptionalText(props.transition_designer?.nodes_field) || "graph_nodes_text",
      add_label: normalizeOptionalText(props.transition_designer?.add_label) || "Add Transition",
    },
    advanced_json: {
      title: normalizeOptionalText(props.advanced_json?.title) || "Advanced JSON (optional)",
      description:
        normalizeOptionalText(props.advanced_json?.description) ||
        "Use this only for complex updates.",
      selector_label: normalizeOptionalText(props.advanced_json?.selector_label) || "JSON section",
    },
    authoring_tabs: {
      enabled: props.authoring_tabs?.enabled !== false,
      default_tab: normalizeOptionalText(props.authoring_tabs?.default_tab) || "definition",
      tabs:
        (Array.isArray(props.authoring_tabs?.tabs)
          ? props.authoring_tabs.tabs.map((tab) => normalizeAuthoringTab(tab)).filter(Boolean)
          : []) || [],
    },
    flow_tree: {
      enabled: props.flow_tree?.enabled !== false,
      title: normalizeOptionalText(props.flow_tree?.title) || "Top-down Flow Tree",
      subtitle:
        normalizeOptionalText(props.flow_tree?.subtitle) ||
        "Tree view of node progression from the process start node.",
      start_label: normalizeOptionalText(props.flow_tree?.start_label) || "Start Node",
      level_label: normalizeOptionalText(props.flow_tree?.level_label) || "Level",
      no_nodes_message:
        normalizeOptionalText(props.flow_tree?.no_nodes_message) ||
        "Add tasks to display the flow tree.",
    },
    visual_builder: {
      enabled: props.visual_builder?.enabled !== false,
      title: normalizeOptionalText(props.visual_builder?.title) || "Visual Flow Canvas",
      subtitle:
        normalizeOptionalText(props.visual_builder?.subtitle) ||
        "Create tasks visually and keep the process flow in sync.",
      add_node_label:
        normalizeOptionalText(props.visual_builder?.add_node_label) || "Add Task",
      node_type_label:
        normalizeOptionalText(props.visual_builder?.node_type_label) || "Node Type",
      remove_node_label:
        normalizeOptionalText(props.visual_builder?.remove_node_label) || "Remove Task",
      no_nodes_message:
        normalizeOptionalText(props.visual_builder?.no_nodes_message) ||
        "No tasks yet. Choose a template or add the first task.",
      template_title:
        normalizeOptionalText(props.visual_builder?.template_title) || "Starter Templates",
      template_subtitle:
        normalizeOptionalText(props.visual_builder?.template_subtitle) ||
        "Apply a predefined process skeleton, then adjust tasks and transitions.",
      template_apply_label:
        normalizeOptionalText(props.visual_builder?.template_apply_label) || "Apply",
    },
    starter_templates: (
      Array.isArray(props.starter_templates)
        ? props.starter_templates
        : DEFAULT_STARTER_TEMPLATES
    )
      .map((template) => normalizeStarterTemplate(template))
      .filter(Boolean),
  };
}

function resolveSelectionTarget(ctx, targetName) {
  const target = normalizeOptionalText(targetName);
  if (target === "definition") {
    return {
      selected: ctx?.selection?.definition || null,
      select: ctx?.selection?.selectDefinition || null,
      setDetail: ctx?.selection?.setDefinitionDetail || null,
      clear: ctx?.selection?.clear || null,
    };
  }
  return {
    selected: null,
    select: null,
    setDetail: null,
    clear: null,
  };
}

function deletePathValue(target, path) {
  const keys = String(path || "")
    .split(".")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (keys.length === 0) return;
  let cursor = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!cursor[key] || typeof cursor[key] !== "object") return;
    cursor = cursor[key];
  }
  delete cursor[keys[keys.length - 1]];
}

function setPathValue(target, path, value) {
  const keys = String(path || "")
    .split(".")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (keys.length === 0) return;
  let cursor = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
}

function resolveActionContract(action, config) {
  if (action?.contract && typeof action.contract === "object") return action.contract;
  const key = normalizeOptionalText(action?.contract_key);
  if (!key) return null;
  return config.contracts[key] || null;
}

function listEntries(values) {
  if (!Array.isArray(values) || values.length === 0) return "-";
  return values
    .map((item) => normalizeOptionalText(item?.code))
    .filter(Boolean)
    .join(", ") || "-";
}

function formatProjectionValue(value, row) {
  if (value === null || value === undefined || value === "") return "-";
  if (row.format === "array_csv") {
    return Array.isArray(value) ? value.join(", ") : "-";
  }
  if (row.format === "array_object_key") {
    if (!Array.isArray(value)) return "-";
    return value
      .map((item) => normalizeOptionalText(item?.[row.item_key]))
      .filter(Boolean)
      .join(", ") || "-";
  }
  if (row.format === "json") {
    try {
      return JSON.stringify(value);
    } catch {
      return "-";
    }
  }
  return String(value);
}

function buildDefaultScopes(ctx) {
  return {
    surface: ctx?.surfaceProps || {},
    surface_meta: ctx?.surfaceMeta || {},
    available_surfaces: ctx?.availableSurfaces || [],
    selection: ctx?.selection?.definition || {},
    auth: ctx?.auth?.session || {},
  };
}

function buildEmptyDraft(config, ctx) {
  const defaultScopes = buildDefaultScopes(ctx);
  const draft = {
    id: null,
  };
  for (const field of config.fields) {
    let defaultValue = field.default_value;
    if (typeof defaultValue === "string" && defaultValue.startsWith("$")) {
      defaultValue = resolveValue(defaultValue, defaultScopes);
    }

    if (field.default_value !== undefined) {
      if (field.type === "json" && typeof defaultValue !== "string") {
        draft[field.key] = prettyJson(defaultValue, {});
      } else if (field.type === "checkbox") {
        draft[field.key] = toBoolean(defaultValue);
      } else if (field.type === "number") {
        draft[field.key] = toNumber(defaultValue, 0);
      } else {
        draft[field.key] = defaultValue ?? "";
      }
      continue;
    }

    if (field.type === "checkbox") {
      draft[field.key] = false;
    } else if (field.type === "number") {
      draft[field.key] = 0;
    } else if (field.type === "json") {
      draft[field.key] = "{}";
    } else {
      draft[field.key] = "";
    }
  }
  return draft;
}

function buildDraftFromItem(config, item, ctx) {
  const draft = buildEmptyDraft(config, ctx);
  const source = item && typeof item === "object" ? item : {};
  draft.id = source?.id || null;

  for (const field of config.fields) {
    const path = field.source_path || field.key;
    const raw = getPath(source, path);

    if (raw === undefined || raw === null) continue;

    if (field.type === "checkbox") {
      draft[field.key] = toBoolean(raw);
      continue;
    }
    if (field.type === "number") {
      draft[field.key] = toNumber(raw, 0);
      continue;
    }
    if (field.type === "json") {
      draft[field.key] = prettyJson(raw, {});
      continue;
    }
    draft[field.key] = String(raw);
  }

  return draft;
}

function buildDetailSyncFingerprint(payload) {
  const item = payload?.item && typeof payload.item === "object" ? payload.item : {};
  const id = normalizeOptionalText(item?.id);
  const updatedAt = normalizeOptionalText(item?.updated_at);
  const status = normalizeOptionalText(item?.status);
  return `${id}|${updatedAt}|${status}`;
}

function ContractDetailEditor({ node, ctx }) {
  const configKey = JSON.stringify(node?.props || {});
  const config = useMemo(() => normalizeConfig(node?.props || {}), [configKey]);
  const selectionTarget = useMemo(
    () => resolveSelectionTarget(ctx, config.selection.target),
    [
      config.selection.target,
      ctx?.selection?.clear,
      ctx?.selection?.definition,
      ctx?.selection?.selectDefinition,
      ctx?.selection?.setDefinitionDetail,
    ]
  );
  const selected = selectionTarget.selected || null;
  const selectedId = selected?.[config.selection.id_key] || selected?.id || null;
  const selectedLabel = useMemo(() => {
    if (!selectedId) return config.selection.new_label;
    const label = getPath(selected, config.selection.label_path);
    return normalizeOptionalText(label) || selectedId;
  }, [config.selection.label_path, config.selection.new_label, selected, selectedId]);

  const canWrite = hasAnyPermission(ctx?.auth?.session, config.permissions_any);

  const [payload, setPayload] = useState(null);
  const [taxonomy, setTaxonomy] = useState({});
  const [draft, setDraft] = useState(() => buildEmptyDraft(config, ctx));
  const [loading, setLoading] = useState(false);
  const [loadingTaxonomy, setLoadingTaxonomy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState("");
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [validation, setValidation] = useState(null);
  const [advancedJsonOpen, setAdvancedJsonOpen] = useState(false);
  const [activeJsonFieldKey, setActiveJsonFieldKey] = useState("");
  const [activeAuthoringTab, setActiveAuthoringTab] = useState(
    normalizeOptionalText(config.authoring_tabs?.default_tab) || "definition"
  );
  const [newNodeType, setNewNodeType] = useState("");
  const [flowInspectorTab, setFlowInspectorTab] = useState("task");
  const [selectedNodeCode, setSelectedNodeCode] = useState("");
  const [selectedTransitionIndex, setSelectedTransitionIndex] = useState(0);

  const refreshWorkbench = ctx?.workbench?.refresh;
  const refreshNonce = ctx?.workbench?.refreshNonce;
  const surfaceCode = ctx?.surfaceCode;
  const currentDetailFingerprint = useMemo(
    () => buildDetailSyncFingerprint(ctx?.selection?.detail || null),
    [ctx?.selection?.detail]
  );
  const detailFingerprintRef = useRef(currentDetailFingerprint);
  useEffect(() => {
    detailFingerprintRef.current = currentDetailFingerprint;
  }, [currentDetailFingerprint]);

  const contractCtx = useMemo(
    () => ({
      surfaceProps: ctx?.surfaceProps || {},
      surfaceMeta: ctx?.surfaceMeta || {},
      availableSurfaces: ctx?.availableSurfaces || [],
      selection: {
        definition: ctx?.selection?.definition || {},
      },
      auth: {
        session: ctx?.auth?.session || {},
      },
    }),
    [
      ctx?.auth?.session,
      ctx?.availableSurfaces,
      ctx?.selection?.definition,
      ctx?.surfaceMeta,
      ctx?.surfaceProps,
    ]
  );

  const hydrateFromPayload = useCallback(
    (nextPayload) => {
      const item = nextPayload?.item || null;
      if (!item) {
        setDraft(buildEmptyDraft(config, ctx));
        return;
      }
      setDraft(buildDraftFromItem(config, item, ctx));
    },
    [config, ctx]
  );

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setPayload(null);
      setValidation(null);
      setStatus(null);
      setError(null);
      setDraft(buildEmptyDraft(config, ctx));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const resolved = resolveContract(config.contracts.detail_contract, contractCtx, {
        pathParams: { id: selectedId },
      });
      if (!resolved) {
        setPayload(null);
        setDraft(buildEmptyDraft(config, ctx));
        setError("Details are not configured for this view.");
        return;
      }

      const nextPayload = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      setPayload(nextPayload);
      hydrateFromPayload(nextPayload);
      const nextDetailFingerprint = buildDetailSyncFingerprint(nextPayload);
      if (nextDetailFingerprint !== detailFingerprintRef.current) {
        selectionTarget.setDetail?.(nextPayload);
      }
    } catch (err) {
      setPayload(null);
      setDraft(buildEmptyDraft(config, ctx));
      setError(describeApiError(err, "Failed to load details."));
      selectionTarget.setDetail?.(null);
    } finally {
      setLoading(false);
    }
  }, [
    config,
    contractCtx,
    ctx,
    detailFingerprintRef,
    hydrateFromPayload,
    selectedId,
    selectionTarget,
  ]);

  const loadTaxonomy = useCallback(async () => {
    if (!config.contracts.taxonomy_contract || config.taxonomy.rows.length === 0) {
      setTaxonomy({});
      return;
    }
    setLoadingTaxonomy(true);
    try {
      const resolved = resolveContract(config.contracts.taxonomy_contract, contractCtx);
      if (!resolved) {
        setTaxonomy({});
        return;
      }
      const next = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      setTaxonomy(next?.lists && typeof next.lists === "object" ? next.lists : {});
    } catch {
      setTaxonomy({});
    } finally {
      setLoadingTaxonomy(false);
    }
  }, [config.contracts.taxonomy_contract, config.taxonomy.rows.length, contractCtx]);

  const loadTaxonomyRef = useRef(loadTaxonomy);
  useEffect(() => {
    loadTaxonomyRef.current = loadTaxonomy;
  }, [loadTaxonomy]);

  const loadDetailRef = useRef(loadDetail);
  useEffect(() => {
    loadDetailRef.current = loadDetail;
  }, [loadDetail]);

  useEffect(() => {
    loadTaxonomyRef.current();
  }, [refreshNonce, surfaceCode]);

  useEffect(() => {
    loadDetailRef.current();
  }, [refreshNonce, selectedId]);

  const setField = useCallback((field, value) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const jsonEditorFields = useMemo(
    () => config.fields.filter((field) => field.type === "json"),
    [config.fields]
  );

  useEffect(() => {
    if (jsonEditorFields.length === 0) {
      setActiveJsonFieldKey("");
      return;
    }
    const stillAvailable = jsonEditorFields.some((field) => field.key === activeJsonFieldKey);
    if (stillAvailable) return;
    setActiveJsonFieldKey(jsonEditorFields[0].key);
  }, [activeJsonFieldKey, jsonEditorFields]);

  const activeJsonField = useMemo(() => {
    if (!activeJsonFieldKey) return jsonEditorFields[0] || null;
    return jsonEditorFields.find((field) => field.key === activeJsonFieldKey) || jsonEditorFields[0] || null;
  }, [activeJsonFieldKey, jsonEditorFields]);

  const transitionDesignerConfig = config.transition_designer || {};
  const transitionDesignerEnabled = transitionDesignerConfig.enabled === true;
  const transitionFieldKey = transitionDesignerConfig.transitions_field;
  const nodesFieldKey = transitionDesignerConfig.nodes_field;
  const macroFieldKey = "graph_macros_text";
  const hasTransitionField = config.fields.some((field) => field.key === transitionFieldKey);
  const hasNodesField = config.fields.some((field) => field.key === nodesFieldKey);
  const hasMacroField = config.fields.some((field) => field.key === macroFieldKey);
  const showTransitionDesigner =
    transitionDesignerEnabled && hasTransitionField && hasNodesField;
  const showMacroDesigner = transitionDesignerEnabled && hasMacroField;

  const authoringTabs = useMemo(() => {
    if (config.authoring_tabs?.enabled === false) return [];
    const configuredTabs = Array.isArray(config.authoring_tabs?.tabs)
      ? config.authoring_tabs.tabs
      : [];
    const base =
          configuredTabs.length > 0
        ? configuredTabs
        : [
            { id: "definition", label: "Definition" },
            { id: "flow", label: "Flow" },
            { id: "effects", label: "Effects" },
            { id: "advanced", label: "Advanced" },
          ];
    return base.filter((tab) => {
      if (tab.id === "flow") return showTransitionDesigner;
      if (tab.id === "effects") return showMacroDesigner;
      if (tab.id === "advanced") {
        return (
          jsonEditorFields.length > 0 ||
          config.taxonomy.rows.length > 0 ||
          config.projection.rows.length > 0
        );
      }
      return true;
    });
  }, [
    config.authoring_tabs?.enabled,
    config.authoring_tabs?.tabs,
    config.projection.rows.length,
    config.taxonomy.rows.length,
    jsonEditorFields.length,
    showMacroDesigner,
    showTransitionDesigner,
  ]);

  useEffect(() => {
    if (authoringTabs.length === 0) return;
    if (authoringTabs.some((tab) => tab.id === activeAuthoringTab)) return;
    setActiveAuthoringTab(authoringTabs[0].id);
  }, [activeAuthoringTab, authoringTabs]);

  const nodesParseResult = useMemo(() => {
    if (!showTransitionDesigner) return { ok: true, value: [] };
    return parseJsonArray(
      draft[nodesFieldKey],
      config.fields.find((field) => field.key === nodesFieldKey)?.label || "Graph Nodes (JSON)"
    );
  }, [config.fields, draft, nodesFieldKey, showTransitionDesigner]);

  const transitionParseResult = useMemo(() => {
    if (!showTransitionDesigner) return { ok: true, value: [] };
    return parseJsonArray(
      draft[transitionFieldKey],
      config.fields.find((field) => field.key === transitionFieldKey)?.label ||
        "Graph Transitions (JSON)"
    );
  }, [config.fields, draft, showTransitionDesigner, transitionFieldKey]);

  const transitionNodeOptions = useMemo(() => {
    if (!nodesParseResult.ok) return [];
    return nodesParseResult.value
      .map((entry) => normalizeNodeOption(entry))
      .filter(Boolean);
  }, [nodesParseResult]);

  const transitionRows = useMemo(() => {
    if (!transitionParseResult.ok) return [];
    return transitionParseResult.value.map((row) => normalizeTransitionRow(row));
  }, [transitionParseResult]);

  const canvasNodeRows = useMemo(() => {
    if (!nodesParseResult.ok) return [];
    return nodesParseResult.value.map((node, index) => normalizeCanvasNode(node, index));
  }, [nodesParseResult]);

  useEffect(() => {
    if (canvasNodeRows.length === 0) {
      if (selectedNodeCode) setSelectedNodeCode("");
      return;
    }
    if (canvasNodeRows.some((node) => node.code === selectedNodeCode)) return;
    setSelectedNodeCode(canvasNodeRows[0].code);
  }, [canvasNodeRows, selectedNodeCode]);

  useEffect(() => {
    if (transitionRows.length === 0) {
      if (selectedTransitionIndex !== 0) setSelectedTransitionIndex(0);
      return;
    }
    if (selectedTransitionIndex >= 0 && selectedTransitionIndex < transitionRows.length) return;
    setSelectedTransitionIndex(0);
  }, [selectedTransitionIndex, transitionRows]);

  const topDownFlow = useMemo(() => {
    if (!showTransitionDesigner) return { startNode: "", levels: [] };
    if (!nodesParseResult.ok || !transitionParseResult.ok) return { startNode: "", levels: [] };
    return buildTopDownFlowView({
      nodeOptions: transitionNodeOptions,
      transitions: transitionRows,
      initialNode: draft.graph_initial_node,
    });
  }, [
    draft.graph_initial_node,
    nodesParseResult.ok,
    showTransitionDesigner,
    transitionNodeOptions,
    transitionParseResult.ok,
    transitionRows,
  ]);

  const macroParseResult = useMemo(() => {
    if (!showMacroDesigner) return { ok: true, value: {} };
    return parseJson(
      draft[macroFieldKey],
      config.fields.find((field) => field.key === macroFieldKey)?.label || "Graph Macros (JSON)",
      {}
    );
  }, [config.fields, draft, macroFieldKey, showMacroDesigner]);

  const macroRows = useMemo(() => {
    if (!macroParseResult.ok) return [];
    return parseMacroRows(macroParseResult.value);
  }, [macroParseResult]);

  const effectTypeOptions = useMemo(() => {
    const values = Array.isArray(taxonomy?.PROCESS_EFFECT_TYPE)
      ? taxonomy.PROCESS_EFFECT_TYPE
      : [];
    return values
      .map((entry) => ({
        code: normalizeOptionalText(entry?.code),
        label: normalizeOptionalText(entry?.label) || normalizeOptionalText(entry?.code),
      }))
      .filter((entry) => entry.code)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [taxonomy]);

  const nodeTypeOptions = useMemo(() => {
    const values = Array.isArray(taxonomy?.PROCESS_NODE_TYPE)
      ? taxonomy.PROCESS_NODE_TYPE
      : [];
    const normalized = values
      .map((entry) => ({
        code: normalizeOptionalText(entry?.code),
        label: normalizeOptionalText(entry?.label) || normalizeOptionalText(entry?.code),
      }))
      .filter((entry) => entry.code);
    if (normalized.length > 0) return normalized;
    return [{ code: "STEP", label: "Step" }];
  }, [taxonomy]);

  useEffect(() => {
    if (nodeTypeOptions.length === 0) return;
    if (nodeTypeOptions.some((option) => option.code === newNodeType)) return;
    setNewNodeType(nodeTypeOptions[0].code);
  }, [newNodeType, nodeTypeOptions]);

  const transitionMacroOptions = useMemo(
    () =>
      macroRows
        .map((row) => ({
          code: normalizeOptionalText(row.code),
          label: normalizeOptionalText(row.label) || normalizeOptionalText(row.code),
        }))
        .filter((row) => row.code),
    [macroRows]
  );

  const syncTransitionRows = useCallback(
    (rows) => {
      const next = rows.map((row) => {
        const transition = {
          from: normalizeOptionalText(row?.from),
          to: normalizeOptionalText(row?.to),
        };
        const action = normalizeOptionalText(row?.action);
        const taskLabel = normalizeOptionalText(row?.taskLabel);
        const macroCode = normalizeOptionalText(row?.macroCode);
        const effectCode = normalizeOptionalText(row?.effect);
        if (action) transition.action = action;
        if (taskLabel) transition.task_label = taskLabel;
        if (macroCode) transition.macro_code = macroCode;
        if (effectCode) transition.effect_code = effectCode;
        const label = normalizeOptionalText(row?.label);
        if (label) {
          transition.label = label;
        }
        return transition;
      });
      setField(transitionFieldKey, prettyJson(next, []));
    },
    [setField, transitionFieldKey]
  );

  const syncNodeRows = useCallback(
    (rows, transitionsOverride) => {
      const nextNodes = buildCanvasNodePayload(rows);
      setField(nodesFieldKey, prettyJson(nextNodes, []));

      const validNodeCodes = new Set(
        nextNodes
          .map((node) => normalizeOptionalText(node.id || node.code))
          .filter(Boolean)
      );
      const candidateTransitions = Array.isArray(transitionsOverride)
        ? transitionsOverride
        : transitionRows;
      const filteredTransitions = candidateTransitions.filter((row) => {
        const from = normalizeOptionalText(row?.from);
        const to = normalizeOptionalText(row?.to);
        if (!from || !to) return true;
        if (validNodeCodes.size === 0) return true;
        return validNodeCodes.has(from) && validNodeCodes.has(to);
      });
      if (filteredTransitions.length !== candidateTransitions.length || transitionsOverride) {
        syncTransitionRows(filteredTransitions);
      }

      const currentInitial = normalizeOptionalText(draft.graph_initial_node);
      if (!currentInitial || !validNodeCodes.has(currentInitial)) {
        const nextInitial = normalizeOptionalText(nextNodes[0]?.id);
        setField("graph_initial_node", nextInitial);
      }
    },
    [draft.graph_initial_node, nodesFieldKey, setField, syncTransitionRows, transitionRows]
  );

  const updateTransitionRow = useCallback(
    (index, patch) => {
      const nextRows = transitionRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      );
      syncTransitionRows(nextRows);
    },
    [syncTransitionRows, transitionRows]
  );

  const removeTransitionRow = useCallback(
    (index) => {
      const nextRows = transitionRows.filter((_, rowIndex) => rowIndex !== index);
      syncTransitionRows(nextRows);
    },
    [syncTransitionRows, transitionRows]
  );

  const addTransitionRow = useCallback(() => {
    const firstNode = transitionNodeOptions[0]?.code || "";
    syncTransitionRows([
      ...transitionRows,
      {
        from: firstNode,
        to: firstNode,
        action: "",
        taskLabel: "",
        macroCode: transitionMacroOptions[0]?.code || "",
        effect: "",
        label: "",
      },
    ]);
  }, [syncTransitionRows, transitionMacroOptions, transitionNodeOptions, transitionRows]);

  const updateCanvasNodeRow = useCallback(
    (index, patch) => {
      const current = canvasNodeRows[index];
      if (!current) return;
      const nextRows = canvasNodeRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      );
      const previousCode = normalizeOptionalText(current.code);
      const nextCode = normalizeOptionalText(nextRows[index]?.code) || previousCode;
      const nextTransitions =
        previousCode && nextCode && previousCode !== nextCode
          ? transitionRows.map((row) => ({
              ...row,
              from: row.from === previousCode ? nextCode : row.from,
              to: row.to === previousCode ? nextCode : row.to,
            }))
          : transitionRows;
      syncNodeRows(nextRows, nextTransitions);
    },
    [canvasNodeRows, syncNodeRows, transitionRows]
  );

  const addCanvasNodeRow = useCallback(() => {
    const nodeType = normalizeOptionalText(newNodeType) || nodeTypeOptions[0]?.code || "STEP";
    const code = createUniqueNodeCode(canvasNodeRows, nodeType);
    const labelOption = nodeTypeOptions.find((entry) => entry.code === nodeType);
    const label = normalizeOptionalText(labelOption?.label) || nodeType;
    syncNodeRows([
      ...canvasNodeRows,
      {
        code,
        type: nodeType,
        label,
        isTerminal: false,
        taskTemplatesText: "",
      },
    ]);
  }, [canvasNodeRows, newNodeType, nodeTypeOptions, syncNodeRows]);

  const removeCanvasNodeRow = useCallback(
    (index) => {
      const current = canvasNodeRows[index];
      if (!current) return;
      const code = normalizeOptionalText(current.code);
      const nextRows = canvasNodeRows.filter((_, rowIndex) => rowIndex !== index);
      const nextTransitions = transitionRows.filter(
        (row) => normalizeOptionalText(row.from) !== code && normalizeOptionalText(row.to) !== code
      );
      syncNodeRows(nextRows, nextTransitions);
    },
    [canvasNodeRows, syncNodeRows, transitionRows]
  );

  const starterTemplates = useMemo(
    () => config.starter_templates || [],
    [config.starter_templates]
  );

  const applyStarterTemplate = useCallback(
    (templateId) => {
      const template = starterTemplates.find((entry) => entry.id === templateId);
      if (!template) return;
      const nextNodes = template.nodes.map((node, index) => normalizeCanvasNode(node, index));
      const nextTransitions = template.transitions.map((row) => normalizeTransitionRow(row));
      syncNodeRows(nextNodes, nextTransitions);
      if (showMacroDesigner) {
        setField(macroFieldKey, prettyJson(template.macros || {}, {}));
      }
      if (template.initialNode) {
        setField("graph_initial_node", template.initialNode);
      }
      if (template.objectType) {
        setField("object_type", template.objectType);
      }
      if (template.serviceObjectCategory) {
        setField("service_object_category", template.serviceObjectCategory);
      }
      setStatus(`Template applied: ${template.label}`);
      setActiveAuthoringTab("flow");
    },
    [
      macroFieldKey,
      setField,
      showMacroDesigner,
      starterTemplates,
      syncNodeRows,
    ]
  );

  const syncMacroRows = useCallback(
    (rows) => {
      const payload = buildMacroPayload(rows);
      if (!payload.ok) {
        setStatus(payload.error);
        return false;
      }
      setField(macroFieldKey, prettyJson(payload.value, {}));
      return true;
    },
    [macroFieldKey, setField]
  );

  const updateMacroRow = useCallback(
    (index, patch) => {
      const nextRows = macroRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      );
      syncMacroRows(nextRows);
    },
    [macroRows, syncMacroRows]
  );

  const removeMacroRow = useCallback(
    (index) => {
      const nextRows = macroRows.filter((_, rowIndex) => rowIndex !== index);
      syncMacroRows(nextRows);
    },
    [macroRows, syncMacroRows]
  );

  const addMacroRow = useCallback(() => {
    const usedCodes = new Set(macroRows.map((row) => normalizeOptionalText(row.code)));
    let counter = macroRows.length + 1;
    let nextCode = `macro_${counter}`;
    while (usedCodes.has(nextCode)) {
      counter += 1;
      nextCode = `macro_${counter}`;
    }
    syncMacroRows([
      ...macroRows,
      {
        code: nextCode,
        label: `Macro ${counter}`,
        effects: [],
      },
    ]);
  }, [macroRows, syncMacroRows]);

  const updateMacroEffect = useCallback(
    (macroIndex, effectIndex, patch) => {
      const nextRows = macroRows.map((row, rowIndex) => {
        if (rowIndex !== macroIndex) return row;
        const effects = (row.effects || []).map((effectRow, currentIndex) =>
          currentIndex === effectIndex ? { ...effectRow, ...patch } : effectRow
        );
        return { ...row, effects };
      });
      syncMacroRows(nextRows);
    },
    [macroRows, syncMacroRows]
  );

  const addMacroEffect = useCallback(
    (macroIndex) => {
      const defaultEffectType = effectTypeOptions[0]?.code || "";
      const nextRows = macroRows.map((row, rowIndex) => {
        if (rowIndex !== macroIndex) return row;
        return {
          ...row,
          effects: [
            ...(Array.isArray(row.effects) ? row.effects : []),
            {
              type: defaultEffectType,
              serviceObjectType: normalizeOptionalText(draft.object_type),
              serviceObjectCategory: normalizeOptionalText(draft.service_object_category),
              configText: "{}",
            },
          ],
        };
      });
      syncMacroRows(nextRows);
    },
    [draft.object_type, draft.service_object_category, effectTypeOptions, macroRows, syncMacroRows]
  );

  const removeMacroEffect = useCallback(
    (macroIndex, effectIndex) => {
      const nextRows = macroRows.map((row, rowIndex) => {
        if (rowIndex !== macroIndex) return row;
        const effects = (row.effects || []).filter((_, currentIndex) => currentIndex !== effectIndex);
        return { ...row, effects };
      });
      syncMacroRows(nextRows);
    },
    [macroRows, syncMacroRows]
  );

  const processLayerSummary = useMemo(() => {
    const taskLabels = transitionRows
      .map((row) => normalizeOptionalText(row.taskLabel))
      .filter(Boolean);
    const macroCodes = macroRows.map((row) => normalizeOptionalText(row.code)).filter(Boolean);
    const effectCodes = macroRows.flatMap((row) =>
      (Array.isArray(row.effects) ? row.effects : [])
        .map((effect) => normalizeOptionalText(effect.type))
        .filter(Boolean)
    );

    return {
      process: normalizeOptionalText(draft.name) || normalizeOptionalText(draft.code) || "-",
      taskLabel: taskLabels.length > 0 ? Array.from(new Set(taskLabels)).join(", ") : "-",
      macro: macroCodes.length > 0 ? Array.from(new Set(macroCodes)).join(", ") : "-",
      effect: effectCodes.length > 0 ? Array.from(new Set(effectCodes)).join(", ") : "-",
      serviceObject:
        normalizeOptionalText(draft.object_type) || normalizeOptionalText(draft.service_object_category)
          ? `${normalizeOptionalText(draft.object_type) || "-"} / ${normalizeOptionalText(draft.service_object_category) || "-"}`
          : "-",
    };
  }, [draft.code, draft.name, draft.object_type, draft.service_object_category, macroRows, transitionRows]);

  const resetForNew = useCallback(() => {
    setPayload(null);
    setValidation(null);
    setStatus(null);
    setError(null);
    setDraft(buildEmptyDraft(config, ctx));
    selectionTarget.select?.(null);
    selectionTarget.setDetail?.(null);
    if (!selectionTarget.select && typeof selectionTarget.clear === "function") {
      selectionTarget.clear();
    }
  }, [config, ctx, selectionTarget]);

  const parseJsonFields = useCallback(() => {
    const parsed = {};
    for (const field of config.json_fields) {
      const result = parseJson(draft[field.key], field.label, field.fallback);
      if (!result.ok) return result;
      parsed[field.key] = result.value;
    }
    return { ok: true, value: parsed };
  }, [config.json_fields, draft]);

  const buildSavePayload = useCallback(() => {
    const parsedJson = parseJsonFields();
    if (!parsedJson.ok) return parsedJson;

    const template = selectedId
      ? config.save_payload.update_template
      : config.save_payload.create_template;

    const scopes = {
      surface: ctx?.surfaceProps || {},
      surface_meta: ctx?.surfaceMeta || {},
      available_surfaces: ctx?.availableSurfaces || [],
      selection: selected || {},
      auth: ctx?.auth?.session || {},
      draft,
      json: parsedJson.value,
    };

    const resolved = resolveValue(template || {}, scopes);
    const output = resolved && typeof resolved === "object" ? { ...resolved } : {};

    for (const merge of config.save_payload.object_merges) {
      const targetPath = normalizeOptionalText(merge?.target_path);
      if (!targetPath) continue;

      const existing = getPath(output, targetPath);
      const targetObject =
        existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};

      const jsonFieldKey = normalizeOptionalText(merge?.from_json_field);
      if (jsonFieldKey) {
        const parsedValue = parsedJson.value?.[jsonFieldKey];
        if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
          Object.assign(targetObject, parsedValue);
        }
      }

      if (merge?.merge_template && typeof merge.merge_template === "object") {
        const mergeValue = resolveValue(merge.merge_template, scopes);
        if (mergeValue && typeof mergeValue === "object" && !Array.isArray(mergeValue)) {
          Object.assign(targetObject, mergeValue);
        }
      }

      setPathValue(output, targetPath, targetObject);
    }

    for (const path of config.save_payload.omit_empty_paths) {
      const value = getPath(output, path);
      if (value === undefined || value === null || normalizeText(value) === "") {
        deletePathValue(output, path);
      }
    }
    return { ok: true, value: output };
  }, [config.save_payload, ctx, draft, parseJsonFields, selected, selectedId]);

  const saveDefinition = useCallback(async () => {
    if (!canWrite) {
      setStatus(config.read_only_message);
      return;
    }

    if (!selectedId) {
      const missing = config.create_required_fields.find(
        (field) => normalizeText(draft[field]) === ""
      );
      if (missing) {
        setStatus(config.create_required_message);
        return;
      }
    }

    const payloadResult = buildSavePayload();
    if (!payloadResult.ok) {
      setStatus(payloadResult.error);
      return;
    }

    const contract = selectedId ? config.contracts.save_contract : config.contracts.create_contract;
    const resolved = resolveContract(contract, contractCtx, {
      pathParams: { id: draft.id || selectedId || undefined },
    });
    if (!resolved) {
      setStatus("Save settings are missing for this panel.");
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const response = await apiFetch(resolved.pathWithQuery, {
        method: resolved.method,
        body: payloadResult.value,
      });
      const item = response?.item || null;
      if (item?.id) {
        selectionTarget.select?.(item);
        setPayload((prev) => ({ ...(prev || {}), item }));
        setDraft(buildDraftFromItem(config, item, ctx));
      }
      setStatus(selectedId ? config.actions.saved_message : config.actions.created_message);
      refreshWorkbench?.();
      if (selectedId) {
        await loadDetail();
      }
    } catch (err) {
      setStatus(describeApiError(err, "Unable to save right now."));
    } finally {
      setSaving(false);
    }
  }, [
    buildSavePayload,
    canWrite,
    config,
    contractCtx,
    draft,
    loadDetail,
    refreshWorkbench,
    selectedId,
    selectionTarget,
    ctx,
  ]);

  const runExtraAction = useCallback(
    async (action) => {
      if (action.requires_write === true && !canWrite) {
        setStatus(config.read_only_message);
        return;
      }
      if (action.requires_existing === true && !draft.id) {
        setStatus(
          normalizeOptionalText(action.requires_existing_message) ||
            "Save the draft first before running this action."
        );
        return;
      }

      const contract = resolveActionContract(action, config);
      const resolved = resolveContract(contract, contractCtx, {
        pathParams: { id: draft.id || selectedId || undefined },
      });
      if (!resolved) {
        setStatus(
          normalizeOptionalText(action.contract_error_message) ||
            "This action is not configured yet."
        );
        return;
      }

      setBusyActionKey(action.key || action.label || "action");
      setStatus(null);
      try {
        const result = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
        if (normalizeOptionalText(action.store_result_as) === "validation") {
          setValidation(result);
        }

        if (action.patch_draft && typeof action.patch_draft === "object") {
          const patch = resolveValue(action.patch_draft, {
            draft,
            response: result || {},
          });
          if (patch && typeof patch === "object") {
            setDraft((prev) => ({ ...prev, ...patch }));
          }
        }

        if (action.status_from_result_valid === true) {
          if (result?.valid === true) {
            setStatus(normalizeOptionalText(action.valid_message) || "Validation passed.");
          } else {
            setStatus(
              normalizeOptionalText(action.invalid_message) ||
                "Validation failed. Review returned errors."
            );
          }
        } else {
          setStatus(normalizeOptionalText(action.success_message) || "Action completed.");
        }

        if (action.refresh_workbench === true) {
          refreshWorkbench?.();
        }
        if (action.reload_on_success === true) {
          await loadDetail();
        }
      } catch (err) {
        setStatus(describeApiError(err, normalizeOptionalText(action.failure_message) || "Action failed."));
      } finally {
        setBusyActionKey("");
      }
    },
    [canWrite, config, contractCtx, draft, loadDetail, refreshWorkbench, selectedId]
  );

  const groupedFields = useMemo(() => {
    const grouped = new Map(config.groups.map((group) => [group.id, []]));
    for (const field of config.fields) {
      if (!grouped.has(field.group)) {
        grouped.set(field.group, []);
      }
      grouped.get(field.group).push(field);
    }
    return grouped;
  }, [config.fields, config.groups]);

  const item = payload?.item || null;
  const validationErrors = Array.isArray(validation?.errors) ? validation.errors : [];
  const showLoadingNotice = loading && !item;
  const tabsEnabled = authoringTabs.length > 0;
  const showDefinitionTab = !tabsEnabled || activeAuthoringTab === "definition";
  const showFlowTab = !tabsEnabled || activeAuthoringTab === "flow";
  const showEffectsTab = !tabsEnabled || activeAuthoringTab === "effects";
  const showAdvancedTab = !tabsEnabled || activeAuthoringTab === "advanced";
  const selectedCanvasNodeIndex = useMemo(
    () => canvasNodeRows.findIndex((node) => node.code === selectedNodeCode),
    [canvasNodeRows, selectedNodeCode]
  );
  const selectedCanvasNode = useMemo(
    () => (selectedCanvasNodeIndex >= 0 ? canvasNodeRows[selectedCanvasNodeIndex] : null),
    [canvasNodeRows, selectedCanvasNodeIndex]
  );
  const selectedTransitionRow =
    transitionRows[selectedTransitionIndex] && selectedTransitionIndex >= 0
      ? transitionRows[selectedTransitionIndex]
      : null;
  const workbenchSetPanelTab =
    typeof ctx?.workbench?.setPanelTab === "function" ? ctx.workbench.setPanelTab : null;

  const openWorkbenchPanelTab = useCallback(
    (tabCode) => {
      if (!workbenchSetPanelTab) {
        setStatus("Right-side panel tab control is unavailable on this surface.");
        return;
      }
      workbenchSetPanelTab(tabCode);
      setStatus(`Opened ${tabCode} panel.`);
    },
    [workbenchSetPanelTab]
  );

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{config.eyebrow}</p>
          <h3>{config.title}</h3>
          <p className="muted">Current: {selectedLabel}</p>
        </div>
        <div className="inline-actions">
          <MiniHelp text="Start a new process definition draft.">
            <button type="button" className="ghost-button icon-button" onClick={resetForNew} disabled={!canWrite}>
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              <span>{config.actions.new_label}</span>
            </button>
          </MiniHelp>
          <MiniHelp text="Reload the latest saved definition details.">
            <button type="button" className="ghost-button icon-button" onClick={loadDetail} disabled={loading}>
              <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
              <span>{config.actions.refresh_label}</span>
            </button>
          </MiniHelp>
          <MiniHelp text="Save all changes made in this definition.">
            <button
              type="button"
              className="primary-button icon-button"
              onClick={saveDefinition}
              disabled={!canWrite || saving || loading}
            >
              <Save size={14} strokeWidth={2} aria-hidden="true" />
              <span>{saving ? config.actions.save_busy_label : config.actions.save_label}</span>
            </button>
          </MiniHelp>
          {config.extra_actions.map((action) => {
            const key = action.key || action.label || "action";
            const busy = busyActionKey === key;
            const needsExisting = action.requires_existing === true && !draft.id;
            const needsWrite = action.requires_write === true && !canWrite;
            return (
              <button
                key={key}
                type="button"
                className={action.primary === true ? "primary-button" : "ghost-button"}
                onClick={() => runExtraAction(action)}
                disabled={busy || saving || needsExisting || needsWrite}
              >
                {busy
                  ? normalizeOptionalText(action.busy_label) || "Running..."
                  : normalizeOptionalText(action.label) || "Run"}
              </button>
            );
          })}
        </div>
      </div>

      {!canWrite ? (
        <StateNotice kind="warning" title="Read-only mode" message={config.read_only_message} />
      ) : null}
      {showLoadingNotice ? <StateNotice title="Loading details..." /> : null}
      {error ? <StateNotice kind="error" title="Detail error" message={error} /> : null}
      {status ? (
        <StateNotice title={status} kind={validation?.valid === false ? "warning" : "info"} />
      ) : null}
      {validation?.valid === false && validationErrors.length > 0 ? (
        <StateNotice kind="error" title="Validation errors" message={validationErrors.join(", ")} />
      ) : null}

      <div className="stack">
        {tabsEnabled ? (
          <div className="tabs-shell process-authoring-tabs">
            <div className="tabs-header">
              <div className="tabs-bar">
                {authoringTabs.map((tab) => (
                  <MiniHelp key={tab.id} text={`Open ${tab.label}.`}>
                    <button
                      type="button"
                      className={activeAuthoringTab === tab.id ? "tab-button active" : "tab-button"}
                      onClick={() => setActiveAuthoringTab(tab.id)}
                    >
                      <span className="tab-icon" aria-hidden="true">
                        {renderMappedIcon(AUTHORING_TAB_ICONS, tab.id, tab.label)}
                      </span>
                      <span>{tab.label}</span>
                    </button>
                  </MiniHelp>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {showDefinitionTab ? (
          <>
            {config.groups.map((group) => {
              const fields = groupedFields.get(group.id) || [];
              const displayFields = fields.filter((field) => field.type !== "json");
              if (displayFields.length === 0) return null;
              return (
                <div key={group.id} className={group.layout_class}>
                  {group.title ? <h4>{group.title}</h4> : null}
                  {displayFields.map((field) => {
                    const value = draft[field.key];
                    const disabled = field.disabled_when_existing && Boolean(draft.id);
                    if (field.type === "checkbox") {
                      return (
                        <label key={field.key} className="form-toggle">
                          <input
                            type="checkbox"
                            checked={toBoolean(value)}
                            onChange={(event) => setField(field.key, event.target.checked)}
                            disabled={disabled}
                          />
                          <span>{field.label}</span>
                        </label>
                      );
                    }

                    if (field.type === "textarea" || field.type === "json") {
                      return (
                        <label key={field.key} className="form-field">
                          <span>{field.label}</span>
                          <textarea
                            aria-label={field.label}
                            rows={field.rows || 6}
                            value={value ?? ""}
                            placeholder={field.placeholder || ""}
                            onChange={(event) => setField(field.key, event.target.value)}
                            disabled={disabled}
                          />
                        </label>
                      );
                    }

                    return (
                      <label key={field.key} className="form-field">
                        <span>{field.label}</span>
                        <input
                          aria-label={field.label}
                          type={field.type === "number" ? "number" : "text"}
                          value={value ?? ""}
                          placeholder={field.placeholder || ""}
                          onChange={(event) => {
                            if (field.type === "number") {
                              setField(field.key, toNumber(event.target.value, 0));
                              return;
                            }
                            setField(field.key, event.target.value);
                          }}
                          disabled={disabled}
                        />
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </>
        ) : null}

        {showAdvancedTab && jsonEditorFields.length > 0 ? (
          <div className="advanced-json-panel">
            <div className="card-header advanced-json-header">
              <div>
                <p className="eyebrow">Advanced</p>
                <h4>{config.advanced_json.title}</h4>
                <p className="muted">{config.advanced_json.description}</p>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setAdvancedJsonOpen((prev) => !prev)}
              >
                {advancedJsonOpen ? "Hide JSON" : "Show JSON"}
              </button>
            </div>

            {advancedJsonOpen && activeJsonField ? (
              <div className="stack">
                {jsonEditorFields.length > 1 ? (
                  <label className="form-field">
                    <span>{config.advanced_json.selector_label}</span>
                    <select
                      value={activeJsonField.key}
                      onChange={(event) => setActiveJsonFieldKey(event.target.value)}
                    >
                      {jsonEditorFields.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="form-field">
                  <span>{activeJsonField.label}</span>
                  <textarea
                    aria-label={activeJsonField.label}
                    rows={activeJsonField.rows || 8}
                    value={draft[activeJsonField.key] ?? ""}
                    placeholder={activeJsonField.placeholder || ""}
                    onChange={(event) => setField(activeJsonField.key, event.target.value)}
                    disabled={activeJsonField.disabled_when_existing && Boolean(draft.id)}
                  />
                </label>
              </div>
            ) : null}
          </div>
        ) : null}

        {showFlowTab && showTransitionDesigner ? (
          <>
            {config.visual_builder.enabled ? (
              <div className="process-template-strip">
                <div className="card-header transition-designer-header">
                  <div>
                    <p className="eyebrow">Quick Start</p>
                    <h4>{config.visual_builder.template_title}</h4>
                    <p className="muted">{config.visual_builder.template_subtitle}</p>
                  </div>
                </div>
                <div className="process-template-grid">
                  {starterTemplates.map((template) => (
                    <article key={template.id} className="process-template-card">
                      <strong>{template.label}</strong>
                      <p>{template.description || "Predefined task flow template."}</p>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => applyStarterTemplate(template.id)}
                        disabled={!canWrite}
                      >
                        {config.visual_builder.template_apply_label}
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="process-workspace-grid">
              <div className="process-canvas-shell process-canvas-shell--v1">
                <div className="card-header transition-designer-header">
                  <div>
                    <p className="eyebrow">Builder Canvas</p>
                    <h4>{config.visual_builder.title}</h4>
                    <p className="muted">{config.visual_builder.subtitle}</p>
                  </div>
                  <div className="inline-actions">
                    <label className="process-canvas-filter">
                      <span>{config.visual_builder.node_type_label}</span>
                      <select
                        value={newNodeType}
                        onChange={(event) => setNewNodeType(event.target.value)}
                        disabled={!canWrite}
                      >
                        {nodeTypeOptions.map((option) => (
                          <option key={`node-type-${option.code}`} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <MiniHelp text="Add a new task node to the flow canvas.">
                      <button
                        type="button"
                        className="ghost-button icon-button"
                        onClick={addCanvasNodeRow}
                        disabled={!canWrite || !nodesParseResult.ok}
                      >
                        <Plus size={14} strokeWidth={2} aria-hidden="true" />
                        <span>{config.visual_builder.add_node_label}</span>
                      </button>
                    </MiniHelp>
                  </div>
                </div>

                {!nodesParseResult.ok ? (
                  <StateNotice kind="warning" title="Node JSON error" message={nodesParseResult.error} />
                ) : canvasNodeRows.length === 0 ? (
                  <StateNotice title={config.visual_builder.no_nodes_message} />
                ) : (
                  <div className="process-canvas-lane">
                    {canvasNodeRows.map((nodeRow, nodeIndex) => {
                      const active = nodeRow.code === selectedNodeCode;
                      return (
                        <button
                          key={`${nodeRow.code}-${nodeIndex}`}
                          type="button"
                          className={active ? "process-canvas-row active" : "process-canvas-row"}
                          onClick={() => {
                            setSelectedNodeCode(nodeRow.code);
                            setFlowInspectorTab("task");
                          }}
                          >
                            <span className="process-canvas-row-icon">
                              {renderNodeTypeIcon(nodeRow.type, nodeRow.isTerminal)}
                            </span>
                            <span className="process-canvas-row-meta">
                            <strong>{nodeRow.label || nodeRow.code}</strong>
                            <small>{nodeRow.type || "STEP"}</small>
                          </span>
                          <span className="process-canvas-row-status">
                            {nodeRow.isTerminal ? "Terminal" : "Active"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <aside className="process-inspector-shell">
                <div className="process-inspector-tabs">
                  {[
                    { id: "task", label: "Task Definition" },
                    { id: "node", label: "Node Inspector" },
                    { id: "transition", label: "Transition Inspector" },
                    { id: "templates", label: "Task Templates" },
                    { id: "bindings", label: "Process Bindings" },
                  ].map((tab) => (
                    <MiniHelp key={tab.id} text={`Open ${tab.label}.`}>
                      <button
                        type="button"
                        className={flowInspectorTab === tab.id ? "tab-button active" : "tab-button"}
                        onClick={() => setFlowInspectorTab(tab.id)}
                      >
                        <span className="tab-icon" aria-hidden="true">
                          {renderMappedIcon(FLOW_INSPECTOR_ICONS, tab.id, tab.label)}
                        </span>
                        <span>{tab.label}</span>
                      </button>
                    </MiniHelp>
                  ))}
                </div>

                <div className="process-inspector-body">
                  {flowInspectorTab === "task" ? (
                    selectedCanvasNode ? (
                      <div className="stack">
                        <h4>Task Definition</h4>
                        <label className="form-field">
                          <span>Task Code</span>
                          <input
                            value={selectedCanvasNode.code}
                            onChange={(event) =>
                              updateCanvasNodeRow(selectedCanvasNodeIndex, { code: event.target.value })
                            }
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="form-field">
                          <span>Task Label</span>
                          <input
                            value={selectedCanvasNode.label}
                            onChange={(event) =>
                              updateCanvasNodeRow(selectedCanvasNodeIndex, { label: event.target.value })
                            }
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="form-field">
                          <span>Task Template Types</span>
                          <textarea
                            rows={4}
                            value={selectedCanvasNode.taskTemplatesText || ""}
                            onChange={(event) =>
                              updateCanvasNodeRow(selectedCanvasNodeIndex, {
                                taskTemplatesText: event.target.value,
                              })
                            }
                            disabled={!canWrite}
                          />
                        </label>
                        <p className="muted">
                          Task details are node-level. Process-level identity stays in the Definition tab.
                        </p>
                      </div>
                    ) : (
                      <StateNotice title="Select a task on the canvas to edit task-level details." />
                    )
                  ) : null}

                  {flowInspectorTab === "node" ? (
                    selectedCanvasNode ? (
                      <div className="stack">
                        <h4>Node Inspector</h4>
                        <label className="form-field">
                          <span>Node Code</span>
                          <input
                            value={selectedCanvasNode.code}
                            onChange={(event) =>
                              updateCanvasNodeRow(
                                canvasNodeRows.findIndex((node) => node.code === selectedCanvasNode.code),
                                { code: event.target.value }
                              )
                            }
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="form-field">
                          <span>Label</span>
                          <input
                            value={selectedCanvasNode.label}
                            onChange={(event) =>
                              updateCanvasNodeRow(
                                canvasNodeRows.findIndex((node) => node.code === selectedCanvasNode.code),
                                { label: event.target.value }
                              )
                            }
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="form-field">
                          <span>Type</span>
                          <select
                            value={selectedCanvasNode.type}
                            onChange={(event) =>
                              updateCanvasNodeRow(
                                canvasNodeRows.findIndex((node) => node.code === selectedCanvasNode.code),
                                { type: event.target.value }
                              )
                            }
                            disabled={!canWrite}
                          >
                            {nodeTypeOptions.map((option) => (
                              <option key={`inspect-node-${option.code}`} value={option.code}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-toggle">
                          <input
                            type="checkbox"
                            checked={selectedCanvasNode.isTerminal === true}
                            onChange={(event) =>
                              updateCanvasNodeRow(
                                canvasNodeRows.findIndex((node) => node.code === selectedCanvasNode.code),
                                { isTerminal: event.target.checked }
                              )
                            }
                            disabled={!canWrite}
                          />
                          <span>Terminal node</span>
                        </label>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            removeCanvasNodeRow(
                              canvasNodeRows.findIndex((node) => node.code === selectedCanvasNode.code)
                            )
                          }
                          disabled={!canWrite}
                        >
                          {config.visual_builder.remove_node_label}
                        </button>
                      </div>
                    ) : (
                      <StateNotice title="Select a node on the canvas." />
                    )
                  ) : null}

                  {flowInspectorTab === "transition" ? (
                    selectedTransitionRow ? (
                      <div className="stack">
                        <h4>Transition Inspector</h4>
                        <label className="form-field">
                          <span>From</span>
                          <select
                            value={selectedTransitionRow.from}
                            onChange={(event) =>
                              updateTransitionRow(selectedTransitionIndex, { from: event.target.value })
                            }
                          >
                            <option value="">Select</option>
                            {transitionNodeOptions.map((option) => (
                              <option key={`transition-from-${option.code}`} value={option.code}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-field">
                          <span>To</span>
                          <select
                            value={selectedTransitionRow.to}
                            onChange={(event) =>
                              updateTransitionRow(selectedTransitionIndex, { to: event.target.value })
                            }
                          >
                            <option value="">Select</option>
                            {transitionNodeOptions.map((option) => (
                              <option key={`transition-to-${option.code}`} value={option.code}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-field">
                          <span>Task Label</span>
                          <input
                            value={selectedTransitionRow.taskLabel}
                            onChange={(event) =>
                              updateTransitionRow(selectedTransitionIndex, { taskLabel: event.target.value })
                            }
                          />
                        </label>
                        <label className="form-field">
                          <span>Macro</span>
                          <select
                            value={selectedTransitionRow.macroCode}
                            onChange={(event) =>
                              updateTransitionRow(selectedTransitionIndex, { macroCode: event.target.value })
                            }
                          >
                            <option value="">Select macro</option>
                            {transitionMacroOptions.map((option) => (
                              <option key={`transition-macro-${option.code}`} value={option.code}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-field">
                          <span>Optional Fallback Effect</span>
                          <input
                            value={selectedTransitionRow.effect}
                            onChange={(event) =>
                              updateTransitionRow(selectedTransitionIndex, { effect: event.target.value })
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => removeTransitionRow(selectedTransitionIndex)}
                          disabled={!canWrite}
                        >
                          Remove Transition
                        </button>
                      </div>
                    ) : (
                      <StateNotice title="Select a transition from the transition list." />
                    )
                  ) : null}

                  {flowInspectorTab === "templates" ? (
                    <div className="stack">
                      <h4>Task Templates</h4>
                      <p className="muted">
                        Open the task template tab to manage reusable task blueprints.
                      </p>
                      <button
                        type="button"
                        className="ghost-button icon-button"
                        onClick={() => openWorkbenchPanelTab("templates")}
                      >
                        <LayoutTemplate size={14} strokeWidth={2} aria-hidden="true" />
                        <span>Go to Task Templates</span>
                      </button>
                    </div>
                  ) : null}

                  {flowInspectorTab === "bindings" ? (
                    <div className="stack">
                      <h4>Process Bindings</h4>
                      <p className="muted">
                        Open process bindings to map this flow to business entry points.
                      </p>
                      <button
                        type="button"
                        className="ghost-button icon-button"
                        onClick={() => openWorkbenchPanelTab("bindings")}
                      >
                        <Link size={14} strokeWidth={2} aria-hidden="true" />
                        <span>Go to Process Bindings</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </aside>
            </div>

            <div className="transition-designer transition-designer--v1">
              <div className="card-header transition-designer-header">
                <div>
                  <p className="eyebrow">Transitions</p>
                  <h4>{transitionDesignerConfig.title}</h4>
                  <p className="muted">{transitionDesignerConfig.subtitle}</p>
                </div>
                <div className="inline-actions">
                  <MiniHelp text="Create a new transition between two tasks.">
                    <button
                      type="button"
                      className="ghost-button icon-button"
                      onClick={addTransitionRow}
                      disabled={!canWrite || !transitionParseResult.ok}
                    >
                      <Plus size={14} strokeWidth={2} aria-hidden="true" />
                      <span>{transitionDesignerConfig.add_label}</span>
                    </button>
                  </MiniHelp>
                </div>
              </div>
              {!transitionParseResult.ok ? (
                <StateNotice
                  kind="warning"
                  title="Transition JSON error"
                  message={`${transitionParseResult.error} Correct advanced data to continue with guided editing.`}
                />
              ) : transitionRows.length === 0 ? (
                <StateNotice title="No transitions configured." />
              ) : (
                <div className="transition-list">
                  {transitionRows.map((row, index) => {
                    const active = index === selectedTransitionIndex;
                    return (
                      <button
                        key={`transition-row-${index}`}
                        type="button"
                        className={active ? "transition-list-row active" : "transition-list-row"}
                        onClick={() => {
                          setSelectedTransitionIndex(index);
                          setFlowInspectorTab("transition");
                        }}
                      >
                        <strong>
                          {row.from || "?"} {"->"} {row.to || "?"}
                        </strong>
                        <small>
                          {row.taskLabel || "Task"} | {row.macroCode || "No macro"} |{" "}
                          {row.effect || "No fallback effect"}
                        </small>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="process-layer-guide">
              <div className="card-header transition-designer-header">
                <div>
                  <p className="eyebrow">Canonical Model</p>
                  <h4>5-layer Process Definition</h4>
                </div>
              </div>
              <ol>
                <li><strong>1. Process:</strong> {processLayerSummary.process}</li>
                <li><strong>2. Task label:</strong> {processLayerSummary.taskLabel}</li>
                <li><strong>3. Macro:</strong> {processLayerSummary.macro}</li>
                <li><strong>4. Effect library:</strong> {processLayerSummary.effect}</li>
                <li><strong>5. Service object:</strong> {processLayerSummary.serviceObject}</li>
              </ol>
            </div>
          </>
        ) : null}

        {showEffectsTab && showMacroDesigner ? (
          <div className="transition-designer">
            <div className="card-header transition-designer-header">
              <div>
                <p className="eyebrow">Effect Layer</p>
                <h4>Macro Effect Library</h4>
                <p className="muted">
                  Reusable macro bundles drive transition execution. Effects stay generic and governed.
                </p>
              </div>
              <div className="inline-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={addMacroRow}
                  disabled={!canWrite || !macroParseResult.ok}
                >
                  Add Macro
                </button>
              </div>
            </div>

            {!macroParseResult.ok ? (
              <StateNotice
                kind="warning"
                title="Macro JSON error"
                message={`${macroParseResult.error} Fix raw JSON to use guided macro mode.`}
              />
            ) : null}

            {macroParseResult.ok ? (
              <div className="macro-editor-stack">
                {macroRows.length === 0 ? (
                  <StateNotice title="No macros configured." />
                ) : (
                  macroRows.map((macroRow, macroIndex) => (
                    <div key={`${macroRow.code}-${macroIndex}`} className="macro-editor-card">
                      <div className="form-grid">
                        <label className="form-field">
                          <span>Macro Code</span>
                          <input
                            aria-label={`Macro code ${macroIndex + 1}`}
                            value={macroRow.code}
                            onChange={(event) =>
                              updateMacroRow(macroIndex, { code: event.target.value })
                            }
                            disabled={!canWrite}
                          />
                        </label>
                        <label className="form-field">
                          <span>Label</span>
                          <input
                            aria-label={`Macro label ${macroIndex + 1}`}
                            value={macroRow.label}
                            onChange={(event) =>
                              updateMacroRow(macroIndex, { label: event.target.value })
                            }
                            disabled={!canWrite}
                          />
                        </label>
                      </div>

                      <div className="card-header transition-designer-header">
                        <div>
                          <p className="eyebrow">Effects</p>
                          <p className="muted">Attach reusable governed effects to this macro.</p>
                        </div>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => addMacroEffect(macroIndex)}
                            disabled={!canWrite}
                          >
                            Add Effect
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => removeMacroRow(macroIndex)}
                            disabled={!canWrite}
                          >
                            Remove Macro
                          </button>
                        </div>
                      </div>

                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Effect Type</th>
                              <th>Service Object Type</th>
                              <th>Service Object Category</th>
                              <th>Config (JSON)</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {macroRow.effects.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="transition-empty-cell">
                                  No effects configured.
                                </td>
                              </tr>
                            ) : (
                              macroRow.effects.map((effectRow, effectIndex) => (
                                <tr key={`${macroRow.code}-effect-${effectIndex}`}>
                                  <td>
                                    <select
                                      value={effectRow.type}
                                      onChange={(event) =>
                                        updateMacroEffect(macroIndex, effectIndex, {
                                          type: event.target.value,
                                        })
                                      }
                                      disabled={!canWrite}
                                    >
                                      <option value="">Select effect</option>
                                      {effectTypeOptions.map((option) => (
                                        <option key={`${macroRow.code}-${option.code}`} value={option.code}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td>
                                    <input
                                      type="text"
                                      value={effectRow.serviceObjectType}
                                      onChange={(event) =>
                                        updateMacroEffect(macroIndex, effectIndex, {
                                          serviceObjectType: event.target.value,
                                        })
                                      }
                                      placeholder={normalizeOptionalText(draft.object_type) || "service object type"}
                                      disabled={!canWrite}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="text"
                                      value={effectRow.serviceObjectCategory}
                                      onChange={(event) =>
                                        updateMacroEffect(macroIndex, effectIndex, {
                                          serviceObjectCategory: event.target.value,
                                        })
                                      }
                                      placeholder={normalizeOptionalText(draft.service_object_category) || "service object category"}
                                      disabled={!canWrite}
                                    />
                                  </td>
                                  <td>
                                    <textarea
                                      rows={2}
                                      value={effectRow.configText}
                                      onChange={(event) =>
                                        updateMacroEffect(macroIndex, effectIndex, {
                                          configText: event.target.value,
                                        })
                                      }
                                      disabled={!canWrite}
                                    />
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="ghost-button"
                                      onClick={() => removeMacroEffect(macroIndex, effectIndex)}
                                      disabled={!canWrite}
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {showAdvancedTab && config.taxonomy.rows.length > 0 ? (
          <div className="table-wrap">
            <h4>{config.taxonomy.title}</h4>
            {loadingTaxonomy ? (
              <StateNotice title={config.taxonomy.loading_title} />
            ) : (
              <table>
                <tbody>
                  {config.taxonomy.rows.map((row) => (
                    <tr key={row.code}>
                      <th>{row.label}</th>
                      <td>{listEntries(taxonomy?.[row.code])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}

        {showAdvancedTab && item && config.projection.rows.length > 0 ? (
          <div className="table-wrap">
            <h4>{config.projection.title}</h4>
            <table>
              <tbody>
                {config.projection.rows.map((row) => (
                  <tr key={row.path}>
                    <th>{row.label}</th>
                    <td>{formatProjectionValue(getPath(item, row.path), row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default ContractDetailEditor;
