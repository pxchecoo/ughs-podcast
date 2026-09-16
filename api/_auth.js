/**
 * Server-side authorization boundary for private Analytics data.
 *
 * This intentionally denies every request until /admin has real server-side
 * authentication and this function validates its signed session. Do not
 * replace this with a browser-only password or a client-visible shared secret.
 */
export async function authorizeAnalyticsRequest(_request) {
  return {
    authorized: false,
    status: 503,
    code: "AUTH_NOT_CONFIGURED",
    message:
      "Analytics access is disabled until server-side authentication is configured.",
  };
}
