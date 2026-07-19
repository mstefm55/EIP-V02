import crypto from "node:crypto";

function assertPositiveInteger(value, name, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  if (fallback !== undefined) return fallback;
  throw new RangeError(`${name} must be a positive integer`);
}

export function randomToken(bytes = 32) {
  const size = assertPositiveInteger(bytes, "bytes");
  return crypto.randomBytes(size).toString("base64url");
}

export function randomDigits(length = 6) {
  const digits = assertPositiveInteger(length, "length");
  let value = "";
  for (let index = 0; index < digits; index += 1) {
    value += String(crypto.randomInt(0, 10));
  }
  return value;
}

export function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input ?? ""), "utf8").digest("hex");
}

export function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.isBuffer(left) ? left : Buffer.from(String(left ?? ""), "utf8");
  const rightBuffer = Buffer.isBuffer(right) ? right : Buffer.from(String(right ?? ""), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
