const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SECRET_VALUE_KEYS = new Set([
  "secret",
  "clientsecret",
  "password",
  "passwd",
  "token",
  "accesstoken",
  "refreshtoken",
  "testtoken",
  "apikeyvalue",
  "privatekey",
  "bearertoken",
  "secretref",
  "clientsecretref",
  "passwordref",
  "tokenref",
]);
const FORBIDDEN_HEADER_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "xapikey",
]);
const SERVER_OWNED_ROOT_KEYS = new Set([
  "id",
  "tenantid",
  "settingstatus",
  "health",
  "credentialstatus",
  "createdat",
  "updatedat",
]);

class ConnectionInputPolicyError extends Error {
  constructor(message, code = "CONNECTION_SECRET_IN_PROFILE_FORBIDDEN", status = 400, path = null) {
    super(message);
    this.name = "ConnectionInputPolicyError";
    this.code = code;
    this.status = status;
    this.path = path;
  }
}

function compactKey(key) {
  return String(key ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isForbiddenSecretValueKey(key, value) {
  const compact = compactKey(key);
  if (SECRET_VALUE_KEYS.has(compact)) return true;
  if (compact === "apikey") return !isPlainObject(value);
  return false;
}

function assertConnectionProfileInputSafe(value, path = "profile", depth = 0) {
  if (depth > 20) {
    throw new ConnectionInputPolicyError(
      "Connection profile payload is too deeply nested.",
      "CONNECTION_PROFILE_DEPTH_EXCEEDED",
      400,
      path
    );
  }
  if (value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) {
      throw new ConnectionInputPolicyError(
        "Connection profile array exceeds the bounded item limit.",
        "CONNECTION_PROFILE_ARRAY_TOO_LARGE",
        400,
        path
      );
    }
    value.forEach((entry, index) => assertConnectionProfileInputSafe(entry, `${path}[${index}]`, depth + 1));
    return true;
  }
  if (!isPlainObject(value)) {
    throw new ConnectionInputPolicyError(
      "Connection profile payload contains an unsupported object value.",
      "CONNECTION_PROFILE_OBJECT_INVALID",
      400,
      path
    );
  }

  for (const [key, entry] of Object.entries(value)) {
    const compact = compactKey(key);
    const compactPath = compactKey(path);
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new ConnectionInputPolicyError(
        "Connection profile contains a forbidden object key.",
        "CONNECTION_PROFILE_KEY_FORBIDDEN",
        400,
        `${path}.${key}`
      );
    }
    if (compact === "tenantid" || (depth === 0 && SERVER_OWNED_ROOT_KEYS.has(compact))) {
      throw new ConnectionInputPolicyError(
        "Tenant scope and server-owned connection state cannot be supplied by the client.",
        "CONNECTION_SERVER_OWNED_FIELD_FORBIDDEN",
        400,
        `${path}.${key}`
      );
    }
    if (compactPath === "profileverification" && compact === "oauth2jwt") {
      throw new ConnectionInputPolicyError(
        "OAuth/JWT is not an inbound EIP connection authentication mode.",
        "CONNECTION_INBOUND_AUTH_MODE_FORBIDDEN",
        400,
        `${path}.${key}`
      );
    }
    if (isForbiddenSecretValueKey(key, entry)) {
      throw new ConnectionInputPolicyError(
        "Credential material must be managed through the encrypted connection secret lifecycle, not the profile payload.",
        "CONNECTION_SECRET_IN_PROFILE_FORBIDDEN",
        400,
        `${path}.${key}`
      );
    }

    if (compactPath.endsWith("defaultheaders") && FORBIDDEN_HEADER_KEYS.has(compact)) {
      throw new ConnectionInputPolicyError(
        "Sensitive authentication headers must not be persisted in connection profile metadata.",
        "CONNECTION_SENSITIVE_HEADER_FORBIDDEN",
        400,
        `${path}.${key}`
      );
    }

    assertConnectionProfileInputSafe(entry, `${path}.${key}`, depth + 1);
  }
  return true;
}

export {
  ConnectionInputPolicyError,
  assertConnectionProfileInputSafe,
  isForbiddenSecretValueKey,
};
