import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "dist");
const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(String(process.env.PORT || "4174"), 10);
const upstreamRaw =
  process.env.API_PROXY_TARGET ||
  process.env.VITE_API_BASE_URL ||
  "http://localhost:4010";
const upstreamBase = new URL(upstreamRaw);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
]);

function filteredHeaders(headers, { dropHost = false } = {}) {
  const result = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (dropHost && lower === "host") continue;
    if (value !== undefined) result[name] = value;
  }
  return result;
}

function upstreamPath(requestUrl) {
  const basePath = upstreamBase.pathname.replace(/\/$/, "");
  return `${basePath}${requestUrl.startsWith("/") ? requestUrl : `/${requestUrl}`}`;
}

function proxyApi(req, res) {
  const transport = upstreamBase.protocol === "https:" ? httpsRequest : httpRequest;
  const requestHeaders = filteredHeaders(req.headers, { dropHost: true });
  requestHeaders.host = upstreamBase.host;
  requestHeaders["x-forwarded-host"] = req.headers.host || "";
  requestHeaders["x-forwarded-proto"] = "https";
  const remoteAddress = req.socket.remoteAddress || "";
  if (remoteAddress) {
    const existing = String(req.headers["x-forwarded-for"] || "").trim();
    requestHeaders["x-forwarded-for"] = existing ? `${existing}, ${remoteAddress}` : remoteAddress;
  }

  const upstream = transport(
    {
      protocol: upstreamBase.protocol,
      hostname: upstreamBase.hostname,
      port: upstreamBase.port || undefined,
      method: req.method,
      path: upstreamPath(req.url || "/"),
      headers: requestHeaders,
    },
    (upstreamRes) => {
      const responseHeaders = filteredHeaders(upstreamRes.headers);
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
      upstreamRes.pipe(res);
    }
  );

  upstream.on("error", (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "API_PROXY_UNAVAILABLE" }));
  });

  req.pipe(upstream);
}

function safeStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded === "/" ? "/index.html" : decoded;
  const candidate = path.resolve(distDir, `.${relative}`);
  if (candidate === distDir || candidate.startsWith(`${distDir}${path.sep}`)) {
    return candidate;
  }
  return null;
}

async function resolveStaticFile(pathname) {
  const candidate = safeStaticPath(pathname);
  if (candidate) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
      if (info.isDirectory()) {
        const nestedIndex = path.join(candidate, "index.html");
        const nestedInfo = await stat(nestedIndex);
        if (nestedInfo.isFile()) return nestedIndex;
      }
    } catch {
      // SPA fallback below.
    }
  }
  return path.join(distDir, "index.html");
}

async function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const filePath = await resolveStaticFile(requestUrl.pathname);

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    const extension = path.extname(filePath).toLowerCase();
    const isIndex = path.basename(filePath) === "index.html";
    res.writeHead(200, {
      "content-type": CONTENT_TYPES.get(extension) || "application/octet-stream",
      "content-length": info.size,
      "cache-control": isIndex ? "no-cache" : "public, max-age=31536000, immutable",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
    proxyApi(req, res);
    return;
  }

  void serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`[workbench-ui] listening on http://${host}:${port}`);
  console.log(`[workbench-ui] proxying /api to ${upstreamBase.origin}`);
});
