import { readSelectedFlowStepId } from "./flowStepModel.js";
import "./FlowStepPanel.css";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function FlowStepPanel({ node, ctx, children }) {
  const props = node?.props || {};
  const selectionTarget = normalizeText(props.selection_target || "flow_step").toLowerCase();
  const stepId = normalizeText(props.step_id);
  const selectedValue = ctx?.selection?.getTarget?.(selectionTarget) || null;
  const selectedId = readSelectedFlowStepId(selectedValue);

  if (!stepId || selectedId !== stepId) return null;

  return (
    <section
      className="flow-step-panel"
      aria-label={props.aria_label || props.title || `${stepId} details`}
      data-flow-step-id={stepId}
    >
      {props.eyebrow ? <p className="flow-step-panel__eyebrow">{props.eyebrow}</p> : null}
      {props.title ? <h3 className="flow-step-panel__title">{props.title}</h3> : null}
      {props.subtitle ? <p className="flow-step-panel__subtitle">{props.subtitle}</p> : null}
      <div className="flow-step-panel__body">{children}</div>
    </section>
  );
}

export default FlowStepPanel;
