import crypto from "node:crypto";
import argon2 from "argon2";

export const PASSWORD_POLICY = Object.freeze({
  minLength: 12,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: true,
});

const SCRYPT_MAX_MEM = 64 * 1024 * 1024;

function parseScryptHash(value) {
  const parts = String(value || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return null;
  }

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return null;
  }
  if (N <= 1 || r <= 0 || p <= 0) {
    return null;
  }

  const salt = Buffer.from(parts[4], "base64");
  const hash = Buffer.from(parts[5], "base64");
  if (!salt.length || !hash.length) {
    return null;
  }

  return { N, r, p, salt, hash };
}

function scorePassword(password) {
  const feedback = [];
  let score = 0;

  if (password.length >= PASSWORD_POLICY.minLength) {
    score += 2;
  } else {
    feedback.push(`Password must be at least ${PASSWORD_POLICY.minLength} characters long`);
  }

  if (password.length >= 20) {
    score += 1;
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  if (hasLower) score += 1;
  if (hasUpper) score += 1;
  if (hasNumber) score += 1;
  if (hasSymbol) score += 1;

  if (PASSWORD_POLICY.requireLowercase && !hasLower) {
    feedback.push("Password must include at least one lowercase letter");
  }
  if (PASSWORD_POLICY.requireUppercase && !hasUpper) {
    feedback.push("Password must include at least one uppercase letter");
  }
  if (PASSWORD_POLICY.requireNumber && !hasNumber) {
    feedback.push("Password must include at least one number");
  }
  if (PASSWORD_POLICY.requireSymbol && !hasSymbol) {
    feedback.push("Password must include at least one symbol");
  }

  const normalized = password.toLowerCase();
  const weakPatterns = ["password", "letmein", "qwerty", "admin", "welcome", "iloveyou", "123456"];
  if (weakPatterns.some((pattern) => normalized.includes(pattern))) {
    feedback.push("Password contains a common weak pattern");
    score = Math.max(0, score - 2);
  }

  if (/(.)\1{2,}/.test(password)) {
    feedback.push("Password should not contain repeated characters");
    score = Math.max(0, score - 1);
  }

  return {
    ok: feedback.length === 0 && score >= 5,
    score: Math.min(score, 7),
    feedback,
  };
}

export function evaluatePasswordStrength(password) {
  if (typeof password !== "string" || password.length === 0) {
    return {
      ok: false,
      score: 0,
      feedback: ["Password is required"],
    };
  }

  if (password.length > PASSWORD_POLICY.maxLength) {
    return {
      ok: false,
      score: 0,
      feedback: [`Password must be at most ${PASSWORD_POLICY.maxLength} characters long`],
    };
  }

  const scored = scorePassword(password);
  return {
    ok: scored.ok,
    score: scored.score,
    strength: scored.score >= 6 ? "strong" : scored.score >= 4 ? "medium" : "weak",
    feedback: scored.feedback,
  };
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("password is required");
  }

  if (password.length > PASSWORD_POLICY.maxLength) {
    throw new RangeError(`password must be at most ${PASSWORD_POLICY.maxLength} characters long`);
  }

  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(password, credential) {
  if (!password || typeof password !== "string") {
    return false;
  }

  const hash = String(credential?.secret_hash || credential?.hash || "");
  const algorithm = String(credential?.algorithm || "").toLowerCase();
  if (!hash) {
    return false;
  }

  if (hash.startsWith("$argon2") || algorithm.startsWith("argon2")) {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  if (algorithm && algorithm !== "scrypt") {
    return false;
  }

  const parsed = parseScryptHash(hash);
  if (!parsed) {
    return false;
  }

  try {
    const derived = await new Promise((resolve, reject) => {
      crypto.scrypt(
        password,
        parsed.salt,
        parsed.hash.length,
        { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: SCRYPT_MAX_MEM },
        (error, result) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(result);
        }
      );
    });
    return crypto.timingSafeEqual(Buffer.from(derived), parsed.hash);
  } catch {
    return false;
  }
}
