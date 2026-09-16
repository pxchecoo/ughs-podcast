import assert from "node:assert/strict";
import test from "node:test";

import { createSiteStatusHandler } from "../api/site-status.js";

const allowedOrigin = "https://universityenvivo.com";

class FakeRedis {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async set(key, value) {
    this.values.set(key, value);
    return "OK";
  }
}

function siteStatusRequest(method = "GET", body, headers = {}) {
  return new Request("https://universityenvivo.com/api/site-status", {
    method,
    headers: {
      ...(method === "POST"
        ? { "Content-Type": "application/json", Origin: allowedOrigin }
        : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("defaults the public site status to disabled and exposes no extra data", async () => {
  const redis = new FakeRedis();
  const handler = createSiteStatusHandler({ redis: () => redis });
  const response = await handler.fetch(
    siteStatusRequest("GET", undefined, { Origin: allowedOrigin }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { comingSoon: false });
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
});

test("requires an authenticated admin to change the site status", async () => {
  const redis = new FakeRedis();
  const handler = createSiteStatusHandler({
    redis: () => redis,
    authorize: async () => ({
      authorized: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Authentication is required.",
    }),
  });
  const response = await handler.fetch(
    siteStatusRequest("POST", { comingSoon: true }),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHORIZED");
  assert.equal(redis.values.size, 0);
});

test("persists the setting so a separate public request sees it", async () => {
  const redis = new FakeRedis();
  const handler = createSiteStatusHandler({
    redis: () => redis,
    authorize: async () => ({ authorized: true }),
  });

  const update = await handler.fetch(
    siteStatusRequest("POST", { comingSoon: true }),
  );
  assert.equal(update.status, 200);
  assert.deepEqual(await update.json(), { comingSoon: true });

  const publicRead = await handler.fetch(siteStatusRequest());
  assert.deepEqual(await publicRead.json(), { comingSoon: true });

  const disable = await handler.fetch(
    siteStatusRequest("POST", { comingSoon: false }),
  );
  assert.deepEqual(await disable.json(), { comingSoon: false });
  assert.deepEqual(await (await handler.fetch(siteStatusRequest())).json(), {
    comingSoon: false,
  });
});

test("rejects invalid updates and untrusted origins", async () => {
  const redis = new FakeRedis();
  const handler = createSiteStatusHandler({
    redis: () => redis,
    authorize: async () => ({ authorized: true }),
  });

  const invalidBody = await handler.fetch(
    siteStatusRequest("POST", { comingSoon: "yes" }),
  );
  assert.equal(invalidBody.status, 400);
  assert.equal(redis.values.size, 0);

  const untrustedOrigin = await handler.fetch(
    siteStatusRequest(
      "POST",
      { comingSoon: true },
      { Origin: "https://attacker.example" },
    ),
  );
  assert.equal(untrustedOrigin.status, 403);
  assert.equal(redis.values.size, 0);
});
