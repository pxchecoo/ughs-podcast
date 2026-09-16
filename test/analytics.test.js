import assert from "node:assert/strict";
import test from "node:test";

import analyticsFunction from "../api/analytics.js";
import { normalizePrivateKey } from "../api/_analytics.js";

const allowedOrigin = "https://universityenvivo.com";

test("normalizes escaped newlines in the private key", () => {
  assert.equal(
    normalizePrivateKey("line-one\\nline-two\\n"),
    "line-one\nline-two\n",
  );
});

test("allows CORS preflight only for an approved origin", async () => {
  const response = await analyticsFunction.fetch(
    new Request("https://api.example.test/api/analytics", {
      method: "OPTIONS",
      headers: { Origin: allowedOrigin },
    }),
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
});

test("rejects an unapproved origin without CORS access", async () => {
  const response = await analyticsFunction.fetch(
    new Request("https://api.example.test/api/analytics", {
      headers: { Origin: "https://attacker.example" },
    }),
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("denies analytics data without an authenticated session", async () => {
  const response = await analyticsFunction.fetch(
    new Request("https://api.example.test/api/analytics", {
      headers: { Origin: allowedOrigin },
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.equal(JSON.stringify(body).includes("GA_PRIVATE_KEY"), false);
  assert.equal(JSON.stringify(body).includes("GA_CLIENT_EMAIL"), false);
});
