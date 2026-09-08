import crypto from "node:crypto";
import {
  ConnectionInboundRuntimeError,
  assertInboundRequestAllowed,
  resolvePublicConnection,
  verifyInboundRequest,
} from "../services/connections/connectionInboundRuntime.js";
import { claimInboundReceipt } from "../services/connections/connectionInboundReceipt.js";

const PUBLIC_METHODS = Object.freeze(["POST", "PUT", "PATCH"]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function mapRuntimeError(error) {
  if (error instanceof ConnectionInboundRuntimeError) {
    return {
      status: Number.isInteger(error.status) ? error.status : 400,
      error: error.code || "CONNECTION_INBOUND_REJECTED",
    };
  }
  return { status: 500, error: "CONNECTION_INBOUND_UNAVAILABLE" };
}

function channelForRequest(req) {
  const url = normalizeText(req?.raw?.url).split("?")[0];
  return url.startsWith("/api/edi/") ? "edi" : "public";
}

function assertChannelMatch(profile, requestedChannel) {
  const configured = normalizeText(profile?.routing?.channel).toLowerCase();
  if (requestedChannel === "edi" && configured !== "edi") {
    throw new ConnectionInboundRuntimeError(
      "Connection is not configured for the EDI channel.",
      "CHANNEL_MISMATCH",
      403
    );
  }
  if (requestedChannel === "public" && configured === "edi") {
    throw new ConnectionInboundRuntimeError(
      "EDI connections must use the governed EDI webhook route.",
      "CHANNEL_MISMATCH",
      403
    );
  }
}

function configureRawBodyParser(app) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, Buffer.isBuffer(body) ? body : Buffer.from(body || ""));
  });
}

function responseTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export default async function publicConnectionRoutes(app, options = {}) {
  const deps = {
    resolvePublicConnection,
    assertInboundRequestAllowed,
    verifyInboundRequest,
    claimInboundReceipt,
    ...(options.services || {}),
  };

  configureRawBodyParser(app);

  async function handleInbound(req, reply) {
    const correlationId = crypto.randomUUID();
    try {
      const resolved = await deps.resolvePublicConnection(
        app.db,
        req.params.tenantCode,
        req.params.suffix
      );
      if (!resolved) {
        return reply.code(404).send({ ok: false, error: "ROUTING_NOT_FOUND", correlation_id: correlationId });
      }

      const { tenant, profile } = resolved;
      const requestedChannel = channelForRequest(req);
      assertChannelMatch(profile, requestedChannel);
      deps.assertInboundRequestAllowed(profile, {
        method: req.method,
        contentType: req.headers?.["content-type"],
        origin: req.headers?.origin,
        ip: req.ip,
        rawBody: req.body,
      });

      const verification = await deps.verifyInboundRequest({
        pool: app.db,
        tenantId: tenant.tenant_id,
        profile,
        headers: req.headers,
        rawBody: req.body,
        config: app.config,
      });

      const receipt = await deps.claimInboundReceipt({
        pool: app.db,
        tenantId: tenant.tenant_id,
        profile,
        request: {
          headers: req.headers,
          query: req.query,
          rawBody: req.body,
        },
        verification,
        channel: requestedChannel,
        correlationId,
      });

      if (receipt.duplicate) {
        req.log.info({
          event: "connection_inbound_transport_duplicate",
          correlation_id: correlationId,
          tenant_id: tenant.tenant_id,
          connection_code: profile?.identity?.connection_code || null,
          verification_mode: verification.mode,
          channel: requestedChannel,
          receipt_id: receipt.receipt_id,
        });

        return reply.code(202).send({
          ok: true,
          accepted: true,
          duplicate: true,
          correlation_id: correlationId,
          receipt_id: receipt.receipt_id,
          accepted_at: responseTimestamp(receipt.accepted_at),
          connection_code: profile?.identity?.connection_code || null,
          verification: {
            mode: verification.mode,
            verified: verification.verified === true,
            assurance: verification.assurance,
          },
          channel: requestedChannel,
          dispatch_status: "DUPLICATE_SUPPRESSED",
          dispatch_message: "This event ID was already accepted with the same payload. Duplicate business dispatch was suppressed.",
        });
      }

      req.log.info({
        event: "connection_inbound_transport_accepted",
        correlation_id: correlationId,
        tenant_id: tenant.tenant_id,
        connection_code: profile?.identity?.connection_code || null,
        verification_mode: verification.mode,
        channel: requestedChannel,
        payload_bytes: Buffer.isBuffer(req.body) ? req.body.length : 0,
        receipt_id: receipt.receipt_id,
      });

      return reply.code(202).send({
        ok: true,
        accepted: true,
        duplicate: false,
        correlation_id: correlationId,
        receipt_id: receipt.receipt_id,
        accepted_at: responseTimestamp(receipt.accepted_at) || new Date().toISOString(),
        connection_code: profile?.identity?.connection_code || null,
        verification: {
          mode: verification.mode,
          verified: verification.verified === true,
          assurance: verification.assurance,
        },
        channel: requestedChannel,
        dispatch_status: "NOT_BOUND",
        dispatch_message: "Transport verification and idempotency succeeded. Business dispatch requires a governed Process/Service Object binding.",
      });
    } catch (error) {
      const mapped = mapRuntimeError(error);
      req.log.warn({
        event: "connection_inbound_transport_rejected",
        correlation_id: correlationId,
        error: mapped.error,
        status: mapped.status,
        tenant_code: normalizeText(req.params?.tenantCode).slice(0, 96),
        route_suffix: normalizeText(req.params?.suffix).slice(0, 128),
        ip: req.ip || null,
      });
      return reply.code(mapped.status).send({
        ok: false,
        error: mapped.error,
        correlation_id: correlationId,
      });
    }
  }

  const paramsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["tenantCode", "suffix"],
    properties: {
      tenantCode: { type: "string", minLength: 1, maxLength: 96 },
      suffix: { type: "string", minLength: 1, maxLength: 128 },
    },
  };

  app.route({
    method: [...PUBLIC_METHODS],
    url: "/api/public/gateway/intake/:tenantCode/:suffix",
    schema: { params: paramsSchema },
    handler: handleInbound,
  });

  app.route({
    method: [...PUBLIC_METHODS],
    url: "/api/edi/gateway/webhook/:tenantCode/:suffix",
    schema: { params: paramsSchema },
    handler: handleInbound,
  });
}

export {
  PUBLIC_METHODS,
  assertChannelMatch,
  channelForRequest,
  configureRawBodyParser,
  mapRuntimeError,
  responseTimestamp,
};
