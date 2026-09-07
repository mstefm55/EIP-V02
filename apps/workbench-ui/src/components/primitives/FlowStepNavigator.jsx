import { useEffect } from "react";
import {
  Activity,
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  FileClock,
  Gauge,
  KeyRound,
  Link,
  Network,
  Radio,
  Route,
  Send,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { resolveValue } from "../../engine/contracts.js";
import {
  normalizeFlowSteps,
  readSelectedFlowStepId,
  resolveInitialFlowStep,
} from "./flowStepModel.js";
import "./FlowStepNavigator.css";

const ICONS = Object.freeze({
  check: Check,
  identity: Link,
  endpoint: Network,
  network: Network,
  inbound: Radio,
  outbound: Send,
  security: ShieldCheck,
  verification: ShieldCheck,
  reliability: Gauge,
  idempotency: KeyRound,
  routing: Route,
  health: Activity,
  audit: FileClock,
  advanced: SlidersHorizontal,
});

const STATUS_ICONS = Object.freeze({
  pending: Circle,
  current: CircleDashed,
  complete: CircleCheck,
  warning: CircleAlert,
  error: CircleX,
  skipped: CircleDashed,
  disabled: Circle,
});

function buildResolveScopes(ctx) {
  return {
    surface: ctx?.surfaceProps || {},
    surface_meta: ctx?.surfaceMeta || {},
    available_surfaces: ctx?.availableSurfaces || [],
    selection: ctx?.selection?.definition || {},
    selections: ctx?.selection?.targets || {},
    auth: ctx?.auth?.session || {},
  };
}

function resolveStepStatus(step, scopes) {
  if (!step.status_token) return step.status;
  const value = resolveValue(step.status_token, scopes);
  if (typeof value === "boolean") return value ? "complete" : "pending";
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["pending", "current", "complete", "warning", "error", "skipped", "disabled"].includes(normalized)
    ? normalized
    : step.status;
}

function StepIcon({ step, status }) {
  const Icon = ICONS[step.icon] || STATUS_ICONS[status] || Circle;
  return <Icon size={18} strokeWidth={2} aria-hidden="true" />;
}

function FlowStepNavigator({ node, ctx }) {
  const props = node?.props || {};
  const steps = normalizeFlowSteps(props.steps, { maxSteps: props.max_steps });
  const selectionTarget = String(props.selection_target || "flow_step").trim().toLowerCase();
  const selectedValue = ctx?.selection?.getTarget?.(selectionTarget) || null;
  const selectedId = readSelectedFlowStepId(selectedValue);
  const activeStep = resolveInitialFlowStep(steps, selectedId, props.default_step_id);
  const scopes = buildResolveScopes(ctx);

  useEffect(() => {
    if (!activeStep || activeStep.disabled) return;
    if (selectedId === activeStep.id) return;
    ctx?.selection?.selectTarget?.(selectionTarget, {
      id: activeStep.id,
      step_id: activeStep.id,
      label: activeStep.label,
    });
  }, [activeStep?.id, activeStep?.label, activeStep?.disabled, selectedId, selectionTarget, ctx?.selection]);

  function selectStep(step) {
    if (!step || step.disabled) return;
    ctx?.selection?.selectTarget?.(selectionTarget, {
      id: step.id,
      step_id: step.id,
      label: step.label,
    });
  }

  return (
    <section className="flow-step-navigator" aria-label={props.aria_label || props.title || "Setup steps"}>
      {props.eyebrow ? <p className="flow-step-navigator__eyebrow">{props.eyebrow}</p> : null}
      {props.title ? <h3 className="flow-step-navigator__title">{props.title}</h3> : null}
      {props.subtitle ? <p className="flow-step-navigator__subtitle">{props.subtitle}</p> : null}

      <ol className="flow-step-navigator__list">
        {steps.map((step, index) => {
          const status = resolveStepStatus(step, scopes);
          const isActive = activeStep?.id === step.id;
          const statusText = step.status_label || status;
          return (
            <li
              key={step.id}
              className={`flow-step-navigator__item flow-step-navigator__item--${status}${
                isActive ? " is-active" : ""
              }`}
            >
              {index < steps.length - 1 ? <span className="flow-step-navigator__rail" aria-hidden="true" /> : null}
              <button
                type="button"
                className="flow-step-navigator__button"
                onClick={() => selectStep(step)}
                disabled={step.disabled}
                aria-current={isActive ? "step" : undefined}
                aria-label={`${step.label}${step.optional ? ", optional" : ""}`}
                title={step.help || step.description || step.label}
              >
                <span className="flow-step-navigator__icon" aria-hidden="true">
                  <StepIcon step={step} status={status} />
                </span>
                <span className="flow-step-navigator__copy">
                  <span className="flow-step-navigator__label">{step.label}</span>
                  {step.description ? (
                    <span className="flow-step-navigator__description">{step.description}</span>
                  ) : null}
                  <span className="flow-step-navigator__status">
                    {statusText}
                    {step.optional ? " · Optional" : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default FlowStepNavigator;
