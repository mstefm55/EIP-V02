import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stagingHost = String(process.env.STAGING_HOST || "127.0.0.1").trim();
const tlsEnabled = parseBoolean(process.env.STAGING_TLS_ENABLED, true);
const stagingPort = parseInteger(process.env.STAGING_PORT, tlsEnabled ? 8443 : 8090);
const publicOrigin = String(
  process.env.STAGING_PUBLIC_ORIGIN || `${tlsEnabled ? "https" : "http"}://localhost:${stagingPort}`
).trim();
const upstreamApiOrigin = String(process.env.STAGING_API_ORIGIN || "http://127.0.0.1:4000").trim();
const uiDistRel = String(process.env.STAGING_UI_DIST || "apps/workbench-ui/dist").trim();
const uiDistAbs = path.resolve(root, uiDistRel);
const upstreamApi = new URL(upstreamApiOrigin);
const upstreamClient = upstreamApi.protocol === "https:" ? https : http;
const redirectPort = parseOptionalInteger(process.env.STAGING_HTTP_REDIRECT_PORT);
const tlsCertRel = String(process.env.STAGING_TLS_CERT_FILE || "deploy/staging/certs/localhost.crt").trim();
const tlsKeyRel = String(process.env.STAGING_TLS_KEY_FILE || "deploy/staging/certs/localhost.key").trim();
const tlsCertFile = path.resolve(root, tlsCertRel);
const tlsKeyFile = path.resolve(root, tlsKeyRel);
const tlsAutogenerate = parseBoolean(process.env.STAGING_TLS_AUTOGENERATE, true);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalInteger(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function resolveSafeAssetPath(requestPath) {
  const urlPath = requestPath.split("?")[0].split("#")[0];
  const cleanPath = decodeURIComponent(urlPath);
  const normalized = path.posix.normalize(cleanPath);
  const relative = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  const joined = path.resolve(uiDistAbs, relative);
  if (!joined.startsWith(uiDistAbs)) return null;
  return joined;
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[extension] || "application/octet-stream";
  res.writeHead(200, { "content-type": contentType });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function ensureFile(pathValue, label) {
  if (!fs.existsSync(pathValue)) {
    throw new Error(`${label} not found at ${pathValue}`);
  }
}

function ensureTlsAssets() {
  if (!tlsEnabled) return null;

  if (!fs.existsSync(tlsCertFile) || !fs.existsSync(tlsKeyFile)) {
    if (!tlsAutogenerate) {
      throw new Error(
        `TLS assets missing. Expected cert=${tlsCertFile}, key=${tlsKeyFile}. ` +
          "Set STAGING_TLS_AUTOGENERATE=true or provide both files."
      );
    }
    generateTlsAssets();
  }

  ensureFile(tlsCertFile, "STAGING TLS cert");
  ensureFile(tlsKeyFile, "STAGING TLS key");

  return {
    cert: fs.readFileSync(tlsCertFile),
    key: fs.readFileSync(tlsKeyFile),
    minVersion: "TLSv1.2",
  };
}

function generateTlsAssets() {
  const certDir = path.dirname(tlsCertFile);
  const keyDir = path.dirname(tlsKeyFile);
  fs.mkdirSync(certDir, { recursive: true });
  fs.mkdirSync(keyDir, { recursive: true });

  const hasOpenSsl = spawnSync("openssl", ["version"], { stdio: "pipe", encoding: "utf8" }).status === 0;
  if (!hasOpenSsl) {
    throw new Error(
      "OpenSSL was not found in PATH. Install OpenSSL or provide STAGING_TLS_CERT_FILE + STAGING_TLS_KEY_FILE."
    );
  }

  const subject = "/CN=localhost";
  const preferredArgs = [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    tlsKeyFile,
    "-out",
    tlsCertFile,
    "-sha256",
    "-days",
    "825",
    "-nodes",
    "-subj",
    subject,
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ];
  let result = spawnSync("openssl", preferredArgs, {
    stdio: "pipe",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    // Older OpenSSL builds may not support -addext.
    const fallbackArgs = [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      tlsKeyFile,
      "-out",
      tlsCertFile,
      "-sha256",
      "-days",
      "825",
      "-nodes",
      "-subj",
      subject,
    ];
    result = spawnSync("openssl", fallbackArgs, {
      stdio: "pipe",
      encoding: "utf8",
    });
  }

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(`Failed to auto-generate local TLS assets: ${stderr || "unknown openssl error"}`);
  }

  process.stdout.write(
    `[staging-gateway] generated local TLS assets cert=${tlsCertFile} key=${tlsKeyFile}\n`
  );
}

function proxyApi(req, res) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const nextForwardedFor = forwardedFor
    ? `${forwardedFor}, ${req.socket.remoteAddress}`
    : String(req.socket.remoteAddress || "");

  const proxyHeaders = {
    ...req.headers,
    host: `${upstreamApi.hostname}${upstreamApi.port ? `:${upstreamApi.port}` : ""}`,
    "x-forwarded-for": nextForwardedFor,
    "x-forwarded-host": req.headers.host || "",
    "x-forwarded-proto": req.socket.encrypted ? "https" : "http",
  };

  const upstreamReq = upstreamClient.request(
    {
      protocol: upstreamApi.protocol,
      hostname: upstreamApi.hostname,
      port: upstreamApi.port || (upstreamApi.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: req.url,
      headers: proxyHeaders,
    },
    (upstreamRes) => {
      const headers = { ...upstreamRes.headers };
      res.writeHead(upstreamRes.statusCode || 502, headers);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on("error", (error) => {
    sendJson(res, 502, {
      ok: false,
      error: "UPSTREAM_UNAVAILABLE",
      message: error.message,
    });
  });

  req.pipe(upstreamReq);
}

function isApiPath(urlPath) {
  return urlPath.startsWith("/api/");
}

const tlsOptions = ensureTlsAssets();
const publicUrl = new URL(publicOrigin);
if (tlsEnabled && publicUrl.protocol !== "https:") {
  throw new Error(`STAGING_PUBLIC_ORIGIN must use https when STAGING_TLS_ENABLED=true (received ${publicOrigin})`);
}
if (!tlsEnabled && publicUrl.protocol === "https:") {
  throw new Error(`STAGING_PUBLIC_ORIGIN must use http when STAGING_TLS_ENABLED=false (received ${publicOrigin})`);
}

if (redirectPort !== null && redirectPort === stagingPort) {
  throw new Error("STAGING_HTTP_REDIRECT_PORT must differ from STAGING_PORT");
}

const requestHandler = (req, res) => {
  const requestPath = String(req.url || "/");

  if (requestPath === "/healthz") {
    return sendJson(res, 200, {
      ok: true,
      service: "staging_gateway",
      public_origin: publicOrigin,
      api_origin: upstreamApiOrigin,
    });
  }

  if (isApiPath(requestPath)) {
    return proxyApi(req, res);
  }

  const requestedAsset = resolveSafeAssetPath(requestPath);
  if (requestedAsset && serveFile(res, requestedAsset)) {
    return;
  }

  const indexPath = path.join(uiDistAbs, "index.html");
  if (!serveFile(res, indexPath)) {
    sendJson(res, 503, {
      ok: false,
      error: "UI_BUILD_MISSING",
      expected_dist_path: uiDistAbs,
    });
  }
};

const server = tlsEnabled
  ? https.createServer(tlsOptions, requestHandler)
  : http.createServer(requestHandler);

function handleServerError(error, label, port) {
  if (error?.code === "EADDRINUSE" || error?.code === "EACCES") {
    process.stderr.write(
      `[staging-gateway] ${label} port ${port} is unavailable (${error.code}). ` +
        `Set ${label === "gateway" ? "STAGING_PORT" : "STAGING_HTTP_REDIRECT_PORT"} to an unused port.\n`
    );
    process.exit(1);
    return;
  }

  process.stderr.write(
    `[staging-gateway] ${label} failed to start: ${error?.message || String(error)}\n`
  );
  process.exit(1);
}

server.on("error", (error) => handleServerError(error, "gateway", stagingPort));

server.listen(stagingPort, stagingHost, () => {
  process.stdout.write(
    `[staging-gateway] listening on ${publicOrigin} (${tlsEnabled ? "https" : "http"}) -> ${upstreamApiOrigin} (dist=${uiDistAbs})\n`
  );
});

if (tlsEnabled && redirectPort !== null) {
  const redirectServer = http.createServer((req, res) => {
    const location = `${publicOrigin}${req.url || "/"}`;
    res.writeHead(308, { location });
    res.end();
  });

  redirectServer.on("error", (error) => handleServerError(error, "redirect", redirectPort));
  redirectServer.listen(redirectPort, stagingHost, () => {
    process.stdout.write(
      `[staging-gateway] redirecting http://localhost:${redirectPort} -> ${publicOrigin}\n`
    );
  });
}
