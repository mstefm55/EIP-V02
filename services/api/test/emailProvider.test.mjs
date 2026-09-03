import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_BREVO_API_URL,
  normalizeEmailProvider,
  resolveFromAddress,
} from "../src/lib/email.js";

test("Brevo is selected when the V1-compatible API key is configured", () => {
  assert.equal(normalizeEmailProvider({ BREVO_API_KEY: "test-key" }), "brevo");
  assert.equal(normalizeEmailProvider({ EMAIL_API_KEY: "test-key" }), "brevo");
});

test("explicit email provider overrides automatic provider discovery", () => {
  assert.equal(
    normalizeEmailProvider({ EMAIL_PROVIDER: "smtp", BREVO_API_KEY: "test-key", SMTP_HOST: "smtp.example.com" }),
    "smtp"
  );
});

test("SMTP remains available as a fallback provider", () => {
  assert.equal(normalizeEmailProvider({ SMTP_HOST: "smtp.example.com" }), "smtp");
});

test("V1-compatible sender configuration is preferred", () => {
  assert.equal(
    resolveFromAddress({
      EMAIL_FROM: "noreply@eip-core.com",
      SMTP_FROM: "fallback@example.com",
      SMTP_USER: "user@example.com",
    }),
    "noreply@eip-core.com"
  );
});

test("Brevo API endpoint remains aligned with V1", () => {
  assert.equal(DEFAULT_BREVO_API_URL, "https://api.brevo.com/v3/smtp/email");
});
