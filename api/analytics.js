import { getAnalyticsDashboardData } from "./_analytics.js";
import { authorizeAnalyticsRequest } from "./_auth.js";

const ALLOWED_ORIGINS = new Set([
  "https://universityenvivo.com",
  "https://www.universityenvivo.com",
]);

function responseHeaders(origin) {
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  });

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Vary", "Origin");
  }

  return headers;
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin),
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get("origin");

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json(
        {
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "This origin is not allowed.",
          },
        },
        403,
        null,
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders(origin) });
    }

    if (request.method !== "GET") {
      return json(
        {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Only GET requests are supported.",
          },
        },
        405,
        origin,
      );
    }

    const access = await authorizeAnalyticsRequest(request);

    if (!access.authorized) {
      return json(
        {
          error: {
            code: access.code,
            message: access.message,
          },
        },
        access.status,
        origin,
      );
    }

    try {
      const analytics = await getAnalyticsDashboardData();
      return json(analytics, 200, origin);
    } catch (error) {
      const safeErrorCode =
        typeof error?.code === "string" || typeof error?.code === "number"
          ? error.code
          : "UNKNOWN";

      console.error("Google Analytics Data API request failed.", {
        code: safeErrorCode,
      });

      return json(
        {
          error: {
            code: "ANALYTICS_UNAVAILABLE",
            message: "Analytics data is temporarily unavailable.",
          },
        },
        502,
        origin,
      );
    }
  },
};
