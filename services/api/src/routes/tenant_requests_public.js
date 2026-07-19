import crypto from "node:crypto";
import { sendEmail } from "../lib/email.js";

const REQUEST_RATE_LIMIT = { max: 8, timeWindow: "10 minute" };
const REQUEST_BODY_LIMIT = 16 * 1024; // 16 KiB

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function buildPublicRouteConfig(app, rateLimit) {
  const config = { rateLimit };
  if (app.config?.corsOrigin !== undefined) {
    config.cors = {
      origin: app.config.corsOrigin,
      credentials: false,
    };
  }
  return config;
}

function supportMailbox(app) {
  return (
    normalizeString(app.config?.REQUEST_ACCESS_TO)
    || normalizeString(app.config?.SMTP_FROM)
    || normalizeString(app.config?.SMTP_USER)
    || ""
  );
}

function buildReferenceCode() {
  const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${suffix}`;
}

export default async function tenantRequestsPublicRoutes(app) {
  app.post(
    "/tenant-requests",
    {
      config: buildPublicRouteConfig(app, REQUEST_RATE_LIMIT),
      bodyLimit: REQUEST_BODY_LIMIT,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "applicantType",
            "legalName",
            "email",
            "country",
            "timezone",
            "acceptTerms",
            "acceptPrivacy",
          ],
          properties: {
            applicantType: { type: "string", enum: ["business", "sole_trader"] },
            legalName: { type: "string", minLength: 2, maxLength: 200 },
            businessRegNo: { type: "string", maxLength: 64 },
            personalIdNo: { type: "string", maxLength: 64 },
            email: { type: "string", minLength: 5, maxLength: 200 },
            phone: { type: "string", maxLength: 50 },
            country: { type: "string", minLength: 2, maxLength: 64 },
            timezone: { type: "string", minLength: 2, maxLength: 64 },
            acceptTerms: { type: "boolean" },
            acceptPrivacy: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body || {};
      const applicantType = normalizeString(body.applicantType);
      const legalName = normalizeString(body.legalName);
      const email = normalizeEmail(body.email);
      const phone = normalizeString(body.phone);
      const country = normalizeString(body.country);
      const timezone = normalizeString(body.timezone);
      const businessRegNo = normalizeString(body.businessRegNo);
      const personalIdNo = normalizeString(body.personalIdNo);

      if (!body.acceptTerms || !body.acceptPrivacy) {
        return reply.code(400).send({ ok: false, error: "CONSENT_REQUIRED" });
      }
      if (applicantType === "business" && !businessRegNo) {
        return reply.code(400).send({ ok: false, error: "BUSINESS_REG_REQUIRED" });
      }
      if (applicantType === "sole_trader" && !personalIdNo) {
        return reply.code(400).send({ ok: false, error: "PERSONAL_ID_REQUIRED" });
      }
      if (!email.includes("@")) {
        return reply.code(400).send({ ok: false, error: "INVALID_EMAIL" });
      }

      const refCode = buildReferenceCode();
      const recipient = supportMailbox(app);
      const lines = [
        "New EIP access request",
        `Reference: ${refCode}`,
        `Applicant type: ${applicantType}`,
        `Legal name: ${legalName}`,
        `Business reg no: ${businessRegNo || "-"}`,
        `Personal ID no: ${personalIdNo || "-"}`,
        `Email: ${email}`,
        `Phone: ${phone || "-"}`,
        `Country: ${country}`,
        `Timezone: ${timezone}`,
        `IP: ${normalizeString(request.ip) || "-"}`,
        `User-Agent: ${normalizeString(request.headers["user-agent"]) || "-"}`,
      ];
      const text = lines.join("\n");
      const html = `<pre>${text.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char]))}</pre>`;

      let delivery = "logged";
      if (recipient) {
        try {
          await sendEmail(app, recipient, `EIP access request ${refCode}`, text, html);
          delivery = "email";
        } catch (error) {
          request.log.error({
            event: "tenant_request_email_failed",
            ref: refCode,
            message: error?.message || String(error),
          });
        }
      }

      request.log.info({
        event: "tenant_request_received",
        ref: refCode,
        applicantType,
        emailHint: `${email.slice(0, 3)}***`,
        delivery,
      });

      return reply.code(202).send({
        ok: true,
        ref: refCode,
        delivery,
      });
    }
  );
}
