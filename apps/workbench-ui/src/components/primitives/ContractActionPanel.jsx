import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { resolveContract, resolveValue } from "../../engine/contracts.js";
import {
  buildStepEditorDraft,
  getSafePath,
  normalizeStepEditorFields,
  resolveStepEditorFieldOptions,
  validateStepEditorDraft,
} from "./contractStepEditorModel.js";
import StateNotice from "./StateNotice.jsx";
import "./ContractActionPanel.css";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function hasAnyPermission(session, expected = []) {
  if (!Array.isArray(expected) || expected.length === 0) return true;
  const granted = Array.isArray(session?.permissions) ? session.permissions : [];
  return expected.some((permission) => granted.includes(permission));
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

function resolveRecordIdentifier(record, recordKey) {
  if (!record || typeof record !== "object") return null;
  const configured = normalizeText(recordKey);
  const configuredValue = configured ? getSafePath(record, configured) : undefined;
  return configuredValue ?? record.id ?? record.code ?? null;
}

function normalizeAction(rawAction, index) {
  if (!rawAction || typeof rawAction !== "object" || Array.isArray(rawAction)) return null;
  const id = normalizeText(rawAction.id || `action_${index + 1}`);
  const label = normalizeText(rawAction.label || rawAction.title || id);
  const contract = rawAction.contract && typeof rawAction.contract === "object" ? rawAction.contract : null;
  if (!id || !label || !contract) return null;
  return {
    id,
    label,
    contract,
    path_params:
      rawAction.path_params && typeof rawAction.path_params === "object" && !Array.isArray(rawAction.path_params)
        ? rawAction.path_params
        : {},
    payload: rawAction.payload,
    permissions_any: Array.isArray(rawAction.permissions_any) ? rawAction.permissions_any : [],
    confirm_message: normalizeText(rawAction.confirm_message),
    success_message: normalizeText(rawAction.success_message),
    error_message: normalizeText(rawAction.error_message),
    button_kind: normalizeText(rawAction.button_kind).toLowerCase() === "danger" ? "danger" : "primary",
  };
}

function ContractActionPanel({ node, ctx }) {
  const props = node?.props || {};
  const fieldsKey = JSON.stringify(props.fields || []);
  const actionsKey = JSON.stringify(props.actions || []);
  const initialValuesKey = JSON.stringify(props.initial_values || {});
  const fields = useMemo(
    () => normalizeStepEditorFields(props.fields, { maxFields: props.max_fields }),
    [fieldsKey, props.max_fields]
  );
  const actions = useMemo(
    () => (Array.isArray(props.actions) ? props.actions : []).map(normalizeAction).filter(Boolean).slice(0, 12),
    [actionsKey]
  );
  const recordSelectionTarget = normalizeText(props.record_selection_target || "definition").toLowerCase();
  const selectedRecord = ctx?.selection?.getTarget?.(recordSelectionTarget) || null;
  const recordKey = normalizeText(props.record_key || "id") || "id";
  const selectedRecordId = resolveRecordIdentifier(selectedRecord, recordKey);
  const recordRequired = props.record_required !== false;
  const panelCanRun = hasAnyPermission(ctx?.auth?.session, props.permissions_any);
  const contractCtx = useMemo(() => buildContractContext(ctx), [
    ctx?.auth?.session,
    ctx?.availableSurfaces,
    ctx?.selection?.definition,
    ctx?.selection?.targets,
    ctx?.surfaceMeta,
    ctx?.surfaceProps,
  ]);

  const resolvedInitialValues = useMemo(() => {
    const scopes = {
      surface: ctx?.surfaceProps || {},
      surface_meta: ctx?.surfaceMeta || {},
      selections: ctx?.selection?.targets || {},
      selection: ctx?.selection?.definition || {},
      auth: ctx?.auth?.session || {},
      record: selectedRecord || {},
    };
    const resolved = resolveValue(props.initial_values || {}, scopes);
    return resolved && typeof resolved === "object" && !Array.isArray(resolved) ? resolved : {};
  }, [
    initialValuesKey,
    selectedRecordId,
    ctx?.auth?.session,
    ctx?.selection?.definition,
    ctx?.selection?.targets,
    ctx?.surfaceMeta,
    ctx?.surfaceProps,
  ]);

  const [draft, setDraft] = useState(() => buildStepEditorDraft(resolvedInitialValues, fields));
  const [optionsPayload, setOptionsPayload] = useState({});
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [runningActionId, setRunningActionId] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    setDraft(buildStepEditorDraft(resolvedInitialValues, fields));
    setFieldErrors({});
    setStatus(null);
  }, [fieldsKey, initialValuesKey, selectedRecordId]);

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

  useEffect(() => {
    loadOptions();
  }, [loadOptions, ctx?.workbench?.refreshNonce]);

  function patchDraft(key, value) {
    setDraft((previous) => ({ ...(previous || {}), [key]: value }));
    setFieldErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setStatus(null);
  }

  function buildScopes() {
    return {
      surface: ctx?.surfaceProps || {},
      surface_meta: ctx?.surfaceMeta || {},
      selections: ctx?.selection?.targets || {},
      selection: ctx?.selection?.definition || {},
      auth: ctx?.auth?.session || {},
      record: selectedRecord || {},
      draft: draft || {},
    };
  }

  function buildPathParams(action, scopes) {
    const pathParamName = normalizeText(props.record_path_param || "id") || "id";
    const configured = resolveValue(action.path_params || {}, scopes);
    const safeConfigured = configured && typeof configured === "object" && !Array.isArray(configured) ? configured : {};
    const output = { ...safeConfigured };
    if (selectedRecordId !== null && selectedRecordId !== undefined && selectedRecordId !== "") {
      output.id = selectedRecordId;
      output[pathParamName] = selectedRecordId;
    }
    return output;
  }

  function clearWriteOnlyFields() {
    setDraft((previous) => {
      const next = { ...(previous || {}) };
      for (const field of fields) {
        if (field.type === "password") next[field.key] = "";
      }
      return next;
    });
  }

  const runAction = useCallback(async (action) => {
    if (!action || runningActionId) return;
    if (recordRequired && !selectedRecordId) {
      setStatus(props.selection_required_message || "Select a record before running this action.");
      return;
    }
    if (!panelCanRun || !hasAnyPermission(ctx?.auth?.session, action.permissions_any)) {
      setStatus(props.read_only_message || "This session cannot run this action.");
      return;
    }

    const validationErrors = validateStepEditorDraft(draft, fields);
    if (validationErrors.length > 0) {
      setFieldErrors(Object.fromEntries(validationErrors.map((entry) => [entry.key, entry.message])));
      setStatus(props.validation_message || "Complete the required fields before continuing.");
      return;
    }

    if (action.confirm_message && typeof window !== "undefined") {
      const confirmed = window.confirm(action.confirm_message);
      if (!confirmed) return;
    }

    const scopes = buildScopes();
    const resolved = resolveContract(action.contract, contractCtx, {
      pathParams: buildPathParams(action, scopes),
    });
    if (!resolved) {
      setStatus(props.unconfigured_message || "This action is not configured yet.");
      return;
    }

    setRunningActionId(action.id);
    setStatus(null);
    try {
      const payload = action.payload === undefined ? undefined : resolveValue(action.payload, scopes);
      await apiFetch(resolved.pathWithQuery, {
        method: resolved.method,
        ...(payload === undefined ? {} : { body: payload }),
      });
      clearWriteOnlyFields();
      setStatus(action.success_message || props.success_message || "Action completed.");
      ctx?.workbench?.refresh?.();
    } catch (err) {
      setStatus(describeApiError(err, action.error_message || props.error_message || "Action failed."));
    } finally {
      setRunningActionId(null);
    }
  }, [
    contractCtx,
    ctx?.auth?.session,
    ctx?.selection?.definition,
    ctx?.selection?.targets,
    ctx?.surfaceMeta,
    ctx?.surfaceProps,
    ctx?.workbench,
    draft,
    fields,
    panelCanRun,
    props,
    recordRequired,
    runningActionId,
    selectedRecord,
    selectedRecordId,
  ]);

  function renderField(field) {
    const value = draft?.[field.key] ?? (field.type === "checkbox" ? false : "");
    const errorMessage = fieldErrors[field.key] || null;
    const fieldOptions = resolveStepEditorFieldOptions(field, optionsPayload);
    const disabled = !panelCanRun || Boolean(runningActionId);

    if (field.type === "checkbox") {
      return (
        <label key={field.key} className="contract-action-panel__toggle">
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
      <label key={field.key} className="contract-action-panel__field">
        <span className="contract-action-panel__field-label">
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
            type={["number", "password", "url", "email"].includes(field.type) ? field.type : "text"}
            value={value}
            placeholder={field.placeholder}
            onChange={(event) => {
              const rawValue = event.target.value;
              patchDraft(field.key, field.type === "number" && rawValue !== "" ? Number(rawValue) : rawValue);
            }}
            disabled={disabled}
            autoComplete={field.type === "password" ? "new-password" : undefined}
            aria-invalid={Boolean(errorMessage)}
          />
        )}
        {field.help ? <small className="contract-action-panel__help">{field.help}</small> : null}
        {errorMessage ? <small className="contract-action-panel__error">{errorMessage}</small> : null}
      </label>
    );
  }

  if (recordRequired && !selectedRecordId) {
    return <StateNotice title={props.selection_required_message || "Select a record to continue."} />;
  }

  return (
    <section className="contract-action-panel">
      {(props.eyebrow || props.title || props.subtitle) ? (
        <header className="contract-action-panel__header">
          {props.eyebrow ? <p className="eyebrow">{props.eyebrow}</p> : null}
          {props.title ? <h4>{props.title}</h4> : null}
          {props.subtitle ? <p>{props.subtitle}</p> : null}
        </header>
      ) : null}

      {!panelCanRun ? (
        <StateNotice kind="warning" title={props.read_only_message || "This session cannot run these actions."} />
      ) : null}
      {optionsError ? (
        <StateNotice kind="warning" title={props.options_error_title || "Reference options unavailable"} message={optionsError} />
      ) : null}

      {fields.length > 0 ? (
        <div className="contract-action-panel__grid">{fields.map(renderField)}</div>
      ) : null}

      <footer className="contract-action-panel__footer">
        <div className="contract-action-panel__status" aria-live="polite">{status || ""}</div>
        <div className="contract-action-panel__actions">
          {actions.map((action) => {
            const actionAllowed = panelCanRun && hasAnyPermission(ctx?.auth?.session, action.permissions_any);
            const running = runningActionId === action.id;
            return (
              <button
                key={action.id}
                type="button"
                className={action.button_kind === "danger" ? "danger-button" : "primary-button"}
                onClick={() => runAction(action)}
                disabled={!actionAllowed || Boolean(runningActionId)}
              >
                {running ? props.running_label || "Working..." : action.label}
              </button>
            );
          })}
        </div>
      </footer>
    </section>
  );
}

export default ContractActionPanel;
