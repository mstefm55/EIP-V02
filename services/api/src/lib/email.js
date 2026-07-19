import nodemailer from "nodemailer";

function normalizeString(value) {
  return String(value ?? "").trim();
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = normalizeString(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildTransportConfig(config = {}) {
  const host = normalizeString(config.SMTP_HOST);
  const user = normalizeString(config.SMTP_USER);
  const pass = normalizeString(config.SMTP_PASS);
  const port = parseInteger(config.SMTP_PORT, 587);
  const secure = parseBoolean(config.SMTP_SECURE, false);

  if (!host || !user || !pass) {
    return null;
  }

  return {
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  };
}

function getTransport(app) {
  const transportConfig = buildTransportConfig(app?.config || {});
  if (!transportConfig) {
    return null;
  }
  return nodemailer.createTransport(transportConfig);
}

async function sendEmail(app, to, subject, text, html) {
  const recipient = normalizeString(to).toLowerCase();
  if (!recipient) {
    throw new Error("EMAIL_RECIPIENT_REQUIRED");
  }

  const sender = normalizeString(app?.config?.SMTP_FROM) || normalizeString(app?.config?.SMTP_USER);
  if (!sender) {
    throw new Error("EMAIL_SENDER_NOT_CONFIGURED");
  }

  const transport = getTransport(app);
  if (!transport) {
    throw new Error("SMTP_NOT_CONFIGURED");
  }

  const payload = {
    from: sender,
    to: recipient,
    subject: normalizeString(subject) || "EIP notification",
    text: normalizeString(text),
    html: normalizeString(html),
  };

  await transport.sendMail(payload);
  return { ok: true };
}

export { sendEmail };
