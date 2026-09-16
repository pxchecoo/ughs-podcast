import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { getRedis } from "./_redis.js";

export const SESSION_COOKIE_NAME = "__Host-uev_admin_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    const error = new Error("Session signing is not configured.");
    error.code = "AUTH_CONFIG_ERROR";
    throw error;
  }

  return secret;
}

function sessionSignature(sessionId, secret) {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

function verifiedSessionId(token, secret) {
  if (typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [sessionId, suppliedSignature] = parts;
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)) return null;

  const expected = Buffer.from(sessionSignature(sessionId, secret), "base64url");
  const supplied = Buffer.from(suppliedSignature, "base64url");

  if (expected.length !== supplied.length) return null;
  return timingSafeEqual(expected, supplied) ? sessionId : null;
}

function sessionKey(sessionId) {
  const digest = createHash("sha256").update(sessionId).digest("hex");
  return `uev:admin:session:${digest}`;
}

export function readSessionToken(request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;

    const name = cookie.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;

    return cookie.slice(separator + 1).trim() || null;
  }

  return null;
}

export async function createAdminSession({
  redis = getRedis(),
  secret = getSessionSecret(),
  now = Date.now(),
} = {}) {
  const sessionId = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_SECONDS * 1_000;
  const result = await redis.set(sessionKey(sessionId), String(expiresAt), {
    ex: SESSION_TTL_SECONDS,
    nx: true,
  });

  if (result !== "OK") {
    const error = new Error("Unable to create the admin session.");
    error.code = "AUTH_STORAGE_UNAVAILABLE";
    throw error;
  }

  return {
    token: `${sessionId}.${sessionSignature(sessionId, secret)}`,
    expiresAt,
  };
}

export async function validateAdminSession(
  token,
  { redis = getRedis(), secret = getSessionSecret(), now = Date.now() } = {},
) {
  const sessionId = verifiedSessionId(token, secret);
  if (!sessionId) return null;

  const storedExpiration = await redis.get(sessionKey(sessionId));
  const expiresAt = Number(storedExpiration);

  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    if (storedExpiration !== null) await redis.del(sessionKey(sessionId));
    return null;
  }

  return { expiresAt };
}

export async function destroyAdminSession(
  token,
  { redis = getRedis(), secret = getSessionSecret() } = {},
) {
  const sessionId = verifiedSessionId(token, secret);
  if (!sessionId) return;

  await redis.del(sessionKey(sessionId));
}

export function sessionCookie(token, expiresAt) {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export function expiredSessionCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}
