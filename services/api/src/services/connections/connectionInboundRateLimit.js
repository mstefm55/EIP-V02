import { withTenantTransaction } from "../../db/tenantTransaction.js";
import { ConnectionInboundRuntimeError } from "./connectionInboundRuntime.js";

const RATE_LIMIT_MAX_REQUESTS = 1_000_000;
const RATE_LIMIT_MAX_WINDOW_SEC = 86_400;
const RATE_LIMIT_MIN_WINDOW_SEC = 1;
const RATE_LIMIT_RETENTION_FLOOR_SEC = 3_600;

function text(value) {
  return String(value ?? "").trim();
}

function configuredNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function resolveInboundRateLimit(profile) {
  const rateLimit = profile?.inbound?.rate_limit || {};
  const maxRequests = configuredNumber(rateLimit.max);
  const windowSec = configuredNumber(rateLimit.window_sec);
  const hasMax = maxRequests !== null;
  const hasWindow = windowSec !== null;

  if (!hasMax && !hasWindow) {
    return {
      enabled: false,
      max_requests: null,
      window_sec: null,
    };
  }

  if (
    !hasMax
    || !hasWindow
    || !Number.isInteger(maxRequests)
    || !Number.isInteger(windowSec)
    || maxRequests < 1
    || maxRequests > RATE_LIMIT_MAX_REQUESTS
    || windowSec < RATE_LIMIT_MIN_WINDOW_SEC
    || windowSec > RATE_LIMIT_MAX_WINDOW_SEC
  ) {
    throw new ConnectionInboundRuntimeError(
      "Configured inbound rate limit is incomplete or outside the bounded runtime contract.",
      "CONNECTION_RATE_LIMIT_CONFIG_INVALID",
      503
    );
  }

  return {
    enabled: true,
    max_requests: maxRequests,
    window_sec: windowSec,
  };
}

async function enforceInboundRateLimit({
  pool,
  tenantId,
  profile,
  transaction = withTenantTransaction,
}) {
  const config = resolveInboundRateLimit(profile);
  if (!config.enabled) {
    return {
      configured: false,
      allowed: true,
      request_count: null,
      max_requests: null,
      window_sec: null,
      retry_after_sec: null,
    };
  }

  const connectionCode = text(profile?.identity?.connection_code).toLowerCase();
  if (!connectionCode) {
    throw new ConnectionInboundRuntimeError(
      "Connection identity is required for inbound rate limiting.",
      "CONNECTION_CONTEXT_REQUIRED",
      500
    );
  }

  const outcome = await transaction(pool, tenantId, async (client) => {
    const counted = await client.query(
      `
      WITH bucket AS (
        SELECT to_timestamp(
          floor(extract(epoch FROM clock_timestamp()) / $3::double precision)
          * $3::double precision
        ) AS bucket_started_at
      ), upserted AS (
        INSERT INTO tenant.connection_inbound_rate_bucket
          (tenant_id, connection_code, bucket_started_at, window_sec, request_count, created_at, updated_at)
        SELECT
          $1::uuid,
          $2,
          bucket_started_at,
          $3::integer,
          1,
          clock_timestamp(),
          clock_timestamp()
        FROM bucket
        ON CONFLICT (tenant_id, connection_code, bucket_started_at)
        DO UPDATE
          SET request_count = tenant.connection_inbound_rate_bucket.request_count + 1,
              window_sec = EXCLUDED.window_sec,
              updated_at = clock_timestamp()
        RETURNING bucket_started_at, window_sec, request_count
      )
      SELECT
        bucket_started_at,
        window_sec,
        request_count,
        GREATEST(
          1,
          CEIL(
            EXTRACT(EPOCH FROM (
              (bucket_started_at + make_interval(secs => window_sec)) - clock_timestamp()
            ))
          )
        )::integer AS retry_after_sec
      FROM upserted
      `,
      [tenantId, connectionCode, config.window_sec]
    );

    if (counted.rowCount !== 1) {
      throw new ConnectionInboundRuntimeError(
        "Inbound rate-limit state could not be updated.",
        "CONNECTION_RATE_LIMIT_UNAVAILABLE",
        503
      );
    }

    const row = counted.rows[0];
    const requestCount = Number(row.request_count);
    const retryAfterSec = Math.max(1, Number(row.retry_after_sec) || config.window_sec);

    // Cleanup is performed only by the first request in a fresh bucket. This
    // bounds ephemeral counter history without adding a DELETE on every request.
    if (requestCount === 1) {
      const retentionSec = Math.max(
        RATE_LIMIT_RETENTION_FLOOR_SEC,
        config.window_sec * 4
      );
      await client.query(
        `
        DELETE FROM tenant.connection_inbound_rate_bucket
        WHERE tenant_id = $1::uuid
          AND connection_code = $2
          AND bucket_started_at < clock_timestamp() - make_interval(secs => $3::integer)
        `,
        [tenantId, connectionCode, retentionSec]
      );
    }

    return {
      configured: true,
      allowed: requestCount <= config.max_requests,
      request_count: requestCount,
      max_requests: config.max_requests,
      window_sec: config.window_sec,
      retry_after_sec: retryAfterSec,
      bucket_started_at: row.bucket_started_at || null,
    };
  });

  // The counter transaction must commit even for rejected traffic. Throw only
  // after the shared rate state is durable, otherwise a rollback would make the
  // limiter ineffective under sustained rejected requests.
  if (!outcome.allowed) {
    const error = new ConnectionInboundRuntimeError(
      "Inbound connection rate limit exceeded.",
      "CONNECTION_RATE_LIMIT_EXCEEDED",
      429
    );
    error.retryAfterSec = outcome.retry_after_sec;
    error.maxRequests = outcome.max_requests;
    error.windowSec = outcome.window_sec;
    throw error;
  }

  return outcome;
}

export {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_MAX_WINDOW_SEC,
  RATE_LIMIT_MIN_WINDOW_SEC,
  RATE_LIMIT_RETENTION_FLOOR_SEC,
  enforceInboundRateLimit,
  resolveInboundRateLimit,
};
