import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { authorizeAnalyticsRequest } from "../api/_auth.js";
import {
  createAdminSession,
  destroyAdminSession,
  SESSION_COOKIE_NAME,
  sessionCookie,
  validateAdminSession,
} from "../api/_session.js";
import { createLoginHandler } from "../api/login.js";
import { createLogoutHandler } from "../api/logout.js";

const allowedOrigin = "https://universityenvivo.com";

class FakeRedis {
  constructor() {
    this.values = new Map();
  }

  async set(key, value, options = {}) {
    if (options.nx && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async del(key) {
    return this.values.delete(key) ? 1 : 0;
  }
}

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

test("creates, validates, and revokes a server-side session", async () => {
  const redis = new FakeRedis();
  const secret = randomBytes(48).toString("base64url");
  const now = Date.now();
  const session = await createAdminSession({ redis, secret, now });

  assert.equal(session.token.split(".").length, 2);
  assert.deepEqual(
    await validateAdminSession(session.token, { redis, secret, now: now + 1_000 }),
    { expiresAt: session.expiresAt },
  );

  await destroyAdminSession(session.token, { redis, secret });
  assert.equal(
    await validateAdminSession(session.token, { redis, secret, now: now + 2_000 }),
    null,
  );
});

test("rejects a session token with a modified signature", async () => {
  const redis = new FakeRedis();
  const secret = randomBytes(48).toString("base64url");
  const session = await createAdminSession({ redis, secret });
  const tamperedToken = `${session.token.slice(0, -1)}${session.token.endsWith("A") ? "B" : "A"}`;

  assert.equal(await validateAdminSession(tamperedToken, { redis, secret }), null);
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

test("logout revokes the server session and expires the cookie", async () => {
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
