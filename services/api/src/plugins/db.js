import { Pool } from "pg";
import fp from "fastify-plugin";

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pick(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function resolveDatabaseConfig(app) {
  const config = app.config ?? {};

  const databaseUrl = pick(
    config.databaseUrl,
    config.DATABASE_URL,
    process.env.DATABASE_URL
  );

  const databaseSsl = parseBoolean(
    pick(
      config.databaseSsl,
      config.DATABASE_SSL,
      config.DB_SSL,
      process.env.DATABASE_SSL,
      process.env.DB_SSL
    ),
    false
  );
  const databaseSslAllowInvalidCerts = parseBoolean(
    pick(
      config.databaseSslAllowInvalidCerts,
      config.DATABASE_SSL_ALLOW_INVALID_CERTS,
      process.env.DATABASE_SSL_ALLOW_INVALID_CERTS
    ),
    false
  );

  const databaseMax = parseInteger(
    pick(
      config.databaseMax,
      config.DATABASE_POOL_MAX,
      config.PG_POOL_MAX,
      process.env.DATABASE_POOL_MAX,
      process.env.PG_POOL_MAX
    ),
    10
  );

  const databaseIdleTimeoutMillis = parseInteger(
    pick(
      config.databaseIdleTimeoutMillis,
      config.DATABASE_POOL_IDLE_MS,
      process.env.DATABASE_POOL_IDLE_MS
    ),
    30_000
  );

  const databaseHost = pick(
    config.databaseHost,
    config.DATABASE_HOST,
    config.DB_HOST,
    process.env.DATABASE_HOST,
    process.env.DB_HOST,
    process.env.PGHOST
  );

  const databasePort = parseInteger(
    pick(
      config.databasePort,
      config.DATABASE_PORT,
      config.DB_PORT,
      process.env.DATABASE_PORT,
      process.env.DB_PORT,
      process.env.PGPORT
    ),
    5432
  );

  const databaseUser = pick(
    config.databaseUser,
    config.DATABASE_USER,
    config.DB_USER,
    process.env.DATABASE_USER,
    process.env.DB_USER,
    process.env.PGUSER
  );

  const databasePassword = pick(
    config.databasePassword,
    config.DATABASE_PASSWORD,
    config.DB_PASSWORD,
    process.env.DATABASE_PASSWORD,
    process.env.DB_PASSWORD,
    process.env.PGPASSWORD
  );

  const databaseName = pick(
    config.databaseName,
    config.DATABASE_NAME,
    config.DB_DATABASE,
    config.database,
    config.DATABASE,
    process.env.DATABASE_NAME,
    process.env.DB_DATABASE,
    process.env.DATABASE,
    process.env.PGDATABASE
  );

  return {
    databaseUrl,
    databaseSsl,
    databaseSslAllowInvalidCerts,
    databaseMax,
    databaseIdleTimeoutMillis,
    databaseHost,
    databasePort,
    databaseUser,
    databasePassword,
    databaseName,
  };
}

function buildPoolOptions(databaseConfig) {
  const sslOptions = databaseConfig.databaseSsl
    ? { rejectUnauthorized: !databaseConfig.databaseSslAllowInvalidCerts }
    : false;

  if (databaseConfig.databaseUrl) {
    return {
      connectionString: databaseConfig.databaseUrl,
      max: databaseConfig.databaseMax,
      idleTimeoutMillis: databaseConfig.databaseIdleTimeoutMillis,
      ssl: sslOptions,
    };
  }

  const poolOptions = {
    max: databaseConfig.databaseMax,
    idleTimeoutMillis: databaseConfig.databaseIdleTimeoutMillis,
    ssl: sslOptions,
  };

  if (databaseConfig.databaseHost) {
    poolOptions.host = databaseConfig.databaseHost;
  }

  if (databaseConfig.databasePort) {
    poolOptions.port = databaseConfig.databasePort;
  }

  if (databaseConfig.databaseUser) {
    poolOptions.user = databaseConfig.databaseUser;
  }

  if (databaseConfig.databasePassword) {
    poolOptions.password = databaseConfig.databasePassword;
  }

  if (databaseConfig.databaseName) {
    poolOptions.database = databaseConfig.databaseName;
  }

  return poolOptions;
}

function buildSafeDatabaseSummary(databaseConfig) {
  if (databaseConfig.databaseUrl) {
    try {
      const parsed = new URL(databaseConfig.databaseUrl);
      return {
        source: "DATABASE_URL",
        host: parsed.hostname || null,
        port: parsed.port ? parseInteger(parsed.port, null) : null,
        database: parsed.pathname ? parsed.pathname.replace(/^\//, "") || null : null,
        max: databaseConfig.databaseMax,
        idleTimeoutMillis: databaseConfig.databaseIdleTimeoutMillis,
        ssl: databaseConfig.databaseSsl,
        allowInvalidCerts: databaseConfig.databaseSslAllowInvalidCerts,
      };
    } catch {
      return {
        source: "DATABASE_URL",
        host: null,
        port: null,
        database: null,
        max: databaseConfig.databaseMax,
        idleTimeoutMillis: databaseConfig.databaseIdleTimeoutMillis,
        ssl: databaseConfig.databaseSsl,
      };
    }
  }

  return {
    source: "DATABASE_*",
    host: databaseConfig.databaseHost ?? null,
    port: databaseConfig.databasePort ?? null,
    database: databaseConfig.databaseName ?? null,
    max: databaseConfig.databaseMax,
    idleTimeoutMillis: databaseConfig.databaseIdleTimeoutMillis,
    ssl: databaseConfig.databaseSsl,
    allowInvalidCerts: databaseConfig.databaseSslAllowInvalidCerts,
  };
}

async function dbPlugin(app) {
  const databaseConfig = resolveDatabaseConfig(app);
  const poolOptions = buildPoolOptions(databaseConfig);
  const safeSummary = buildSafeDatabaseSummary(databaseConfig);

  if (
    !databaseConfig.databaseUrl &&
    !databaseConfig.databaseHost &&
    !databaseConfig.databaseUser &&
    !databaseConfig.databasePassword &&
    !databaseConfig.databaseName
  ) {
    app.log.error(
      { event: "db.pool.config_missing", database: safeSummary },
      "database configuration is missing"
    );
    throw new Error("Database configuration is missing");
  }

  const pool = new Pool(poolOptions);

  app.decorate("db", pool);

  pool.on("error", (error) => {
    app.log.error(
      {
        event: "db.pool.error",
        code: error?.code ?? null,
        message: error?.message ?? String(error),
      },
      "database pool error"
    );
  });

  app.log.info(
    { event: "db.pool.initializing", database: safeSummary },
    "initializing database pool"
  );

  try {
    await pool.query("select 1 as ok");
    app.log.info(
      { event: "db.pool.connected", database: safeSummary },
      "database connection established"
    );
  } catch (error) {
    app.log.error(
      {
        event: "db.pool.connect_failed",
        code: error?.code ?? null,
        message: error?.message ?? String(error),
      },
      "database connection failed"
    );

    await pool.end().catch(() => undefined);
    throw error;
  }

  app.addHook("onClose", async () => {
    app.log.info(
      { event: "db.pool.closing", database: safeSummary },
      "closing database pool"
    );

    try {
      await pool.end();
      app.log.info(
        { event: "db.pool.closed", database: safeSummary },
        "database pool closed"
      );
    } catch (error) {
      app.log.error(
        {
          event: "db.pool.close_failed",
          code: error?.code ?? null,
          message: error?.message ?? String(error),
        },
        "database pool close failed"
      );
      throw error;
    }
  });
}

export default fp(dbPlugin, {
  name: "db",
});
