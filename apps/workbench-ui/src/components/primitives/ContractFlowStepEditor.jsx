import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { resolveContract, resolveValue } from "../../engine/contracts.js";
import {
  buildStepEditorDraft,
  getSafePath,
  normalizeStepEditorFields,
  patchRecordFromStepDraft,
  resolveStepEditorFieldOptions,
  validateStepEditorDraft,
} from "./contractStepEditorModel.js";
import StateNotice from "./StateNotice.jsx";
import "./ContractFlowStepEditor.css";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function hasAnyPermission(session, expected = []) {
  if (!Array.isArray(expected) || expected.length === 0) return true;
  const granted = Array.isArray(session?.permissions) ? session.permissions : [];
  return expected.some((permission) => granted.includes(permission));
}

function fieldInputType(type) {
  if (["number", "password", "url", "email"].includes(type)) return type;
  return "text";
}

function isMultilineField(type) {
  return ["textarea", "string_list", "json_object"].includes(type);
}

function buildContractContext(ctx) {
  return {
    surfaceProps: ctx?.surfaceProps || {},
    surfaceMeta: ctx?.surfaceMeta || {},
    availableSurfaces: ctx?.availableSurfaces || [],
    selection: {
      definition: ctx?.selection?.definition || {},
      targets: ctx?.selection?.targets || {},
    },
    auth: {
      session: ctx?.auth?.session || {},
    },
  };
}

function resolveResponseRecord(payload, path) {
  const preferredPath = normalizeText(path || "item");
  if (!preferredPath) return payload && typeof payload === "object" ? payload : null;
  const value = getSafePath(payload, preferredPath);
  return value && typeof value === "object" ? value : null;
}

function resolveRecordIdentifier(record, recordKey) {
  if (!record || typeof record !== "object") return null;
  const configured = normalizeText(recordKey);
  const configuredValue = configured ? getSafePath(record, configured) : undefined;
  return configuredValue ?? record.id ?? record.code ?? null;
}

