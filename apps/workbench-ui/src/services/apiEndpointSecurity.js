const DEFAULT_ALLOWED_PREFIXES = Object.freeze(["/api/eip/", "/api/public/"]);
const EIP_CONTRACT_PREFIXES = Object.freeze(["/api/eip/"]);
const VALIDATION_ERROR_MESSAGE = "Unsafe API endpoint.";

class ApiEndpointValidationError extends Error {
  constructor(code, message = VALIDATION_ERROR_MESSAGE) {
    super(message);
    this.name = "ApiEndpointValidationError";
    this.code = code;
  }
}

function fail(code) {
  throw new ApiEndpointValidationError(code);
}

function decodeRepeated(value) {
  let current = String(value);
  for (let index = 0; index < 3; index += 1) {
    let next;
    try {
      next = decodeURIComponent(current);
    } catch {
      fail("API_ENDPOINT_MALFORMED");
    }
    if (next === current) break;
    current = next;
  }
  return current;
}

function assertNoSchemeOrHost(value) {
  const candidate = String(value);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate)) {
    fail("API_ENDPOINT_SCHEME_FORBIDDEN");
  }
  if (candidate.startsWith("//")) {
    fail("API_ENDPOINT_HOST_FORBIDDEN");
  }
  if (candidate.includes("://")) {
    fail("API_ENDPOINT_SCHEME_FORBIDDEN");
  }
  if (candidate.includes("\\") || candidate.toLowerCase().includes("%5c")) {
    fail("API_ENDPOINT_BACKSLASH_FORBIDDEN");
  }
}

function assertNormalizedPath(pathname) {
  if (!pathname.startsWith("/")) fail("API_ENDPOINT_PATH_REQUIRED");
  if (pathname.includes("//")) fail("API_ENDPOINT_NOT_NORMALIZED");

  const segments = pathname.split("/");
  if (segments.includes(".") || segments.includes("..")) {
    fail("API_ENDPOINT_NOT_NORMALIZED");
  }
}

function isAllowedPrefix(pathname, allowedPrefixes) {
  return allowedPrefixes.some((prefix) => pathname.startsWith(prefix));
}

function normalizeApprovedApiPath(input, options = {}) {
  const allowedPrefixes = options.allowedPrefixes || DEFAULT_ALLOWED_PREFIXES;

  if (typeof input !== "string") fail("API_ENDPOINT_PATH_REQUIRED");
  if (!input || input.trim() !== input) fail("API_ENDPOINT_NOT_NORMALIZED");
  if (/[\u0000-\u001F\u007F\s]/.test(input)) fail("API_ENDPOINT_NOT_NORMALIZED");

  assertNoSchemeOrHost(input);

  const decodedInput = decodeRepeated(input);
  assertNoSchemeOrHost(decodedInput);
  // Metadata-governed requests intentionally reject decoded URL-like query/path
  // values. Contract metadata must not carry arbitrary destinations such as
  // callback URLs; any future URL-valued field needs a separate governed policy.
  if (decodedInput.includes("//")) fail("API_ENDPOINT_HOST_FORBIDDEN");

  let parsed;
  try {
    parsed = new URL(input, "https://eip.invalid");
  } catch {
    fail("API_ENDPOINT_MALFORMED");
  }

  if (parsed.origin !== "https://eip.invalid") fail("API_ENDPOINT_HOST_FORBIDDEN");
  if (parsed.hash) fail("API_ENDPOINT_FRAGMENT_FORBIDDEN");

  const rawPath = input.split(/[?#]/, 1)[0];
  if (rawPath !== parsed.pathname) fail("API_ENDPOINT_NOT_NORMALIZED");

  const decodedPath = decodeRepeated(parsed.pathname);
  assertNormalizedPath(parsed.pathname);
  assertNormalizedPath(decodedPath);

  if (!isAllowedPrefix(parsed.pathname, allowedPrefixes)) {
    fail("API_ENDPOINT_PREFIX_FORBIDDEN");
  }

  return `${parsed.pathname}${parsed.search}`;
}

function normalizeInternalApiPath(input) {
  return normalizeApprovedApiPath(input, { allowedPrefixes: DEFAULT_ALLOWED_PREFIXES });
}

function normalizeEipContractPath(input) {
  return normalizeApprovedApiPath(input, { allowedPrefixes: EIP_CONTRACT_PREFIXES });
}

export {
  ApiEndpointValidationError,
  normalizeApprovedApiPath,
  normalizeEipContractPath,
  normalizeInternalApiPath,
};
