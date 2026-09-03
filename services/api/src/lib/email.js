import nodemailer from "nodemailer";

const DEFAULT_BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

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

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeEmailProvider(config = {}) {
  const explicit = normalizeString(config.EMAIL_PROVIDER).toLowerCase();
  if (explicit) return explicit;
  if (firstNonEmpty(config.BREVO_API_KEY, config.EMAIL_API_KEY)) return "brevo";
  if (normalizeString(config.SMTP_HOST)) return "smtp";
  return "";
}

function resolveFromAddress(config = {}) {
  return firstNonEmpty(
    config.EMAIL_FROM,
    config.SMTP_FROM,
    config.SMTP_USER
  );
}

function resolveFromName(config = {}) {
  return normalizeString(config.EMAIL_FROM_NAME);
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

function createEmailTransporter(config = {}) {
  const transportConfig = buildTransportConfig(config);
  if (!transportConfig) return null;
  return nodemailer.createTransport(transportConfig);
}

async function sendEmailWithTransporter(transporter, options) {
  if (!transporter) {
    return { ok: false, error: "SMTP_NOT_CONFIGURED" };
  }

  try {
    const info = await transporter.sendMail({
      from: options.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    return { ok: true, messageId: info.messageId || null };
  } catch (error) {
    return { ok: false, error: error?.message || "SMTP_DELIVERY_FAILED" };
  }
}

function toRecipients(to) {
  return normalizeString(to)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.*)<([^>]+)>$/);
      if (match) {
        const name = normalizeString(match[1]).replace(/^"|"$/g, "");
        const email = normalizeString(match[2]);
        return name ? { email, name } : { email };
      }
      return { email: entry };
    });
}

async function sendEmailWithBrevo(config, options) {
  const apiKey = firstNonEmpty(config.BREVO_API_KEY, config.EMAIL_API_KEY);
  if (!apiKey) {
    return { ok: false, error: "BREVO_API_KEY_MISSING" };
  }

  const endpoint = firstNonEmpty(config.EMAIL_API_BASE_URL, DEFAULT_BREVO_API_URL);
  const recipients = toRecipients(options.to);
  if (recipients.length === 0) {
    return { ok: false, error: "EMAIL_RECIPIENT_MISSING" };
  }

  const sender = { email: options.from };
  if (options.fromName) sender.name = options.fromName;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender,
        to: recipients,
        subject: options.subject,
        textContent: options.text,
        htmlContent: options.html,
      }),
    });

    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail = payload?.message || payload?.code || raw || `HTTP_${response.status}`;
      return { ok: false, error: detail };
    }

    return {
      ok: true,
      messageId: payload?.messageId || payload?.messageIds?.[0] || null,
    };
  } catch (error) {
    return { ok: false, error: error?.message || "BREVO_DELIVERY_FAILED" };
  }
}

async function sendEmail(app, to, subject, text, html) {
  const recipient = normalizeString(to).toLowerCase();
  if (!recipient) {
    throw new Error("EMAIL_RECIPIENT_REQUIRED");
  }

  const config = app?.config || {};
  const sender = resolveFromAddress(config);
  if (!sender) {
    throw new Error("EMAIL_SENDER_NOT_CONFIGURED");
  }

  const provider = normalizeEmailProvider(config);
  let result;

  if (provider === "brevo") {
    result = await sendEmailWithBrevo(config, {
      from: sender,
      fromName: resolveFromName(config),
      to: recipient,
      subject: normalizeString(subject) || "EIP notification",
      text: normalizeString(text),
      html: normalizeString(html),
    });
  } else if (provider === "smtp") {
    const transporter = createEmailTransporter(config);
    result = await sendEmailWithTransporter(transporter, {
      from: sender,
      to: recipient,
      subject: normalizeString(subject) || "EIP notification",
      text: normalizeString(text),
      html: normalizeString(html),
    });
  } else {
    throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  }

  if (!result?.ok) {
    app?.log?.error?.({
      event: "email_delivery_failed",
      provider,
      error: result?.error || "EMAIL_DELIVERY_FAILED",
    });
    throw new Error(result?.error || "EMAIL_DELIVERY_FAILED");
  }

  return result;
}

export {
  DEFAULT_BREVO_API_URL,
  buildTransportConfig,
  createEmailTransporter,
  normalizeEmailProvider,
  resolveFromAddress,
  sendEmail,
  sendEmailWithBrevo,
  sendEmailWithTransporter,
};
