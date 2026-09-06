#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enginePath = path.join(root, "services/api/src/core/core_process_engine.js");
let source = fs.readFileSync(enginePath, "utf8");

function removeExact(label, text) {
  const at = source.indexOf(text);
  if (at === -1) return console.log(`already removed: ${label}`);
  if (source.indexOf(text, at + text.length) !== -1) throw new Error(`REMOVE_NOT_UNIQUE:${label}`);
  source = source.slice(0, at) + source.slice(at + text.length);
  console.log(`removed: ${label}`);
}

function removeRange(label, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) return console.log(`already removed: ${label}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`RANGE_END_NOT_FOUND:${label}`);
  source = source.slice(0, start) + source.slice(end);
  console.log(`removed: ${label}`);
}

removeExact("HTTP_REQUEST effect registry entry", '  HTTP_REQUEST: "httpRequest",\n');
removeRange(
  "outbound request helper from Process Effect runtime",
  'async function executeGatewayOutboundRequest(client, ctx, requestOptions) {',
  'function normalizeText(value) {'
);
removeRange(
  "HTTP header helper from Process Effect runtime",
  'function normalizeHeaders(input) {',
  'async function applyEffects(client, ctx, effects, payload) {'
);

fs.writeFileSync(enginePath, source);
console.log(`updated ${path.relative(root, enginePath)}`);
