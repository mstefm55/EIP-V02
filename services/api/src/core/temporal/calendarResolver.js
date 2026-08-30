const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MAX_CALENDAR_LAYERS = 32;
const MAX_EXCEPTIONS_PER_LAYER = 5000;
const MAX_SEARCH_DAYS = 3660;

function assertTimezone(timezone) {
  const tz = String(timezone || "").trim();
  if (!tz) throw new Error("CALENDAR_TIMEZONE_REQUIRED");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
  } catch {
    throw new Error(`CALENDAR_TIMEZONE_INVALID:${tz}`);
  }
  return tz;
}

function parseDate(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`CALENDAR_DATE_INVALID:${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function parseTimeToMinute(value, { allow24 = false } = {}) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`CALENDAR_TIME_INVALID:${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (allow24 && hour === 24 && minute === 0) return 1440;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`CALENDAR_TIME_INVALID:${value}`);
  }
  return hour * 60 + minute;
}

function minuteToTime(minute) {
  if (minute === 1440) return "24:00";
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function normalizeIntervals(intervals = []) {
  if (!Array.isArray(intervals)) throw new Error("CALENDAR_INTERVALS_ARRAY_REQUIRED");
  const normalized = intervals.map((interval, index) => {
    if (!interval || typeof interval !== "object") {
      throw new Error(`CALENDAR_INTERVAL_INVALID:${index}`);
    }
    const start = parseTimeToMinute(interval.start);
    const end = parseTimeToMinute(interval.end, { allow24: true });
    if (end <= start) throw new Error(`CALENDAR_INTERVAL_ORDER_INVALID:${index}`);
    return { start, end };
  }).sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];
  for (const current of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function addDays(dateString, days) {
  const { year, month, day } = parseDate(dateString);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dayName(dateString) {
  const { year, month, day } = parseDate(dateString);
  return DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function matchesException(exception, dateString) {
  if (!exception || typeof exception !== "object") return false;
  if (exception.date) return exception.date === dateString;
  if (exception.start_date && exception.end_date) {
    return dateString >= exception.start_date && dateString <= exception.end_date;
  }
  return false;
}

function resolveLayerIntervals(layer, dateString) {
  if (!layer || typeof layer !== "object") throw new Error("CALENDAR_LAYER_INVALID");
  const exceptions = Array.isArray(layer.exceptions) ? layer.exceptions : [];
  if (exceptions.length > MAX_EXCEPTIONS_PER_LAYER) throw new Error("CALENDAR_EXCEPTION_LIMIT_EXCEEDED");

  for (let index = exceptions.length - 1; index >= 0; index -= 1) {
    const exception = exceptions[index];
    if (!matchesException(exception, dateString)) continue;
    if (exception.closed === true) return [];
    if (Array.isArray(exception.intervals)) return normalizeIntervals(exception.intervals);
  }

  if (!layer.weekly || typeof layer.weekly !== "object") {
    return [{ start: 0, end: 1440 }];
  }
  const intervals = layer.weekly[dayName(dateString)] || [];
  return normalizeIntervals(intervals);
}

function intersectTwo(a, b) {
  const result = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (start < end) result.push({ start, end });
    if (a[i].end <= b[j].end) i += 1;
    else j += 1;
  }
  return result;
}

function formatParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

export function getLocalDateString(instant, timezone) {
  const tz = assertTimezone(timezone);
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error("CALENDAR_INSTANT_INVALID");
  const parts = formatParts(date, tz);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedLocalToUtc(dateString, minuteOfDay, timezone) {
  const tz = assertTimezone(timezone);
  let localDate = dateString;
  let minute = minuteOfDay;
  if (minute === 1440) {
    localDate = addDays(dateString, 1);
    minute = 0;
  }
  const parsed = parseDate(localDate);
  const hour = Math.floor(minute / 60);
  const min = minute % 60;
  const desired = Date.UTC(parsed.year, parsed.month - 1, parsed.day, hour, min, 0, 0);
  let guess = desired;

  for (let i = 0; i < 4; i += 1) {
    const observed = formatParts(new Date(guess), tz);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      0
    );
    const offset = observedAsUtc - guess;
    const next = desired - offset;
    if (Math.abs(next - guess) < 1000) {
      guess = next;
      break;
    }
    guess = next;
  }
  return new Date(guess);
}

export function resolveCalendarTimezone(layers) {
  if (!Array.isArray(layers) || layers.length === 0) throw new Error("CALENDAR_LAYERS_REQUIRED");
  if (layers.length > MAX_CALENDAR_LAYERS) throw new Error("CALENDAR_LAYER_LIMIT_EXCEEDED");
  const timezones = new Set(layers.map((layer) => assertTimezone(layer?.timezone)));
  if (timezones.size !== 1) throw new Error("CALENDAR_TIMEZONE_MISMATCH");
  return [...timezones][0];
}

export function resolveEffectiveDayIntervals(layers, dateString) {
  parseDate(dateString);
  resolveCalendarTimezone(layers);
  let result = [{ start: 0, end: 1440 }];
  for (const layer of layers) {
    result = intersectTwo(result, resolveLayerIntervals(layer, dateString));
    if (result.length === 0) break;
  }
  return result.map((interval) => ({
    start: minuteToTime(interval.start),
    end: minuteToTime(interval.end)
  }));
}

function resolveEffectiveMinuteIntervals(layers, dateString) {
  parseDate(dateString);
  resolveCalendarTimezone(layers);
  let result = [{ start: 0, end: 1440 }];
  for (const layer of layers) {
    result = intersectTwo(result, resolveLayerIntervals(layer, dateString));
    if (result.length === 0) break;
  }
  return result;
}

export function resolveEffectiveUtcIntervals(layers, dateString) {
  const timezone = resolveCalendarTimezone(layers);
  return resolveEffectiveMinuteIntervals(layers, dateString).map((interval) => ({
    start: zonedLocalToUtc(dateString, interval.start, timezone),
    end: zonedLocalToUtc(dateString, interval.end, timezone)
  }));
}

export function isWorkingInstant(layers, instant) {
  const timezone = resolveCalendarTimezone(layers);
  const value = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(value.getTime())) throw new Error("CALENDAR_INSTANT_INVALID");
  const dateString = getLocalDateString(value, timezone);
  return resolveEffectiveUtcIntervals(layers, dateString).some(
    (interval) => value >= interval.start && value < interval.end
  );
}

export function nextWorkingInstant(layers, instant, options = {}) {
  const timezone = resolveCalendarTimezone(layers);
  const value = instant instanceof Date ? new Date(instant) : new Date(instant);
  if (Number.isNaN(value.getTime())) throw new Error("CALENDAR_INSTANT_INVALID");
  const maxDays = Math.min(MAX_SEARCH_DAYS, Math.max(1, Number(options.maxDays) || 370));
  const baseDate = getLocalDateString(value, timezone);

  for (let dayOffset = 0; dayOffset <= maxDays; dayOffset += 1) {
    const dateString = addDays(baseDate, dayOffset);
    for (const interval of resolveEffectiveUtcIntervals(layers, dateString)) {
      if (interval.end <= value) continue;
      return new Date(Math.max(value.getTime(), interval.start.getTime()));
    }
  }
  throw new Error("CALENDAR_NEXT_WORKING_INSTANT_NOT_FOUND");
}

export function previousWorkingInstant(layers, instant, options = {}) {
  const timezone = resolveCalendarTimezone(layers);
  const value = instant instanceof Date ? new Date(instant) : new Date(instant);
  if (Number.isNaN(value.getTime())) throw new Error("CALENDAR_INSTANT_INVALID");
  const maxDays = Math.min(MAX_SEARCH_DAYS, Math.max(1, Number(options.maxDays) || 370));
  const baseDate = getLocalDateString(value, timezone);

  for (let dayOffset = 0; dayOffset <= maxDays; dayOffset += 1) {
    const dateString = addDays(baseDate, -dayOffset);
    const intervals = resolveEffectiveUtcIntervals(layers, dateString);
    for (let i = intervals.length - 1; i >= 0; i -= 1) {
      const interval = intervals[i];
      if (interval.start >= value) continue;
      return new Date(Math.min(value.getTime(), interval.end.getTime()));
    }
  }
  throw new Error("CALENDAR_PREVIOUS_WORKING_INSTANT_NOT_FOUND");
}

export function addWorkingMinutes(layers, instant, workingMinutes, options = {}) {
  let remaining = Number(workingMinutes);
  if (!Number.isFinite(remaining) || remaining < 0) throw new Error("CALENDAR_WORKING_MINUTES_INVALID");
  let cursor = nextWorkingInstant(layers, instant, options);
  if (remaining === 0) return cursor;
  const timezone = resolveCalendarTimezone(layers);
  const maxDays = Math.min(MAX_SEARCH_DAYS, Math.max(1, Number(options.maxDays) || 3700));
  let searched = 0;

  while (remaining > 0 && searched <= maxDays) {
    const localDate = getLocalDateString(cursor, timezone);
    const intervals = resolveEffectiveUtcIntervals(layers, localDate);
    for (const interval of intervals) {
      if (interval.end <= cursor) continue;
      const start = new Date(Math.max(cursor.getTime(), interval.start.getTime()));
      const available = (interval.end.getTime() - start.getTime()) / 60000;
      if (available >= remaining) return new Date(start.getTime() + remaining * 60000);
      remaining -= available;
      cursor = new Date(interval.end);
    }
    cursor = nextWorkingInstant(layers, new Date(cursor.getTime() + 1), options);
    searched += 1;
  }
  throw new Error("CALENDAR_ADD_WORKING_TIME_LIMIT_EXCEEDED");
}

export function subtractWorkingMinutes(layers, instant, workingMinutes, options = {}) {
  let remaining = Number(workingMinutes);
  if (!Number.isFinite(remaining) || remaining < 0) throw new Error("CALENDAR_WORKING_MINUTES_INVALID");
  let cursor = previousWorkingInstant(layers, instant, options);
  if (remaining === 0) return cursor;
  const timezone = resolveCalendarTimezone(layers);
  const maxDays = Math.min(MAX_SEARCH_DAYS, Math.max(1, Number(options.maxDays) || 3700));
  let searched = 0;

  while (remaining > 0 && searched <= maxDays) {
    const probe = new Date(cursor.getTime() - 1);
    const localDate = getLocalDateString(probe, timezone);
    const intervals = resolveEffectiveUtcIntervals(layers, localDate);
    for (let i = intervals.length - 1; i >= 0; i -= 1) {
      const interval = intervals[i];
      if (interval.start >= cursor) continue;
      const end = new Date(Math.min(cursor.getTime(), interval.end.getTime()));
      const available = (end.getTime() - interval.start.getTime()) / 60000;
      if (available >= remaining) return new Date(end.getTime() - remaining * 60000);
      remaining -= available;
      cursor = new Date(interval.start);
    }
    cursor = previousWorkingInstant(layers, new Date(cursor.getTime() - 1), options);
    searched += 1;
  }
  throw new Error("CALENDAR_SUBTRACT_WORKING_TIME_LIMIT_EXCEEDED");
}

export function workingMinutesBetween(layers, startInstant, endInstant, options = {}) {
  const start = startInstant instanceof Date ? startInstant : new Date(startInstant);
  const end = endInstant instanceof Date ? endInstant : new Date(endInstant);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("CALENDAR_INSTANT_INVALID");
  if (end < start) return -workingMinutesBetween(layers, end, start, options);
  if (end.getTime() === start.getTime()) return 0;

  const timezone = resolveCalendarTimezone(layers);
  const maxDays = Math.min(MAX_SEARCH_DAYS, Math.max(1, Number(options.maxDays) || 3700));
  let dateString = getLocalDateString(start, timezone);
  const endDate = getLocalDateString(end, timezone);
  let total = 0;
  let days = 0;

  while (dateString <= endDate) {
    if (days > maxDays) throw new Error("CALENDAR_WORKING_BETWEEN_LIMIT_EXCEEDED");
    for (const interval of resolveEffectiveUtcIntervals(layers, dateString)) {
      const overlapStart = Math.max(start.getTime(), interval.start.getTime());
      const overlapEnd = Math.min(end.getTime(), interval.end.getTime());
      if (overlapStart < overlapEnd) total += (overlapEnd - overlapStart) / 60000;
    }
    dateString = addDays(dateString, 1);
    days += 1;
  }
  return total;
}
