import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_RESOLVED_ADDRESSES = 16;

class OutboundHttpPolicyError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "OutboundHttpPolicyError";
    this.code = code;
    this.status = status;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function ipv4ToInt(address) {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function ipv4InCidr(address, base, prefix) {
  const value = ipv4ToInt(address);
  const baseValue = ipv4ToInt(base);
  if (value === null || baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isBlockedIpv4(address) {
  const ranges = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  return ranges.some(([base, prefix]) => ipv4InCidr(address, base, prefix));
}

function normalizeIpv6(address) {
  return text(address).toLowerCase().split("%")[0];
}

function isBlockedIpv6(address) {
  const value = normalizeIpv6(address);
  if (!value) return true;
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (value.startsWith("ff")) return true;
  if (value.startsWith("2001:db8:")) return true;

  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

function isBlockedIp(address) {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

function assertAllowedUrlShape(rawUrl) {
  let parsed;
  try {
    parsed = new URL(text(rawUrl));
  } catch {
    throw new OutboundHttpPolicyError("Outbound URL is invalid.", "OUTBOUND_URL_INVALID", 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new OutboundHttpPolicyError(
      "Outbound URL must use HTTP or HTTPS.",
      "OUTBOUND_PROTOCOL_FORBIDDEN",
      400
    );
  }
  if (parsed.username || parsed.password) {
    throw new OutboundHttpPolicyError(
      "Credentials may not be embedded in outbound URLs.",
      "OUTBOUND_URL_CREDENTIALS_FORBIDDEN",
      400
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new OutboundHttpPolicyError(
      "Outbound hostname is not allowed.",
      "OUTBOUND_HOST_FORBIDDEN",
      400
    );
  }
  return parsed;
}

async function resolveSafeOutboundUrl(rawUrl, options = {}) {
  const parsed = assertAllowedUrlShape(rawUrl);
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const literalFamily = net.isIP(hostname);
  let addresses;

  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    const lookupFn = options.lookupFn || dns.lookup;
    let resolved;
    try {
      resolved = await lookupFn(hostname, { all: true, verbatim: true });
    } catch {
      throw new OutboundHttpPolicyError(
        "Outbound hostname could not be resolved.",
        "OUTBOUND_DNS_RESOLUTION_FAILED",
        400
      );
    }
    addresses = Array.isArray(resolved) ? resolved.slice(0, MAX_RESOLVED_ADDRESSES) : [];
  }

  if (!addresses.length) {
    throw new OutboundHttpPolicyError(
      "Outbound hostname has no usable address.",
      "OUTBOUND_DNS_EMPTY",
      400
    );
  }

  for (const entry of addresses) {
    if (!entry?.address || isBlockedIp(entry.address)) {
      throw new OutboundHttpPolicyError(
        "Outbound hostname resolves to a private, local, reserved, or otherwise forbidden address.",
        "OUTBOUND_ADDRESS_FORBIDDEN",
        400
      );
    }
  }

  return {
    url: parsed,
    addresses: addresses.map((entry) => ({
      address: entry.address,
      family: Number(entry.family) || net.isIP(entry.address),
    })),
  };
}

function createPinnedLookup(addresses) {
  const candidates = Array.isArray(addresses) ? addresses : [];
  return function pinnedLookup(_hostname, options, callback) {
    const familyPreference = typeof options === "object" ? Number(options.family) || 0 : 0;
    const selected = candidates.find((entry) => !familyPreference || entry.family === familyPreference) || candidates[0];
    if (!selected) {
      callback(new Error("No pinned address is available."));
      return;
    }
    if (typeof options === "object" && options.all === true) {
      callback(null, candidates);
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

function joinBaseAndPath(baseUrl, pathSuffix) {
  const base = assertAllowedUrlShape(baseUrl);
  const suffix = text(pathSuffix || "/");
  if (!suffix) return base.toString();
  if (/^https?:\/\//i.test(suffix)) {
    throw new OutboundHttpPolicyError(
      "Health-check path must be relative to the configured base URL.",
      "OUTBOUND_HEALTH_PATH_INVALID",
      400
    );
  }
  const normalized = suffix.startsWith("/") ? suffix : `/${suffix}`;
  base.pathname = normalized;
  base.search = "";
  base.hash = "";
  return base.toString();
}

async function probeOutboundUrl(rawUrl, options = {}) {
  const method = text(options.method || "HEAD").toUpperCase();
  if (!["GET", "HEAD"].includes(method)) {
    throw new OutboundHttpPolicyError(
      "Connection probes are restricted to GET or HEAD.",
      "OUTBOUND_PROBE_METHOD_FORBIDDEN",
      400
    );
  }
  const timeoutMs = Math.max(250, Math.min(Number(options.timeoutMs) || 8000, 30_000));
  const maxResponseBytes = Math.max(1024, Math.min(Number(options.maxResponseBytes) || MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES));
  const resolved = await resolveSafeOutboundUrl(rawUrl, options);
  const requestFn = resolved.url.protocol === "https:" ? https.request : http.request;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof OutboundHttpPolicyError
        ? error
        : new OutboundHttpPolicyError("Outbound connection probe failed.", "OUTBOUND_PROBE_FAILED", 502));
    };

    const request = requestFn(resolved.url, {
      method,
      lookup: createPinnedLookup(resolved.addresses),
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "EIP-Core-V2-Connection-Probe/1.0",
      },
    }, (response) => {
      const statusCode = Number(response.statusCode) || 0;
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        fail(new OutboundHttpPolicyError(
          "Outbound connection probe does not follow redirects.",
          "OUTBOUND_REDIRECT_FORBIDDEN",
          502
        ));
        return;
      }

      let received = 0;
      response.on("data", (chunk) => {
        received += Buffer.byteLength(chunk);
        if (received > maxResponseBytes) {
          request.destroy();
          fail(new OutboundHttpPolicyError(
            "Outbound response exceeded the diagnostic size limit.",
            "OUTBOUND_RESPONSE_TOO_LARGE",
            502
          ));
        }
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          ok: statusCode >= 200 && statusCode < 400,
          status_code: statusCode,
          latency_ms: Math.max(0, Date.now() - started),
          resolved_family: resolved.addresses[0]?.family || null,
        });
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      fail(new OutboundHttpPolicyError("Outbound connection probe timed out.", "OUTBOUND_PROBE_TIMEOUT", 504));
    });
    request.on("error", fail);
    request.end();
  });
}

export {
  BLOCKED_HOSTNAMES,
  MAX_RESPONSE_BYTES,
  OutboundHttpPolicyError,
  assertAllowedUrlShape,
  createPinnedLookup,
  isBlockedIp,
  joinBaseAndPath,
  probeOutboundUrl,
  resolveSafeOutboundUrl,
};
