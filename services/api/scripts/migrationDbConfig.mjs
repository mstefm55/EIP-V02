function normalizeString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function pick(...values) {
  return values.find((value) => normalizeString(value) !== "");
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function resolveSslConfig(env = process.env) {
  const sslEnabled = parseBoolean(pick(env.DATABASE_SSL, env.DB_SSL), false);
  if (!sslEnabled) return false;

  return {
    rejectUnauthorized: !parseBoolean(env.DATABASE_SSL_ALLOW_INVALID_CERTS, false),
  };
}

function resolveDbConfig(env = process.env) {
  const connectionString = normalizeString(
    pick(env.V2_DATABASE_URL, env.DATABASE_URL, env.DATABASE_PUBLIC_URL)
  );
  const ssl = resolveSslConfig(env);

  if (connectionString) {
    return {
      connectionString,
      ssl,
    };
  }

  const host = normalizeString(pick(env.DATABASE_HOST, env.DB_HOST, env.PGHOST));
  const isProduction = normalizeString(env.NODE_ENV).toLowerCase() === "production";

  if (isProduction && !host) {
    throw new Error(
      "Migration database configuration requires V2_DATABASE_URL, DATABASE_URL, DATABASE_PUBLIC_URL, or an explicit database host in production"
    );
  }

  return {
    host: host || "localhost",
    port: parseInteger(pick(env.DATABASE_PORT, env.DB_PORT, env.PGPORT), 5432),
    user: pick(env.DATABASE_USER, env.DB_USER, env.PGUSER, "postgres"),
    password: pick(env.DATABASE_PASSWORD, env.DB_PASSWORD, env.PGPASSWORD, ""),
    database: pick(
      env.DATABASE_NAME,
      env.DB_DATABASE,
      env.DATABASE,
      env.PGDATABASE,
      env.V2_DATABASE_NAME,
      "eip_V2"
    ),
    ssl,
  };
}

function redactConnectionSecrets(value, env = process.env) {
  let text = String(value ?? "");
  const secretValues = [
    env.V2_DATABASE_URL,
    env.DATABASE_URL,
    env.DATABASE_PUBLIC_URL,
    env.DATABASE_PASSWORD,
    env.DB_PASSWORD,
    env.PGPASSWORD,
  ];

  for (const rawSecret of secretValues) {
    const secret = normalizeString(rawSecret);
    if (secret) {
      text = text.split(secret).join("[redacted]");
    }
  }

  return text;
}

export {
  parseBoolean,
  redactConnectionSecrets,
  resolveDbConfig,
  resolveSslConfig,
};
