import { authorizeAnalyticsRequest } from "./_auth.js";
import {
  isAllowedOrigin,
  jsonResponse,
  originNotAllowedResponse,
  preflightResponse,
} from "./_http.js";

const ALLOWED_METHODS = "GET, OPTIONS";

export function createSessionHandler({ authorize = authorizeAnalyticsRequest } = {}) {
  return {
    async fetch(request) {
      if (!isAllowedOrigin(request)) {
        return originNotAllowedResponse(request, ALLOWED_METHODS);
      }

      if (request.method === "OPTIONS") {
        return preflightResponse(request, ALLOWED_METHODS);
      }

      if (request.method !== "GET") {
        return jsonResponse(
          request,
          {
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "Only GET requests are supported.",
            },
          },
          { status: 405, allowedMethods: ALLOWED_METHODS },
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

      return jsonResponse(
        request,
        { authenticated: true },
        { allowedMethods: ALLOWED_METHODS },
      );
    },
  };
}

export default createSessionHandler();
