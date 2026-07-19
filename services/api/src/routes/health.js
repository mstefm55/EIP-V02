function buildRouteConfig(app, rateLimitMax) {
  const config = {
    rateLimit: {
      max: rateLimitMax,
      timeWindow: app.config?.rateLimitWindow ?? "1 minute",
    },
  };

  const corsOrigin = app.config?.corsOrigin;
  if (corsOrigin !== undefined) {
    config.cors = {
      origin: corsOrigin,
      credentials: false,
    };
  }

  return config;
}

function isPublicDbHealthEnabled(app) {
  const value = app.config?.ENABLE_PUBLIC_DB_HEALTH;
  return value === true || value === "true" || value === 1 || value === "1";
}

export default async function healthRoutes(app) {
  app.get(
    "/health",
    {
      config: buildRouteConfig(app, 60),
    },
    async () => ({
      ok: true,
      service: "api",
    })
  );

  if (!isPublicDbHealthEnabled(app)) {
    return;
  }

  app.get(
    "/health/db",
    {
      config: buildRouteConfig(app, 30),
    },
    async (_request, reply) => {
      try {
        if (!app.db || typeof app.db.query !== "function") {
          return reply.code(503).send({
            ok: false,
            service: "api",
            checks: {
              db: { ok: false },
            },
          });
        }

        await app.db.query("select 1 as ok");

        return {
          ok: true,
          service: "api",
          checks: {
            db: { ok: true },
          },
        };
      } catch {
        return reply.code(503).send({
          ok: false,
          service: "api",
          checks: {
            db: { ok: false },
          },
        });
      }
    }
  );
}
