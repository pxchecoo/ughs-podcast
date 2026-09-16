import assert from "node:assert/strict";
import test from "node:test";

import { resolveRedisCredentials } from "../api/_redis.js";

test("uses the Vercel Marketplace Redis environment variables", () => {
  assert.deepEqual(
    resolveRedisCredentials({
      KV_REST_API_URL: "https://marketplace.example",
      KV_REST_API_TOKEN: "marketplace-token",
    }),
    {
      url: "https://marketplace.example",
      token: "marketplace-token",
    },
  );
});

test("keeps compatibility with the native Upstash environment variables", () => {
  assert.deepEqual(
    resolveRedisCredentials({
      UPSTASH_REDIS_REST_URL: "https://upstash.example",
      UPSTASH_REDIS_REST_TOKEN: "upstash-token",
      KV_REST_API_URL: "https://marketplace.example",
      KV_REST_API_TOKEN: "marketplace-token",
    }),
    {
      url: "https://upstash.example",
      token: "upstash-token",
    },
  );
});

test("fails closed when persistent storage is not configured", () => {
  assert.throws(
    () => resolveRedisCredentials({}),
    (error) => error.code === "SITE_STORAGE_UNAVAILABLE",
  );
});
