import { buildPath, buildQuery } from "../services/apiClient.js";
import { normalizeEipContractPath } from "../services/apiEndpointSecurity.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function getPath(source, path) {
  if (!source || !path) return undefined;
  return path
    .split(".")
    .reduce((cursor, key) => (cursor && cursor[key] !== undefined ? cursor[key] : undefined), source);
}

function resolveTokenValue(value, scopes) {
  if (typeof value !== "string" || !value.startsWith("$")) return value;
  const token = value.slice(1);
  return getPath(scopes, token);
}

function resolveValue(value, scopes) {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, scopes));
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      output[key] = resolveValue(entry, scopes);
    }
    return output;
  }
  return resolveTokenValue(value, scopes);
}

function replacePathParams(endpoint, params = {}) {
  return String(endpoint || "").replace(/:([A-Za-z0-9_]+)/g, (match, key) => {
    const value = params[key];
    if (value === undefined || value === null || value === "") return match;
    return encodeURIComponent(String(value));
  });
}

function hasUnresolvedPathParam(endpoint) {
  return /:([A-Za-z0-9_]+)/.test(String(endpoint || ""));
}

function resolveContract(contract, ctx, options = {}) {
  if (!contract || typeof contract !== "object") return null;
  if (!contract.endpoint) return null;

  const scopes = {
    surface: ctx?.surfaceProps || {},
    surface_meta: ctx?.surfaceMeta || {},
    available_surfaces: ctx?.availableSurfaces || [],
    selection: ctx?.selection?.definition || {},
    auth: ctx?.auth?.session || {},
  };

  const pathParams = {
    ...(options.pathParams || {}),
  };
  if (pathParams.id === undefined) {
    pathParams.id = scopes.selection?.id;
  }

  const endpoint = replacePathParams(contract.endpoint, pathParams);
  if (hasUnresolvedPathParam(endpoint)) {
    return null;
  }
  const approvedEndpoint = normalizeEipContractPath(endpoint);

  const query = resolveValue(contract.query || {}, scopes);
  const mergedQuery = {
    ...query,
    ...(options.query || {}),
  };
  const pathWithQuery = normalizeEipContractPath(buildPath(approvedEndpoint, mergedQuery));

  return {
    endpoint: approvedEndpoint,
    pathWithQuery,
    method: String(contract.method || "GET").toUpperCase(),
    query: mergedQuery,
    queryString: buildQuery(mergedQuery),
  };
}

export {
  getPath,
  resolveContract,
  resolveValue,
};
