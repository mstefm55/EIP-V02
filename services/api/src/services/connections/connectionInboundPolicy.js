const INBOUND_SUFFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SUPPORTED_INBOUND_HTTP_METHODS = Object.freeze(["POST", "PUT", "PATCH"]);
const SUPPORTED_INBOUND_HTTP_METHOD_SET = new Set(SUPPORTED_INBOUND_HTTP_METHODS);
const MAX_CONNECTION_BODY_BYTES = 5_242_880;

function normalizeInboundHttpMethod(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isSupportedInboundHttpMethod(value) {
  return SUPPORTED_INBOUND_HTTP_METHOD_SET.has(normalizeInboundHttpMethod(value));
}

function isValidInboundSuffix(value) {
  return INBOUND_SUFFIX_PATTERN.test(String(value ?? "").trim());
}

export {
  INBOUND_SUFFIX_PATTERN,
  MAX_CONNECTION_BODY_BYTES,
  SUPPORTED_INBOUND_HTTP_METHODS,
  SUPPORTED_INBOUND_HTTP_METHOD_SET,
  isSupportedInboundHttpMethod,
  isValidInboundSuffix,
  normalizeInboundHttpMethod,
};
