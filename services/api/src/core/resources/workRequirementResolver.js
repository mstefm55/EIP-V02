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

function normalizeUnit(value) {
  return String(value || "").trim().toLowerCase() || null;
}

function normalizeCapacity(candidate) {
  return candidate?.capacity && typeof candidate.capacity === "object" && !Array.isArray(candidate.capacity)
    ? candidate.capacity
    : {};
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
