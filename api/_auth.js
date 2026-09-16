import { readSessionToken, validateAdminSession } from "./_session.js";

export async function authorizeAnalyticsRequest(
  request,
  { validateSession = validateAdminSession } = {},
) {
  const token = readSessionToken(request);

  if (!token) {
    return {
      authorized: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Authentication is required.",
    };
  }

  try {
    const session = await validateSession(token);

    if (!session) {
      return {
        authorized: false,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Authentication is required.",
      };
    }

    return { authorized: true, session };
  } catch (error) {
    const safeCode =
      typeof error?.code === "string" ? error.code : "AUTH_UNKNOWN";
    console.error("Admin session validation failed.", { code: safeCode });

    return {
      authorized: false,
      status: 503,
      code: "AUTH_UNAVAILABLE",
      message: "Authentication is temporarily unavailable.",
    };
  }
}
