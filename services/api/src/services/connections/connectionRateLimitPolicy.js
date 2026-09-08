const RATE_LIMIT_MAX_REQUESTS = 1_000_000;
const RATE_LIMIT_MAX_WINDOW_SEC = 86_400;
const RATE_LIMIT_MIN_WINDOW_SEC = 1;
const RATE_LIMIT_RETENTION_FLOOR_SEC = 3_600;

function configuredNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function inspectInboundRateLimit(profile) {
  const rateLimit = profile?.inbound?.rate_limit || {};
  const maxRequests = configuredNumber(rateLimit.max);
  const windowSec = configuredNumber(rateLimit.window_sec);
  const hasMax = maxRequests !== null;
  const hasWindow = windowSec !== null;
  const errors = [];

  if (!hasMax && !hasWindow) {
    return {
      configured: false,
      valid: true,
      max_requests: null,
      window_sec: null,
      errors,
    };
  }

  if (hasMax !== hasWindow) {
    errors.push({
      path: "inbound.rate_limit",
      code: "RATE_LIMIT_PAIR_REQUIRED",
      message: "Rate limit max and rate window must be configured together.",
    });
  }

  if (
    hasMax
    && (
      !Number.isInteger(maxRequests)
      || maxRequests < 1
      || maxRequests > RATE_LIMIT_MAX_REQUESTS
    )
  ) {
    errors.push({
      path: "inbound.rate_limit.max",
      code: "RATE_LIMIT_MAX_INVALID",
      message: `Rate limit max must be an integer between 1 and ${RATE_LIMIT_MAX_REQUESTS}.`,
    });
  }

  if (
    hasWindow
    && (
      !Number.isInteger(windowSec)
      || windowSec < RATE_LIMIT_MIN_WINDOW_SEC
      || windowSec > RATE_LIMIT_MAX_WINDOW_SEC
    )
  ) {
    errors.push({
      path: "inbound.rate_limit.window_sec",
      code: "RATE_LIMIT_WINDOW_INVALID",
      message: `Rate window must be an integer between ${RATE_LIMIT_MIN_WINDOW_SEC} and ${RATE_LIMIT_MAX_WINDOW_SEC} seconds.`,
    });
  }

  return {
    configured: true,
    valid: errors.length === 0,
    max_requests: Number.isFinite(maxRequests) ? maxRequests : null,
    window_sec: Number.isFinite(windowSec) ? windowSec : null,
    errors,
  };
}

export {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_MAX_WINDOW_SEC,
  RATE_LIMIT_MIN_WINDOW_SEC,
  RATE_LIMIT_RETENTION_FLOOR_SEC,
  inspectInboundRateLimit,
};
