import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE_NAME = "__Host-uev_admin_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export function getSessionSecret() {
  const configuredSecret = process.env.ADMIN_SESSION_SECRET;

  if (
    configuredSecret &&
    Buffer.byteLength(configuredSecret, "utf8") >= 32
  ) {
    return configuredSecret;
  }

  // University En Vivo already has GA_PRIVATE_KEY configured server-side in
  // Vercel. Derive a separate signing key from it so the admin panel can run
  // without requiring another secret to be provisioned. The private key itself
  // is never exposed or stored in the session cookie.
  const serverPrivateKey = process.env.GA_PRIVATE_KEY;
  if (serverPrivateKey && Buffer.byteLength(serverPrivateKey, "utf8") >= 64) {
    return createHash("sha256")
      .update("university-en-vivo/admin-session/v1\0", "utf8")
      .update(serverPrivateKey, "utf8")
      .digest("hex");
  }

  const error = new Error("Session signing is not configured.");
  error.code = "AUTH_SESSION_SECRET_MISSING";
  throw error;
}

function sessionSignature(sessionId, expiresAt, secret) {
  return createHmac("sha256", secret)
    .update(`${sessionId}.${expiresAt}`)
    .digest("base64url");
}

function verifiedSession(token, secret, now) {
  if (typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [sessionId, rawExpiresAt, suppliedSignature] = parts;
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return null;
  if (!/^\d{10,16}$/.test(rawExpiresAt)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)) return null;

  const expiresAt = Number(rawExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  const expected = Buffer.from(
    sessionSignature(sessionId, rawExpiresAt, secret),
    "base64url",
  );
  const supplied = Buffer.from(suppliedSignature, "base64url");

  if (expected.length !== supplied.length) return null;
  if (!timingSafeEqual(expected, supplied)) return null;

  return { sessionId, expiresAt };
}

export async function createAdminSession({
  secret = getSessionSecret(),
  now = Date.now(),
} = {}) {
  const sessionId = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_SECONDS * 1_000;
  const rawExpiresAt = String(expiresAt);

  return {
    token: `${sessionId}.${rawExpiresAt}.${sessionSignature(
      sessionId,
      rawExpiresAt,
      secret,
    )}`,
    expiresAt,
  };
}

export async function validateAdminSession(
  token,
  { secret = getSessionSecret(), now = Date.now() } = {},
) {
  const session = verifiedSession(token, secret, now);
  return session ? { expiresAt: session.expiresAt } : null;
}

// Sessions are stateless and signed. Logging out removes the HttpOnly cookie;
// there is no server-side session record to delete.
export async function destroyAdminSession(_token) {}

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
