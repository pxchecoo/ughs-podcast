export const ALLOWED_ORIGINS = new Set([
  "https://universityenvivo.com",
  "https://www.universityenvivo.com",
  "https://ughs-podcast.vercel.app",
]);

export function isAllowedOrigin(request, { required = false } = {}) {
  const origin = request.headers.get("origin");

  if (!origin) return !required;
  return ALLOWED_ORIGINS.has(origin);
}

export function responseHeaders(request, allowedMethods) {
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  });
  const origin = request.headers.get("origin");

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", allowedMethods);
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Vary", "Origin");
  }

  return headers;
}

export function jsonResponse(
  request,
  body,
  { status = 200, allowedMethods = "GET, OPTIONS", headers = {} } = {},
) {
  const responseHeaderSet = responseHeaders(request, allowedMethods);

  for (const [name, value] of Object.entries(headers)) {
    responseHeaderSet.set(name, value);
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaderSet,
  });
}

export function preflightResponse(request, allowedMethods) {
  return new Response(null, {
    status: 204,
    headers: responseHeaders(request, allowedMethods),
  });
}

export function originNotAllowedResponse(request, allowedMethods) {
  return jsonResponse(
    request,
    {
      error: {
        code: "ORIGIN_NOT_ALLOWED",
        message: "This origin is not allowed.",
      },
    },
    { status: 403, allowedMethods },
  );
}
