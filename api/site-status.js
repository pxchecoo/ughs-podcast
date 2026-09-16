import { authorizeAnalyticsRequest } from "./_auth.js";
import {
  isAllowedOrigin,
  jsonResponse,
  originNotAllowedResponse,
  preflightResponse,
} from "./_http.js";
import { getRedis } from "./_redis.js";

const ALLOWED_METHODS = "GET, POST, OPTIONS";
const COMING_SOON_KEY = "uev:site:coming-soon";
const MAX_REQUEST_BYTES = 128;

function storedValueIsEnabled(value) {
  return value === true || value === 1 || value === "1";
}

async function comingSoonFromRequest(request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return null;

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) return null;

  try {
    const body = JSON.parse(rawBody);
    return typeof body?.comingSoon === "boolean" ? body.comingSoon : null;
  } catch {
    return null;
  }
}

export function createSiteStatusHandler({
  redis = getRedis,
  authorize = authorizeAnalyticsRequest,
} = {}) {
  return {
    async fetch(request) {
      const requiresTrustedOrigin = request.method !== "GET";

      if (!isAllowedOrigin(request, { required: requiresTrustedOrigin })) {
        return originNotAllowedResponse(request, ALLOWED_METHODS);
      }

      if (request.method === "OPTIONS") {
        return preflightResponse(request, ALLOWED_METHODS);
      }

      if (request.method !== "GET" && request.method !== "POST") {
        return jsonResponse(
          request,
          {
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "Only GET and POST requests are supported.",
            },
          },
          { status: 405, allowedMethods: ALLOWED_METHODS },
        );
      }

      try {
        if (request.method === "GET") {
          const value = await redis().get(COMING_SOON_KEY);
          return jsonResponse(
            request,
            { comingSoon: storedValueIsEnabled(value) },
            { allowedMethods: ALLOWED_METHODS },
          );
        }

        const access = await authorize(request);
        if (!access.authorized) {
          return jsonResponse(
            request,
            {
              error: {
                code: access.code,
                message: access.message,
              },
            },
            { status: access.status, allowedMethods: ALLOWED_METHODS },
          );
        }

        const comingSoon = await comingSoonFromRequest(request);
        if (comingSoon === null) {
          return jsonResponse(
            request,
            {
              error: {
                code: "INVALID_REQUEST",
                message: "comingSoon must be a boolean.",
              },
            },
            { status: 400, allowedMethods: ALLOWED_METHODS },
          );
        }

        await redis().set(COMING_SOON_KEY, comingSoon ? "1" : "0");
        return jsonResponse(
          request,
          { comingSoon },
          { allowedMethods: ALLOWED_METHODS },
        );
      } catch (error) {
        const safeCode =
          typeof error?.code === "string" ? error.code : "SITE_STATUS_UNKNOWN";
        console.error("Site status request failed.", { code: safeCode });

        return jsonResponse(
          request,
          {
            error: {
              code: "SITE_STATUS_UNAVAILABLE",
              message: "Site status is temporarily unavailable.",
            },
          },
          { status: 503, allowedMethods: ALLOWED_METHODS },
        );
      }
    },
  };
}

export default createSiteStatusHandler();
