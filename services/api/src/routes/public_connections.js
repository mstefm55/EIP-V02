import crypto from "node:crypto";
import {
  ConnectionInboundRuntimeError,
  assertInboundRequestAllowed,
  resolvePublicConnection,
  verifyInboundRequest,
} from "../services/connections/connectionInboundRuntime.js";
import { acceptInboundRequest } from "../services/connections/connectionInboundDispatch.js";
import { enforceInboundRateLimit } from "../services/connections/connectionInboundRateLimit.js";

const PUBLIC_METHODS = Object.freeze(["POST", "PUT", "PATCH"]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function mapRuntimeError(error) {
  if (error instanceof ConnectionInboundRuntimeError) {
    const retryAfterSec = Number(error.retryAfterSec);
    return {
      status: Number.isInteger(error.status) ? error.status : 400,
      error: error.code || "CONNECTION_INBOUND_REJECTED",
      retry_after_sec:
        Number.isInteger(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec : null,
    };
  }
  return { status: 500, error: "CONNECTION_INBOUND_UNAVAILABLE", retry_after_sec: null };
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

function dispatchMessage(status) {
  if (status === "PROCESS_STARTED") {
    return "Inbound event was mapped to a governed Service Object and handed to the canonical Process Engine.";
  }
  if (status === "NOT_BOUND") {
    return "Transport verification and idempotency succeeded. Passthrough mapping does not start business processing.";
  }
  return "Inbound event was accepted.";
}

export default async function publicConnectionRoutes(app, options = {}) {
  const deps = {
    resolvePublicConnection,
    assertInboundRequestAllowed,
    enforceInboundRateLimit,
    verifyInboundRequest,
    acceptInboundRequest,
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

      // Rate limiting deliberately precedes credential verification. The shared
      // PostgreSQL bucket therefore counts bad-auth attempts as well as accepted
      // requests and remains authoritative across multiple API replicas.
      await deps.enforceInboundRateLimit({
        pool: app.db,
        tenantId: tenant.tenant_id,
        profile,
      });

      const verification = await deps.verifyInboundRequest({
        pool: app.db,
        tenantId: tenant.tenant_id,
        profile,
        headers: req.headers,
        rawBody: req.body,
        config: app.config,
      });

      const acceptance = await deps.acceptInboundRequest({
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
      const receipt = acceptance.receipt || {};
      const dispatch = acceptance.dispatch || null;

      if (acceptance.duplicate) {
        req.log.info({
          event: "connection_inbound_transport_duplicate",
          correlation_id: correlationId,
          tenant_id: tenant.tenant_id,
          connection_code: profile?.identity?.connection_code || null,
          verification_mode: verification.mode,
          channel: requestedChannel,
          receipt_id: receipt.receipt_id,
          original_dispatch_status: dispatch?.status || null,
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
          original_dispatch_status: dispatch?.status || null,
          service_object_id: dispatch?.service_object_id || null,
          process_instance_id: dispatch?.process_instance_id || null,
          process_def_id: dispatch?.process_def_id || null,
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
        dispatch_status: dispatch?.status || null,
        service_object_id: dispatch?.service_object_id || null,
        process_instance_id: dispatch?.process_instance_id || null,
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
        dispatch_status: dispatch?.status || "NOT_BOUND",
        service_object_id: dispatch?.service_object_id || null,
        process_instance_id: dispatch?.process_instance_id || null,
        process_def_id: dispatch?.process_def_id || null,
        dispatch_message: dispatchMessage(dispatch?.status || "NOT_BOUND"),
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
      if (mapped.retry_after_sec) {
        reply.header("Retry-After", String(mapped.retry_after_sec));
      }
      return reply.code(mapped.status).send({
        ok: false,
        error: mapped.error,
        correlation_id: correlationId,
        ...(mapped.retry_after_sec ? { retry_after_sec: mapped.retry_after_sec } : {}),
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
  dispatchMessage,
  mapRuntimeError,
  responseTimestamp,
};
