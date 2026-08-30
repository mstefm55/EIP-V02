import { resolveCapacitySlot } from "../temporal/capacitySlotResolver.js";

const DEFAULT_MAX_CANDIDATES = 500;

function normalizeCodes(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean);
}

function candidateCapabilitySet(candidate) {
  return new Set(normalizeCodes(candidate?.capabilities || candidate?.capability_codes || []));
}

function satisfiesMinimums(candidate, minimums) {
  if (!minimums || typeof minimums !== "object" || Array.isArray(minimums)) return true;
  const capacity = candidate?.capacity && typeof candidate.capacity === "object" ? candidate.capacity : {};
  return Object.entries(minimums).every(([key, required]) => {
    const actual = Number(capacity[key]);
    const needed = Number(required);
    return Number.isFinite(actual) && Number.isFinite(needed) && actual >= needed;
  });
}

export function resolveWorkstationCandidates(candidates, requirement = {}, options = {}) {
  if (!Array.isArray(candidates)) throw new Error("WORKSTATION_CANDIDATES_ARRAY_REQUIRED");
  const maxCandidates = Math.max(1, Math.min(5000, Number(options.maxCandidates) || DEFAULT_MAX_CANDIDATES));
  if (candidates.length > maxCandidates) throw new Error("WORKSTATION_CANDIDATE_LIMIT_EXCEEDED");

  const allRequired = normalizeCodes(requirement.capabilities_all);
  const anyRequired = normalizeCodes(requirement.capabilities_any);
  const mobility = requirement.mobility ? String(requirement.mobility).trim().toUpperCase() : null;

  return candidates.filter((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    if (candidate.is_active === false) return false;
    const capabilities = candidateCapabilitySet(candidate);
    if (!allRequired.every((code) => capabilities.has(code))) return false;
    if (anyRequired.length > 0 && !anyRequired.some((code) => capabilities.has(code))) return false;
    if (mobility && String(candidate.mobility || "").trim().toUpperCase() !== mobility) return false;
    return satisfiesMinimums(candidate, requirement.capacity_minimums);
  });
}

export function resolveWorkstationAvailability(candidates, requirement = {}, scheduling = {}, options = {}) {
  const eligible = resolveWorkstationCandidates(candidates, requirement, options);
  const results = [];

  for (const candidate of eligible) {
    const calendarLayers = candidate.calendar_layers || candidate.calendars;
    if (!Array.isArray(calendarLayers) || calendarLayers.length === 0) continue;
    const slot = resolveCapacitySlot({
      calendar_layers: calendarLayers,
      reservations: candidate.reservations || [],
      anchor: scheduling.anchor,
      duration_minutes: scheduling.duration_minutes,
      direction: scheduling.direction || "FORWARD",
      allow_split: scheduling.allow_split === true,
      max_search_days: scheduling.max_search_days,
      max_reservations: scheduling.max_reservations,
      max_segments: scheduling.max_segments
    });
    if (!slot) continue;
    results.push({ candidate, slot });
  }

  const direction = String(scheduling.direction || "FORWARD").trim().toUpperCase();
  results.sort((a, b) => {
    if (direction === "BACKWARD") return b.slot.start - a.slot.start;
    return a.slot.end - b.slot.end;
  });
  return results;
}
