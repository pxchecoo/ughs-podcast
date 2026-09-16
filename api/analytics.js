import { getAnalyticsDashboardData } from "./_analytics.js";
import { authorizeAnalyticsRequest } from "./_auth.js";
import {
  isAllowedOrigin,
  jsonResponse,
  originNotAllowedResponse,
  preflightResponse,
} from "./_http.js";

const ALLOWED_METHODS = "GET, OPTIONS";

export default {
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

    const access = await authorizeAnalyticsRequest(request);

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

    try {
      const analytics = await getAnalyticsDashboardData();
      return jsonResponse(request, analytics, {
        status: 200,
        allowedMethods: ALLOWED_METHODS,
      });
    } catch (error) {
      const safeErrorCode =
        typeof error?.code === "string" || typeof error?.code === "number"
          ? error.code
          : "UNKNOWN";

      console.error("Google Analytics Data API request failed.", {
        code: safeErrorCode,
      });

      return jsonResponse(
        request,
        {
          error: {
            code: "ANALYTICS_UNAVAILABLE",
            message: "Analytics data is temporarily unavailable.",
          },
        },
        { status: 502, allowedMethods: ALLOWED_METHODS },
      );
    }
  },
};
