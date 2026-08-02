const OTP_LOGGING_ALLOWED_RUNTIME_MODES = new Set(["development", "local", "test"]);

function normalizeRuntimeMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "prod") return "production";
  if (normalized === "dev") return "development";
  return normalized;
}

function getRuntimeMode(config = {}) {
  return normalizeRuntimeMode(config.runtimeMode ?? config.NODE_ENV);
}

function hasExplicitRuntimeMode(config = {}) {
  if (typeof config.runtimeModeExplicit === "boolean") {
    return config.runtimeModeExplicit;
  }
  const rawRuntime = config.runtimeMode ?? config.NODE_ENV;
  return String(rawRuntime ?? "").trim().length > 0;
}

function canLogDevelopmentOtp(config = {}) {
  return config.LOG_DEV_OTP === true
    && hasExplicitRuntimeMode(config)
    && OTP_LOGGING_ALLOWED_RUNTIME_MODES.has(getRuntimeMode(config));
}

function logDevelopmentOtpIfAllowed({ config = {}, logger, challengeId, otp, recipient }) {
  if (!canLogDevelopmentOtp(config)) return false;
  logger?.info?.({
    event: "dev_otp",
    challenge_id: challengeId,
    otp,
    recipient,
  });
  return true;
}

function buildOtpChallengeResponse({ challengeId, expiresAt }) {
  return {
    ok: true,
    challenge_id: challengeId,
    expires_at: expiresAt instanceof Date ? expiresAt.toISOString() : String(expiresAt || ""),
  };
}

export {
  buildOtpChallengeResponse,
  canLogDevelopmentOtp,
  getRuntimeMode,
  hasExplicitRuntimeMode,
  logDevelopmentOtpIfAllowed,
  normalizeRuntimeMode,
};
