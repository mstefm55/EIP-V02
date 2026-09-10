import crypto from "node:crypto";
import { withTenantTransaction } from "../../db/tenantTransaction.js";
import { readSecret } from "./connectionSecretStore.js";
import { performSafeHttpRequest } from "./connectionOutboundRuntime.js";

const SUPPORTED_PROVIDER_SIGNATURES = new Set(["stripe", "paypal"]);
const PAYPAL_CERT_HOST_PATTERN = /(^|\.)paypal\.com$/i;
const DEFAULT_SIGNATURE_TOLERANCE_SEC = 300;

class ConnectionProviderVerificationError extends Error {
  constructor(message, code, status = 401) {
    super(message);
    this.name = "ConnectionProviderVerificationError";
    this.code = code;
    this.status = status;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function headerValue(headers, name) {
  const target = text(name).toLowerCase();
  if (!target) return "";
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() !== target) continue;
    if (Array.isArray(value)) return text(value[0]);
    return text(value);
  }
  return "";
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signatureToleranceSeconds(profile) {
  const configured = Number(profile?.verification?.provider_signature?.max_skew_sec);
  if (!Number.isFinite(configured)) return DEFAULT_SIGNATURE_TOLERANCE_SEC;
  return Math.max(0, Math.min(Math.floor(configured), 3600));
}

function providerCode(profile) {
  return text(
    profile?.verification?.provider_signature?.provider_code
      || profile?.routing?.provider_code
  ).toLowerCase();
}

async function readProviderSecret({ pool, tenantId, profile, config, secretKind }) {
  const value = await withTenantTransaction(pool, tenantId, (client) =>
    readSecret({
      client,
      tenantId,
      connectionCode: profile?.identity?.connection_code,
      secretKind,
      config,
    })
  );
  if (!value) {
    throw new ConnectionProviderVerificationError(
      "Provider verification credential is unavailable.",
      "CONNECTION_PROVIDER_SIGNATURE_SECRET_UNAVAILABLE",
      503
    );
  }
  return value;
}

function parseStripeSignatureHeader(value) {
  const output = { timestamp: null, signatures: [] };
  for (const segment of String(value || "").split(",")) {
    const index = segment.indexOf("=");
    if (index <= 0) continue;
    const key = segment.slice(0, index).trim();
    const entry = segment.slice(index + 1).trim();
    if (key === "t" && /^\d{1,16}$/.test(entry)) output.timestamp = Number(entry);
    if (key === "v1" && /^[0-9a-f]{64}$/i.test(entry)) output.signatures.push(entry.toLowerCase());
  }
  return output;
}

async function verifyStripeProviderSignature({
  pool,
  tenantId,
  profile,
  headers,
  rawBody,
  config,
  now = Date.now(),
}) {
  const provider = profile?.verification?.provider_signature || {};
  const headerName = text(provider.header_name || "stripe-signature") || "stripe-signature";
  const presented = headerValue(headers, headerName);
  if (!presented) {
    throw new ConnectionProviderVerificationError(
      "Stripe signature header is required.",
      "CONNECTION_STRIPE_SIGNATURE_REQUIRED",
      401
    );
  }
  const parsed = parseStripeSignatureHeader(presented);
  if (!Number.isFinite(parsed.timestamp) || parsed.signatures.length === 0) {
    throw new ConnectionProviderVerificationError(
      "Stripe signature header is invalid.",
      "CONNECTION_STRIPE_SIGNATURE_INVALID",
      401
    );
  }
  const tolerance = signatureToleranceSeconds(profile);
  if (tolerance > 0 && Math.abs(now - parsed.timestamp * 1000) > tolerance * 1000) {
    throw new ConnectionProviderVerificationError(
      "Stripe signature timestamp is outside the configured tolerance.",
      "CONNECTION_STRIPE_SIGNATURE_TIMESTAMP_INVALID",
      401
    );
  }

  const secretKind = text(provider.secret_kind || "webhook_signing_secret").toLowerCase();
  const secret = await readProviderSecret({ pool, tenantId, profile, config, secretKind });
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
  const signedPayload = Buffer.concat([
    Buffer.from(`${parsed.timestamp}.`, "utf8"),
    bodyBuffer,
  ]);
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  if (!parsed.signatures.some((signature) => timingSafeEqualText(signature, expected))) {
    throw new ConnectionProviderVerificationError(
      "Stripe signature verification failed.",
      "CONNECTION_STRIPE_SIGNATURE_INVALID",
      401
    );
  }
  return {
    verified: true,
    mode: "provider_signature",
    assurance: "provider_signature",
    provider: "stripe",
  };
}

let CRC32_TABLE = null;
function crc32Table() {
  if (CRC32_TABLE) return CRC32_TABLE;
  CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    return value >>> 0;
  });
  return CRC32_TABLE;
}

function crc32Decimal(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || "");
  let crc = 0xffffffff;
  const table = crc32Table();
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(10);
}

function assertPaypalCertificateUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(text(rawUrl));
  } catch {
    throw new ConnectionProviderVerificationError(
      "PayPal certificate URL is invalid.",
      "CONNECTION_PAYPAL_CERT_URL_INVALID",
      401
    );
  }
  if (parsed.protocol !== "https:" || !PAYPAL_CERT_HOST_PATTERN.test(parsed.hostname)) {
    throw new ConnectionProviderVerificationError(
      "PayPal certificate URL is not trusted.",
      "CONNECTION_PAYPAL_CERT_URL_FORBIDDEN",
      401
    );
  }
  return parsed;
}

async function verifyPayPalProviderSignature({
  profile,
  headers,
  rawBody,
  now = Date.now(),
  transport = performSafeHttpRequest,
}) {
  const provider = profile?.verification?.provider_signature || {};
  const webhookId = text(provider.webhook_id);
  if (!webhookId) {
    throw new ConnectionProviderVerificationError(
      "PayPal webhook ID is not configured.",
      "CONNECTION_PAYPAL_WEBHOOK_ID_REQUIRED",
      503
    );
  }

  const transmissionId = headerValue(headers, "paypal-transmission-id");
  const transmissionTime = headerValue(headers, "paypal-transmission-time");
  const certUrl = headerValue(headers, "paypal-cert-url");
  const authAlgo = headerValue(headers, "paypal-auth-algo");
  const signature = headerValue(headers, "paypal-transmission-sig");
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !signature) {
    throw new ConnectionProviderVerificationError(
      "Required PayPal verification headers are missing.",
      "CONNECTION_PAYPAL_SIGNATURE_HEADERS_REQUIRED",
      401
    );
  }
  if (!/sha256.*rsa|rsa.*sha256/i.test(authAlgo.replace(/[^a-z0-9]/gi, ""))) {
    throw new ConnectionProviderVerificationError(
      "PayPal signature algorithm is unsupported.",
      "CONNECTION_PAYPAL_SIGNATURE_ALGORITHM_UNSUPPORTED",
      401
    );
  }

  const transmittedAt = Date.parse(transmissionTime);
  const tolerance = signatureToleranceSeconds(profile);
  if (!Number.isFinite(transmittedAt) || (tolerance > 0 && Math.abs(now - transmittedAt) > tolerance * 1000)) {
    throw new ConnectionProviderVerificationError(
      "PayPal transmission timestamp is outside the configured tolerance.",
      "CONNECTION_PAYPAL_SIGNATURE_TIMESTAMP_INVALID",
      401
    );
  }

  const trustedCertUrl = assertPaypalCertificateUrl(certUrl);
  const certResponse = await transport({
    url: trustedCertUrl,
    method: "GET",
    headers: { Accept: "application/x-pem-file, text/plain, */*" },
    timeoutMs: 5000,
    maxResponseBytes: 262_144,
  });
  if (certResponse.status_code < 200 || certResponse.status_code >= 300 || !certResponse.body_buffer?.length) {
    throw new ConnectionProviderVerificationError(
      "PayPal verification certificate could not be loaded.",
      "CONNECTION_PAYPAL_CERT_UNAVAILABLE",
      503
    );
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
  const message = `${transmissionId}|${transmissionTime}|${webhookId}|${crc32Decimal(bodyBuffer)}`;
  let verified = false;
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(message, "utf8");
    verifier.end();
    verified = verifier.verify(certResponse.body_buffer, Buffer.from(signature, "base64"));
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new ConnectionProviderVerificationError(
      "PayPal signature verification failed.",
      "CONNECTION_PAYPAL_SIGNATURE_INVALID",
      401
    );
  }

  return {
    verified: true,
    mode: "provider_signature",
    assurance: "provider_signature",
    provider: "paypal",
  };
}

async function verifyProviderSignature(options = {}) {
  const code = providerCode(options.profile);
  if (!SUPPORTED_PROVIDER_SIGNATURES.has(code)) {
    throw new ConnectionProviderVerificationError(
      "Configured provider signature adapter is unsupported.",
      "CONNECTION_PROVIDER_SIGNATURE_UNSUPPORTED",
      503
    );
  }
  if (code === "stripe") return verifyStripeProviderSignature(options);
  if (code === "paypal") return verifyPayPalProviderSignature(options);
  throw new ConnectionProviderVerificationError(
    "Configured provider signature adapter is unsupported.",
    "CONNECTION_PROVIDER_SIGNATURE_UNSUPPORTED",
    503
  );
}

export {
  ConnectionProviderVerificationError,
  DEFAULT_SIGNATURE_TOLERANCE_SEC,
  PAYPAL_CERT_HOST_PATTERN,
  SUPPORTED_PROVIDER_SIGNATURES,
  assertPaypalCertificateUrl,
  crc32Decimal,
  parseStripeSignatureHeader,
  providerCode,
  signatureToleranceSeconds,
  verifyPayPalProviderSignature,
  verifyProviderSignature,
  verifyStripeProviderSignature,
};
