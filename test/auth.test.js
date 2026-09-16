import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { authorizeAnalyticsRequest } from "../api/_auth.js";
import {
  createAdminSession,
  SESSION_COOKIE_NAME,
  sessionCookie,
  validateAdminSession,
} from "../api/_session.js";
import { createLoginHandler } from "../api/login.js";
import { createLogoutHandler } from "../api/logout.js";
import { createSessionHandler } from "../api/session.js";

const allowedOrigin = "https://universityenvivo.com";

function postRequest(path, body, headers = {}) {
  return new Request(`https://universityenvivo.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: allowedOrigin,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("creates and validates a stateless signed session", async () => {
  const secret = randomBytes(48).toString("base64url");
  const now = Date.now();
  const session = await createAdminSession({ secret, now });

  assert.equal(session.token.split(".").length, 3);
  assert.deepEqual(
    await validateAdminSession(session.token, { secret, now: now + 1_000 }),
    { expiresAt: session.expiresAt },
  );
  assert.equal(
    await validateAdminSession(session.token, {
      secret,
      now: session.expiresAt + 1,
    }),
    null,
  );
});

test("rejects a session token with a modified signature", async () => {
  const secret = randomBytes(48).toString("base64url");
  const session = await createAdminSession({ secret });
  const [sessionId, expiresAt, signature] = session.token.split(".");
  const tamperedSignature = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
  const tamperedToken = `${sessionId}.${expiresAt}.${tamperedSignature}`;

  assert.equal(await validateAdminSession(tamperedToken, { secret }), null);
});

test("session cookie uses secure host-only attributes", () => {
  const cookie = sessionCookie("opaque.signed-token", Date.now() + 60_000);

  assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.doesNotMatch(cookie, /; Domain=/);
});

test("authorization accepts only a validated session cookie", async () => {
  const token = "opaque.signed-token";
  const request = new Request("https://universityenvivo.com/api/analytics", {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });

  const allowed = await authorizeAnalyticsRequest(request, {
    validateSession: async (receivedToken) =>
      receivedToken === token ? { expiresAt: Date.now() + 60_000 } : null,
  });
  assert.equal(allowed.authorized, true);

  const denied = await authorizeAnalyticsRequest(
    new Request("https://universityenvivo.com/api/analytics"),
    { validateSession: async () => ({ expiresAt: Date.now() + 60_000 }) },
  );
  assert.equal(denied.status, 401);
});

test("session endpoint reports authenticated state without exposing session data", async () => {
  const handler = createSessionHandler({
    authorize: async () => ({ authorized: true, session: { expiresAt: 123 } }),
  });
  const response = await handler.fetch(
    new Request("https://universityenvivo.com/api/session"),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true });
});

test("session endpoint denies unauthenticated requests", async () => {
  const handler = createSessionHandler({
    authorize: async () => ({
      authorized: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Authentication is required.",
    }),
  });
  const response = await handler.fetch(
    new Request("https://universityenvivo.com/api/session"),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHORIZED");
});

test("login returns a secure cookie without exposing credentials", async (context) => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  const configuredPassword = randomBytes(24).toString("base64url");
  const configuredSecret = randomBytes(48).toString("base64url");
  process.env.ADMIN_PASSWORD = configuredPassword;
  process.env.ADMIN_SESSION_SECRET = configuredSecret;

  context.after(() => {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previousSecret;
  });

  const handler = createLoginHandler({
    checkRateLimit: async () => ({ allowed: true, resetAt: Date.now() + 60_000 }),
    createSession: async () => ({
      token: "opaque.signed-token",
      expiresAt: Date.now() + 60_000,
    }),
  });
  const response = await handler.fetch(
    postRequest("/api/login", { password: configuredPassword }),
  );
  const responseText = await response.text();
  const cookie = response.headers.get("set-cookie");

  assert.equal(response.status, 200);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.equal(responseText.includes(configuredPassword), false);
  assert.equal(responseText.includes(configuredSecret), false);
  assert.equal(cookie.includes(configuredPassword), false);
});

test("login uses a generic error for an invalid password", async (context) => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_PASSWORD = randomBytes(24).toString("base64url");
  process.env.ADMIN_SESSION_SECRET = randomBytes(48).toString("base64url");

  context.after(() => {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previousSecret;
  });

  const handler = createLoginHandler({
    checkRateLimit: async () => ({ allowed: true, resetAt: Date.now() + 60_000 }),
  });
  const response = await handler.fetch(
    postRequest("/api/login", { password: randomBytes(20).toString("hex") }),
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.deepEqual(body.error, {
    code: "INVALID_CREDENTIALS",
    message: "Invalid credentials.",
  });
});

test("login returns 429 when the shared rate limit is exceeded", async () => {
  const handler = createLoginHandler({
    checkRateLimit: async () => ({ allowed: false, resetAt: Date.now() + 60_000 }),
  });
  const response = await handler.fetch(
    postRequest("/api/login", { password: "irrelevant" }),
  );

  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, "TOO_MANY_ATTEMPTS");
  assert.ok(Number(response.headers.get("retry-after")) >= 1);
});

test("login rejects requests without a trusted origin", async () => {
  const handler = createLoginHandler({
    checkRateLimit: async () => {
      throw new Error("Rate limiting should not run for an untrusted origin.");
    },
  });
  const response = await handler.fetch(
    new Request("https://universityenvivo.com/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "not-used" }),
    }),
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("logout expires the cookie and calls the session destroy hook", async () => {
  let destroyedToken;
  const handler = createLogoutHandler({
    destroySession: async (token) => {
      destroyedToken = token;
    },
  });
  const response = await handler.fetch(
    postRequest(
      "/api/logout",
      {},
      { Cookie: `${SESSION_COOKIE_NAME}=opaque.signed-token` },
    ),
  );
  const cookie = response.headers.get("set-cookie");

  assert.equal(response.status, 200);
  assert.equal(destroyedToken, "opaque.signed-token");
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
});