function ContractFlowStepEditor({ node, ctx }) {
  const props = node?.props || {};
  const fieldsKey = JSON.stringify(props.fields || []);
  const fields = useMemo(
    () => normalizeStepEditorFields(props.fields, { maxFields: props.max_fields }),
    [fieldsKey, props.max_fields]
  );
  const recordSelectionTarget = normalizeText(props.record_selection_target || "definition").toLowerCase();
  const selectedRecord = ctx?.selection?.getTarget?.(recordSelectionTarget) || null;
  const recordKey = normalizeText(props.record_key || "id") || "id";
  const selectedRecordId = resolveRecordIdentifier(selectedRecord, recordKey);
  const createMode = !selectedRecordId && props.create_when_unselected === true && Boolean(props.create_contract);
  const canAuthor = hasAnyPermission(ctx?.auth?.session, props.permissions_any);
  const contractCtx = useMemo(() => buildContractContext(ctx), [
    ctx?.auth?.session,
    ctx?.availableSurfaces,
    ctx?.selection?.definition,
    ctx?.selection?.targets,
    ctx?.surfaceMeta,
    ctx?.surfaceProps,
  ]);
  const newTemplateKey = JSON.stringify(props.new_record_template || {});
  const newRecordTemplate = useMemo(() => {
    const scopes = {
      surface: ctx?.surfaceProps || {},
      surface_meta: ctx?.surfaceMeta || {},
      selections: ctx?.selection?.targets || {},
      selection: ctx?.selection?.definition || {},
      auth: ctx?.auth?.session || {},
    };
    const resolved = resolveValue(props.new_record_template || {}, scopes);
    return resolved && typeof resolved === "object" && !Array.isArray(resolved) ? resolved : {};
  }, [newTemplateKey, ctx?.surfaceProps, ctx?.surfaceMeta, ctx?.selection?.targets, ctx?.selection?.definition, ctx?.auth?.session]);

  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState(null);
  const [optionsPayload, setOptionsPayload] = useState({});
  const [loading, setLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [optionsError, setOptionsError] = useState(null);
  const [status, setStatus] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const loadTokenRef = useRef(0);

  const basicFields = fields.filter((field) => !field.advanced);
  const advancedFields = fields.filter((field) => field.advanced);

  const buildPathParams = useCallback((recordId) => {
    const pathParamName = normalizeText(props.record_path_param || "id") || "id";
    if (recordId === null || recordId === undefined || recordId === "") return {};
    return {
      id: recordId,
      [pathParamName]: recordId,
    };
  }, [props.record_path_param]);

  const loadOptions = useCallback(async () => {
    setOptionsError(null);
    if (!props.options_contract) {
      setOptionsPayload({});
      return;
    }
    const resolved = resolveContract(props.options_contract, contractCtx);
    if (!resolved) {
      setOptionsPayload({});
      setOptionsError(props.options_unconfigured_message || "Reference options are not configured yet.");
      return;
    }

    setOptionsLoading(true);
    try {
      const payload = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      setOptionsPayload(payload && typeof payload === "object" ? payload : {});
    } catch (err) {
      setOptionsPayload({});
      setOptionsError(describeApiError(err, props.options_error_message || "Unable to load reference options."));
    } finally {
      setOptionsLoading(false);
    }
  }, [contractCtx, props.options_contract, props.options_error_message, props.options_unconfigured_message]);

  const load = useCallback(async () => {
    const loadToken = loadTokenRef.current + 1;
    loadTokenRef.current = loadToken;
    setError(null);
    setStatus(null);
    setFieldErrors({});

    if (createMode) {
      setRecord(newRecordTemplate);
      setDraft(buildStepEditorDraft(newRecordTemplate, fields));
      return;
    }

    if (!selectedRecordId) {
      setRecord(null);
      setDraft(null);
      return;
    }

    if (!props.detail_contract) {
      const fallbackRecord = selectedRecord && typeof selectedRecord === "object" ? selectedRecord : {};
      setRecord(fallbackRecord);
      setDraft(buildStepEditorDraft(fallbackRecord, fields));
      return;
    }

    const resolved = resolveContract(props.detail_contract, contractCtx, {
      pathParams: buildPathParams(selectedRecordId),
    });
    if (!resolved) {
      setRecord(null);
      setDraft(null);
      setError(props.unconfigured_message || "This editor is not configured yet.");
      return;
    }

    setLoading(true);
    try {
      const payload = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      if (loadTokenRef.current !== loadToken) return;
      const nextRecord = resolveResponseRecord(payload, props.detail_item_path) || {};
      setRecord(nextRecord);
      setDraft(buildStepEditorDraft(nextRecord, fields));
    } catch (err) {
      if (loadTokenRef.current !== loadToken) return;
      setRecord(null);
      setDraft(null);
      setError(describeApiError(err, props.error_title || "Unable to load details."));
    } finally {
      if (loadTokenRef.current === loadToken) setLoading(false);
    }
  }, [
    buildPathParams,
    contractCtx,
    createMode,
    fields,
    newRecordTemplate,
    props.detail_contract,
    props.detail_item_path,
    props.error_title,
    props.unconfigured_message,
    selectedRecord,
    selectedRecordId,
  ]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions, ctx?.workbench?.refreshNonce]);

  useEffect(() => {
    load();
  }, [load, ctx?.workbench?.refreshNonce]);

  function patchDraft(key, value) {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));
    setFieldErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setStatus(null);
  }

  function buildSavePayload(isCreate) {
    const scopes = {
      surface: ctx?.surfaceProps || {},
      surface_meta: ctx?.surfaceMeta || {},
      selections: ctx?.selection?.targets || {},
      selection: ctx?.selection?.definition || {},
      auth: ctx?.auth?.session || {},
      record: record || {},
      draft: draft || {},
    };
    const saveConfig = props.save_payload || {};
    const template = saveConfig.template !== undefined
      ? resolveValue(saveConfig.template, scopes)
      : saveConfig.preserve_record === true
        ? record || {}
        : {};
    const base = template && typeof template === "object" && !Array.isArray(template) ? template : {};
    const patched = patchRecordFromStepDraft(base, draft, fields, { isCreate });
    const root = normalizeText(saveConfig.payload_root);
    return root ? { [root]: patched } : patched;
  }

  const save = useCallback(async () => {
    if ((!selectedRecordId && !createMode) || !draft) return;
    if (!canAuthor) {
      setStatus(props.read_only_message || "This session is read-only for this panel.");
      return;
    }

    const validationErrors = validateStepEditorDraft(draft, fields);
    if (validationErrors.length > 0) {
      setFieldErrors(Object.fromEntries(validationErrors.map((entry) => [entry.key, entry.message])));
      setStatus(props.validation_message || "Complete the required fields before saving.");
      return;
    }

    const activeContract = createMode ? props.create_contract : props.update_contract;
    const resolved = resolveContract(activeContract, contractCtx, {
      pathParams: createMode ? {} : buildPathParams(selectedRecordId),
    });
    if (!resolved) {
      setStatus(props.unconfigured_message || "Save settings are not configured yet.");
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const payload = buildSavePayload(createMode);
      const response = await apiFetch(resolved.pathWithQuery, {
        method: resolved.method,
        body: payload,
      });
      const responsePath = createMode ? props.create_item_path : props.update_item_path;
      const savedRecord = resolveResponseRecord(response, responsePath || "item");
      if (savedRecord) {
        setRecord(savedRecord);
        setDraft(buildStepEditorDraft(savedRecord, fields));
        ctx?.selection?.selectTarget?.(recordSelectionTarget, savedRecord);
      }
      setStatus(
        createMode
          ? props.created_message || "Record created. Continue with the next setup step."
          : props.saved_message || "Changes saved."
      );
      ctx?.workbench?.refresh?.();
    } catch (err) {
      setStatus(
        describeApiError(
          err,
          createMode
            ? props.create_error_message || "Unable to create record."
            : props.save_error_message || "Unable to save changes."
        )
      );
    } finally {
      setSaving(false);
    }
  }, [
    buildPathParams,
    canAuthor,
    contractCtx,
    createMode,
    draft,
    fields,
    props,
    recordSelectionTarget,
    selectedRecordId,
    ctx?.selection,
    ctx?.workbench,
  ]);

  function renderField(field) {
    const value = draft?.[field.key] ?? (field.type === "checkbox" ? false : "");
    const errorMessage = fieldErrors[field.key] || null;
    const fieldOptions = resolveStepEditorFieldOptions(field, optionsPayload);
    const immutable = !createMode && field.immutable_after_create;
    const disabled = !canAuthor || saving || immutable;

    if (field.type === "checkbox") {
      return (
        <label key={field.key} className="contract-flow-step-editor__toggle">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => patchDraft(field.key, event.target.checked)}
            disabled={disabled}
          />
          <span>
            <strong>{field.label}</strong>
            {field.help ? <small>{field.help}</small> : null}
          </span>
        </label>
      );
    }

    return (
      <label key={field.key} className="contract-flow-step-editor__field">
        <span className="contract-flow-step-editor__field-label">
          {field.label}{field.required ? " *" : ""}
        </span>
        {isMultilineField(field.type) ? (
          <textarea
            rows={field.rows}
            value={value}
            placeholder={field.placeholder}
            onChange={(event) => patchDraft(field.key, event.target.value)}
            disabled={disabled}
            aria-invalid={Boolean(errorMessage)}
          />
        ) : field.type === "select" ? (
          <select
            value={value}
            onChange={(event) => patchDraft(field.key, event.target.value)}
            disabled={disabled || optionsLoading}
            aria-invalid={Boolean(errorMessage)}
          >
            <option value="">{optionsLoading ? "Loading options..." : field.placeholder || "Select..."}</option>
            {fieldOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        ) : (
          <input
            type={fieldInputType(field.type)}
            value={value}
            placeholder={field.placeholder}
            onChange={(event) => {
              const rawValue = event.target.value;
              const nextValue = field.type === "number" && rawValue !== "" ? Number(rawValue) : rawValue;
              patchDraft(field.key, nextValue);
            }}
            disabled={disabled}
            autoComplete={field.type === "password" ? "new-password" : undefined}
            aria-invalid={Boolean(errorMessage)}
          />
        )}
        {immutable ? <small className="contract-flow-step-editor__help">Locked after creation.</small> : null}
        {field.help ? <small className="contract-flow-step-editor__help">{field.help}</small> : null}
        {errorMessage ? <small className="contract-flow-step-editor__error">{errorMessage}</small> : null}
      </label>
    );
  }

  if (!selectedRecordId && !createMode) {
    return <StateNotice title={props.selection_required_message || "Select a record to configure it."} />;
  }

  if (loading && !draft) {
    return <StateNotice title={props.loading_message || "Loading configuration..."} />;
  }

  if (error) {
    return <StateNotice kind="error" title={props.error_title || "Configuration unavailable"} message={error} />;
  }

  if (!draft) {
    return <StateNotice title={props.empty_message || "No configuration is available for this record."} />;
  }

  return (
    <section className="contract-flow-step-editor">
      {createMode && props.create_mode_message ? (
        <StateNotice title={props.create_mode_title || "New record"} message={props.create_mode_message} />
      ) : null}
      {!canAuthor ? (
        <StateNotice kind="warning" title={props.read_only_message || "This session is read-only for this panel."} />
      ) : null}
      {optionsError ? (
        <StateNotice kind="warning" title={props.options_error_title || "Reference options unavailable"} message={optionsError} />
      ) : null}

      <div className="contract-flow-step-editor__grid">
        {basicFields.map(renderField)}
      </div>

      {advancedFields.length > 0 ? (
        <details className="contract-flow-step-editor__advanced">
          <summary>{props.advanced_label || "Advanced"}</summary>
          <div className="contract-flow-step-editor__grid contract-flow-step-editor__grid--advanced">
            {advancedFields.map(renderField)}
          </div>
        </details>
      ) : null}

      <footer className="contract-flow-step-editor__footer">
        <div className="contract-flow-step-editor__status" aria-live="polite">{status || ""}</div>
        <button
          type="button"
          className="primary-button"
          onClick={save}
          disabled={!canAuthor || saving || optionsLoading}
        >
          {saving
            ? props.saving_label || "Saving..."
            : createMode
              ? props.create_label || "Create"
              : props.save_label || "Save changes"}
        </button>
      </footer>
    </section>
  );
}

export default ContractFlowStepEditor;
