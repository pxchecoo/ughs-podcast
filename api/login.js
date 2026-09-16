import { createHmac, timingSafeEqual } from "node:crypto";

import {
  isAllowedOrigin,
  jsonResponse,
  originNotAllowedResponse,
  preflightResponse,
} from "./_http.js";
import { checkLoginRateLimit } from "./_rate-limit.js";
import {
  createAdminSession,
  getSessionSecret,
  sessionCookie,
} from "./_session.js";

const ALLOWED_METHODS = "POST, OPTIONS";
const MAX_REQUEST_BYTES = 4_096;
const MAX_PASSWORD_LENGTH = 1_024;

function authenticationConfig() {
  const password = process.env.ADMIN_PASSWORD;
  const secret = getSessionSecret();

  if (!password) {
    const error = new Error("Admin authentication is not configured.");
    error.code = "AUTH_CONFIG_ERROR";
    throw error;
  }

  return { password, secret };
}

function passwordMatches(submittedPassword) {
  const { password, secret } = authenticationConfig();
  const suppliedDigest = createHmac("sha256", secret)
    .update(submittedPassword)
    .digest();
  const expectedDigest = createHmac("sha256", secret).update(password).digest();

  return timingSafeEqual(suppliedDigest, expectedDigest);
}

async function passwordFromRequest(request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return null;

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) return null;

  try {
    const body = JSON.parse(rawBody);
    if (typeof body?.password !== "string") return null;
    if (!body.password || body.password.length > MAX_PASSWORD_LENGTH) return null;
    return body.password;
  } catch {
    return null;
  }
}

export function createLoginHandler({
  checkRateLimit = checkLoginRateLimit,
  createSession = createAdminSession,
} = {}) {
  return {
    async fetch(request) {
      if (!isAllowedOrigin(request, { required: true })) {
        return originNotAllowedResponse(request, ALLOWED_METHODS);
      }

      if (request.method === "OPTIONS") {
        return preflightResponse(request, ALLOWED_METHODS);
      }

      if (request.method !== "POST") {
        return jsonResponse(
          request,
          {
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "Only POST requests are supported.",
            },
          },
          { status: 405, allowedMethods: ALLOWED_METHODS },
        );
      }

      try {
        const rateLimit = await checkRateLimit(request);

        if (!rateLimit.allowed) {
          const retryAfter = Math.max(
            1,
            Math.ceil((rateLimit.resetAt - Date.now()) / 1_000),
          );

          return jsonResponse(
            request,
            {
              error: {
                code: "TOO_MANY_ATTEMPTS",
                message: "Too many attempts. Try again later.",
              },
            },
            {
              status: 429,
              allowedMethods: ALLOWED_METHODS,
              headers: { "Retry-After": String(retryAfter) },
            },
          );
        }

        const password = await passwordFromRequest(request);

        if (!password || !passwordMatches(password)) {
          return jsonResponse(
            request,
            {
              error: {
                code: "INVALID_CREDENTIALS",
                message: "Invalid credentials.",
              },
            },
            { status: 401, allowedMethods: ALLOWED_METHODS },
          );
        }

        const session = await createSession();

        return jsonResponse(
          request,
          { ok: true },
          {
            status: 200,
            allowedMethods: ALLOWED_METHODS,
            headers: {
              "Set-Cookie": sessionCookie(session.token, session.expiresAt),
            },
          },
        );
      } catch (error) {
        const safeCode =
          typeof error?.code === "string" ? error.code : "AUTH_UNKNOWN";
        console.error("Admin login failed.", { code: safeCode });

        return jsonResponse(
          request,
          {
            error: {
              code: "AUTH_UNAVAILABLE",
              message: "Authentication is temporarily unavailable.",
            },
          },
          { status: 503, allowedMethods: ALLOWED_METHODS },
        );
      }
    },
  };
}

export default createLoginHandler();
