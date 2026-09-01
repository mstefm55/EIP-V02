const DEFAULT_PERIOD_MINUTES = 60;

function finiteNonNegative(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(code);
  return n;
}

function finitePositive(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(code);
  return n;
}

function optionalNonNegative(value, code) {
  if (value === undefined || value === null || value === "") return null;
  return finiteNonNegative(value, code);
}

function optionalPositive(value, code) {
  if (value === undefined || value === null || value === "") return null;
  return finitePositive(value, code);
}

function normalizeUnit(value) {
  return String(value || "").trim().toLowerCase() || null;
}

function normalizeCapacity(candidate) {
  return candidate?.capacity && typeof candidate.capacity === "object" && !Array.isArray(candidate.capacity)
    ? candidate.capacity
    : {};
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeSafeKey(value, code) {
  const key = String(value || "").trim();
  if (!key || ["__proto__", "prototype", "constructor"].includes(key)) {
    throw new Error(code);
  }
  return key;
}

function resolveResourceProcessStandard(candidate, processCode) {
  const standards = normalizeObject(candidate?.process_standards ?? candidate?.processStandards);
  if (!standards) throw new Error(`WORK_REQUIREMENT_PROCESS_STANDARD_MISSING:${processCode}`);
  const standard = normalizeObject(standards[processCode]);
  if (!standard) throw new Error(`WORK_REQUIREMENT_PROCESS_STANDARD_MISSING:${processCode}`);
  return standard;
}

function resolveLoadEnvelope(resourceStandard, workload, processCode) {
  const rawEnvelope = normalizeObject(resourceStandard?.load_envelope ?? resourceStandard?.load);
  if (!rawEnvelope) return null;

  const amount = finiteNonNegative(workload?.amount, "WORK_REQUIREMENT_AMOUNT_INVALID");
  const workloadUnit = normalizeUnit(workload?.unit);
  const envelopeUnit = normalizeUnit(rawEnvelope.unit ?? rawEnvelope.uom);
  if (workloadUnit && envelopeUnit && workloadUnit !== envelopeUnit) {
    throw new Error(`WORK_REQUIREMENT_LOAD_UNIT_MISMATCH:${workloadUnit}:${envelopeUnit}`);
  }

  const min = optionalNonNegative(rawEnvelope.min ?? rawEnvelope.min_load, "WORK_REQUIREMENT_MIN_LOAD_INVALID");
  const average = optionalPositive(
    rawEnvelope.average ?? rawEnvelope.average_load ?? rawEnvelope.preferred ?? rawEnvelope.preferred_load,
    "WORK_REQUIREMENT_AVERAGE_LOAD_INVALID"
  );
  const max = optionalPositive(rawEnvelope.max ?? rawEnvelope.max_load, "WORK_REQUIREMENT_MAX_LOAD_INVALID");

  if (min !== null && max !== null && min > max) {
    throw new Error(`WORK_REQUIREMENT_LOAD_ENVELOPE_INVALID:${processCode}`);
  }
  if (average !== null && min !== null && average < min) {
    throw new Error(`WORK_REQUIREMENT_LOAD_ENVELOPE_INVALID:${processCode}`);
  }
  if (average !== null && max !== null && average > max) {
    throw new Error(`WORK_REQUIREMENT_LOAD_ENVELOPE_INVALID:${processCode}`);
  }

  const minPolicy = String(rawEnvelope.min_policy || "SOFT").trim().toUpperCase();
  if (!["SOFT", "HARD"].includes(minPolicy)) {
    throw new Error(`WORK_REQUIREMENT_MIN_LOAD_POLICY_INVALID:${minPolicy}`);
  }

  if (max !== null && amount > max) {
    throw new Error(`WORK_REQUIREMENT_LOAD_ABOVE_MAX:${processCode}`);
  }
  if (min !== null && amount < min && minPolicy === "HARD") {
    throw new Error(`WORK_REQUIREMENT_LOAD_BELOW_MIN:${processCode}`);
  }

  let status = "WITHIN_RANGE";
  if (min !== null && amount < min) status = "BELOW_MIN";
  else if (average !== null && amount < average) status = "BELOW_AVERAGE";
  else if (average !== null && amount > average) status = "ABOVE_AVERAGE";

  return {
    amount,
    unit: workloadUnit || envelopeUnit,
    min,
    average,
    max,
    min_policy: minPolicy,
    status,
    ratio_to_average: average === null ? null : amount / average,
    ratio_to_max: max === null ? null : amount / max
  };
}

function resolveBatchComponent(component, resourceStandard, index) {
  if (!component || typeof component !== "object" || Array.isArray(component)) {
    throw new Error(`WORK_REQUIREMENT_BATCH_COMPONENT_INVALID:${index}`);
  }

  const code = String(component.code || `COMPONENT_${index + 1}`).trim().toUpperCase();
  const source = String(component.source || "PROCESS").trim().toUpperCase();

  if (["PROCESS", "FIXED"].includes(source)) {
    const minutes = finiteNonNegative(
      component.minutes,
      `WORK_REQUIREMENT_BATCH_COMPONENT_MINUTES_INVALID:${code}`
    );
    return { code, source: "PROCESS", minutes };
  }

  if (source === "RESOURCE_STANDARD") {
    const key = normalizeSafeKey(
      component.key ?? component.standard_key,
      `WORK_REQUIREMENT_BATCH_COMPONENT_KEY_INVALID:${code}`
    );
    const minutes = finiteNonNegative(
      resourceStandard[key],
      `WORK_REQUIREMENT_BATCH_RESOURCE_STANDARD_INVALID:${key}`
    );
    return { code, source, key, minutes };
  }

  throw new Error(`WORK_REQUIREMENT_BATCH_COMPONENT_SOURCE_INVALID:${source}`);
}

function resolveBatchCycle(candidate, workRequirement, overheadMinutes) {
  const batch = normalizeObject(workRequirement.batch_cycle ?? workRequirement.batchCycle);
  if (!batch) return null;

  const processCode = normalizeSafeKey(
    batch.process_code ?? batch.processCode ?? workRequirement.process_code ?? workRequirement.processCode,
    "WORK_REQUIREMENT_PROCESS_CODE_REQUIRED"
  );
  const resourceStandard = resolveResourceProcessStandard(candidate, processCode);

  const workload = normalizeObject(workRequirement.workload ?? batch.workload);
  if (!workload) throw new Error("WORK_REQUIREMENT_WORKLOAD_REQUIRED");
  const load = resolveLoadEnvelope(resourceStandard, workload, processCode);

  const components = batch.components;
  if (!Array.isArray(components) || components.length === 0) {
    throw new Error("WORK_REQUIREMENT_BATCH_COMPONENTS_REQUIRED");
  }
  if (components.length > 64) throw new Error("WORK_REQUIREMENT_BATCH_COMPONENT_LIMIT_EXCEEDED");

  const resolvedComponents = components.map((component, index) =>
    resolveBatchComponent(component, resourceStandard, index)
  );
  const baseMinutes = resolvedComponents.reduce((sum, component) => sum + component.minutes, 0);

  return {
    duration_minutes: baseMinutes + overheadMinutes,
    source: "BATCH_CYCLE",
    process_code: processCode,
    workload_amount: finiteNonNegative(workload.amount, "WORK_REQUIREMENT_AMOUNT_INVALID"),
    workload_unit: normalizeUnit(workload.unit) || load?.unit || null,
    base_duration_minutes: baseMinutes,
    overhead_minutes: overheadMinutes,
    components: resolvedComponents,
    load
  };
}

export function resolveCandidateWorkDuration(candidate, workRequirement = {}, options = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("WORK_REQUIREMENT_CANDIDATE_REQUIRED");
  }
  if (!workRequirement || typeof workRequirement !== "object" || Array.isArray(workRequirement)) {
    throw new Error("WORK_REQUIREMENT_INVALID");
  }

  const overheadMinutes = finiteNonNegative(
    workRequirement.fixed_overhead_minutes ?? workRequirement.overhead_minutes ?? 0,
    "WORK_REQUIREMENT_OVERHEAD_INVALID"
  );

  const batchResult = resolveBatchCycle(candidate, workRequirement, overheadMinutes);
  if (batchResult) return batchResult;

  const fixedRaw =
    workRequirement.duration_minutes ??
    workRequirement.fixed_duration_minutes ??
    options.fallback_duration_minutes;

  if (fixedRaw !== undefined && fixedRaw !== null && fixedRaw !== "") {
    const fixedMinutes = finiteNonNegative(fixedRaw, "WORK_REQUIREMENT_DURATION_INVALID");
    return {
      duration_minutes: fixedMinutes + overheadMinutes,
      source: "FIXED",
      base_duration_minutes: fixedMinutes,
      overhead_minutes: overheadMinutes
    };
  }

  const workload = workRequirement.workload;
  const rateSpec = workRequirement.rate;
  if (!workload || typeof workload !== "object" || Array.isArray(workload)) {
    throw new Error("WORK_REQUIREMENT_WORKLOAD_REQUIRED");
  }
  if (!rateSpec || typeof rateSpec !== "object" || Array.isArray(rateSpec)) {
    throw new Error("WORK_REQUIREMENT_RATE_REQUIRED");
  }

  const amount = finiteNonNegative(workload.amount, "WORK_REQUIREMENT_AMOUNT_INVALID");
  const workloadUnit = normalizeUnit(workload.unit);
  const rateUnit = normalizeUnit(rateSpec.workload_unit ?? rateSpec.unit);
  if (workloadUnit && rateUnit && workloadUnit !== rateUnit) {
    throw new Error(`WORK_REQUIREMENT_UNIT_MISMATCH:${workloadUnit}:${rateUnit}`);
  }

  const capacityKey = String(rateSpec.capacity_key || "").trim();
  if (!capacityKey || capacityKey.includes(".") || ["__proto__", "prototype", "constructor"].includes(capacityKey)) {
    throw new Error("WORK_REQUIREMENT_CAPACITY_KEY_INVALID");
  }

  const capacity = normalizeCapacity(candidate);
  const rate = finitePositive(capacity[capacityKey], `WORK_REQUIREMENT_RATE_INVALID:${capacityKey}`);
  const periodMinutes = finitePositive(
    rateSpec.period_minutes ?? DEFAULT_PERIOD_MINUTES,
    "WORK_REQUIREMENT_PERIOD_INVALID"
  );

  const rawMinutes = amount === 0 ? 0 : (amount / rate) * periodMinutes;
  const rounding = String(workRequirement.rounding || "CEIL_MINUTE").trim().toUpperCase();
  let baseMinutes;
  if (rounding === "NONE") baseMinutes = rawMinutes;
  else if (rounding === "ROUND_MINUTE") baseMinutes = Math.round(rawMinutes);
  else if (rounding === "FLOOR_MINUTE") baseMinutes = Math.floor(rawMinutes);
  else if (rounding === "CEIL_MINUTE") baseMinutes = Math.ceil(rawMinutes);
  else throw new Error(`WORK_REQUIREMENT_ROUNDING_INVALID:${rounding}`);

  return {
    duration_minutes: baseMinutes + overheadMinutes,
    source: "RATE",
    workload_amount: amount,
    workload_unit: workloadUnit || rateUnit,
    rate,
    capacity_key: capacityKey,
    period_minutes: periodMinutes,
    raw_duration_minutes: rawMinutes,
    base_duration_minutes: baseMinutes,
    overhead_minutes: overheadMinutes,
    rounding
  };
}
