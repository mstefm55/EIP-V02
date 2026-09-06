import {
  getLocalDateString,
  resolveCalendarTimezone,
  resolveEffectiveUtcIntervals
} from "./calendarResolver.js";

const DEFAULT_MAX_RESERVATIONS = 5000;
const DEFAULT_MAX_SEARCH_DAYS = 370;
const DEFAULT_MAX_SEGMENTS = 1000;

function toDate(value, code) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(code);
  return date;
}

function addUtcDays(dateString, days) {
  const match = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("SLOT_DATE_INVALID");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function normalizeReservations(reservations, maxReservations) {
  if (!Array.isArray(reservations)) throw new Error("SLOT_RESERVATIONS_ARRAY_REQUIRED");
  if (reservations.length > maxReservations) throw new Error("SLOT_RESERVATION_LIMIT_EXCEEDED");
  const values = reservations.map((reservation, index) => {
    const start = toDate(reservation?.start, `SLOT_RESERVATION_START_INVALID:${index}`);
    const end = toDate(reservation?.end, `SLOT_RESERVATION_END_INVALID:${index}`);
    if (end <= start) throw new Error(`SLOT_RESERVATION_ORDER_INVALID:${index}`);
    return { start, end };
  }).sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];
  for (const reservation of values) {
    const previous = merged[merged.length - 1];
    if (previous && reservation.start <= previous.end) {
      previous.end = new Date(Math.max(previous.end.getTime(), reservation.end.getTime()));
    } else {
      merged.push({ ...reservation });
    }
  }
  return merged;
}

function subtractBusy(interval, busy) {
  const free = [];
  let cursor = interval.start.getTime();
  const end = interval.end.getTime();
  for (const reservation of busy) {
    const busyStart = reservation.start.getTime();
    const busyEnd = reservation.end.getTime();
    if (busyEnd <= cursor) continue;
    if (busyStart >= end) break;
    if (busyStart > cursor) free.push({ start: new Date(cursor), end: new Date(Math.min(busyStart, end)) });
    cursor = Math.max(cursor, busyEnd);
    if (cursor >= end) break;
  }
  if (cursor < end) free.push({ start: new Date(cursor), end: new Date(end) });
  return free;
}

function trimForward(interval, anchor) {
  if (interval.end <= anchor) return null;
  return { start: new Date(Math.max(interval.start.getTime(), anchor.getTime())), end: interval.end };
}

function trimBackward(interval, anchor) {
  if (interval.start >= anchor) return null;
  return { start: interval.start, end: new Date(Math.min(interval.end.getTime(), anchor.getTime())) };
}

export function resolveCapacitySlot(input = {}) {
  const layers = input.calendar_layers || input.calendars;
  const timezone = resolveCalendarTimezone(layers);
  const anchor = toDate(input.anchor, "SLOT_ANCHOR_INVALID");
  const durationMinutes = Number(input.duration_minutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error("SLOT_DURATION_INVALID");

  const direction = String(input.direction || "FORWARD").trim().toUpperCase();
  if (!["FORWARD", "BACKWARD"].includes(direction)) throw new Error("SLOT_DIRECTION_INVALID");
  const allowSplit = input.allow_split === true;
  const maxReservations = Math.max(1, Math.min(100000, Number(input.max_reservations) || DEFAULT_MAX_RESERVATIONS));
  const maxSearchDays = Math.max(1, Math.min(3660, Number(input.max_search_days) || DEFAULT_MAX_SEARCH_DAYS));
  const maxSegments = Math.max(1, Math.min(10000, Number(input.max_segments) || DEFAULT_MAX_SEGMENTS));
  const busy = normalizeReservations(input.reservations || [], maxReservations);
  const baseDate = getLocalDateString(anchor, timezone);
  const freeIntervals = [];

  for (let offset = 0; offset <= maxSearchDays; offset += 1) {
    const dateString = addUtcDays(baseDate, direction === "FORWARD" ? offset : -offset);
    let working = resolveEffectiveUtcIntervals(layers, dateString)
      .flatMap((interval) => subtractBusy(interval, busy));
    if (direction === "FORWARD") {
      working = working.map((interval) => trimForward(interval, anchor)).filter(Boolean);
    } else {
      working = working.map((interval) => trimBackward(interval, anchor)).filter(Boolean).reverse();
    }
    freeIntervals.push(...working);

    if (!allowSplit) {
      for (const interval of working) {
        const available = (interval.end - interval.start) / 60000;
        if (available < durationMinutes) continue;
        if (direction === "FORWARD") {
          return {
            direction,
            duration_minutes: durationMinutes,
            start: new Date(interval.start),
            end: new Date(interval.start.getTime() + durationMinutes * 60000),
            segments: [{ start: new Date(interval.start), end: new Date(interval.start.getTime() + durationMinutes * 60000) }]
          };
        }
        return {
          direction,
          duration_minutes: durationMinutes,
          start: new Date(interval.end.getTime() - durationMinutes * 60000),
          end: new Date(interval.end),
          segments: [{ start: new Date(interval.end.getTime() - durationMinutes * 60000), end: new Date(interval.end) }]
        };
      }
    } else {
      let remaining = durationMinutes;
      const segments = [];
      for (const interval of freeIntervals) {
        if (segments.length >= maxSegments) throw new Error("SLOT_SEGMENT_LIMIT_EXCEEDED");
        const available = (interval.end - interval.start) / 60000;
        if (available <= 0) continue;
        const used = Math.min(remaining, available);
        if (direction === "FORWARD") {
          segments.push({ start: new Date(interval.start), end: new Date(interval.start.getTime() + used * 60000) });
        } else {
          segments.push({ start: new Date(interval.end.getTime() - used * 60000), end: new Date(interval.end) });
        }
        remaining -= used;
        if (remaining <= 0) {
          const chronological = [...segments].sort((a, b) => a.start - b.start);
          return {
            direction,
            duration_minutes: durationMinutes,
            start: chronological[0].start,
            end: chronological[chronological.length - 1].end,
            segments: chronological
          };
        }
      }
    }
  }
  return null;
}
