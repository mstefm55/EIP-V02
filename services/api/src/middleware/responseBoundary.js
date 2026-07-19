function stripSensitiveFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripSensitiveFields);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output = {};
  const blockedKeys = new Set([
    "password",
    "passwordHash",
    "secret",
    "secrets",
    "token",
    "accessToken",
    "refreshToken",
    "apiKey",
    "privateKey",
    "rawRow",
    "raw",
    "internalNotes",
  ]);

  for (const [key, entry] of Object.entries(value)) {
    if (blockedKeys.has(key)) {
      continue;
    }

    output[key] = stripSensitiveFields(entry);
  }

  return output;
}

function responseBoundary(options = {}) {
  return function responseBoundaryMiddleware(request, response, next) {
    if (response && typeof response.json === "function") {
      response.safeJson = function safeJson(payload) {
        return response.json(stripSensitiveFields(payload));
      };
    }

    if (response && typeof response.send === "function") {
      response.safeSend = function safeSend(payload) {
        return response.send(stripSensitiveFields(payload));
      };
    }

    if (typeof next === "function") {
      next();
    }
  };
}

module.exports = {
  responseBoundary,
  stripSensitiveFields,
};
