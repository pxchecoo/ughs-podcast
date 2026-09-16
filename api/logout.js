import {
  isAllowedOrigin,
  jsonResponse,
  originNotAllowedResponse,
  preflightResponse,
} from "./_http.js";
import {
  destroyAdminSession,
  expiredSessionCookie,
  readSessionToken,
} from "./_session.js";

const ALLOWED_METHODS = "POST, OPTIONS";

export function createLogoutHandler({ destroySession = destroyAdminSession } = {}) {
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
        const token = readSessionToken(request);
        if (token) await destroySession(token);

        return jsonResponse(
          request,
          { ok: true },
          {
            allowedMethods: ALLOWED_METHODS,
            headers: { "Set-Cookie": expiredSessionCookie() },
          },
        );
      } catch (error) {
        const safeCode =
          typeof error?.code === "string" ? error.code : "AUTH_UNKNOWN";
        console.error("Admin logout failed.", { code: safeCode });

        return jsonResponse(
          request,
          {
            error: {
              code: "AUTH_UNAVAILABLE",
              message: "Authentication is temporarily unavailable.",
            },
          },
          {
            status: 503,
            allowedMethods: ALLOWED_METHODS,
            headers: { "Set-Cookie": expiredSessionCookie() },
          },
        );
      }
    },
  };
}

export default createLogoutHandler();
