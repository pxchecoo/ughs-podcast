import { createHmac } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";

import { getRedis } from "./_redis.js";
import { getSessionSecret } from "./_session.js";

let loginRateLimiter;

function getLoginRateLimiter() {
  if (loginRateLimiter) return loginRateLimiter;

  loginRateLimiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(5, "15 m"),
    prefix: "uev:admin:login",
    timeout: 3_000,
  });

  return loginRateLimiter;
}

function clientAddress(request) {
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function checkLoginRateLimit(request) {
  const identifier = createHmac("sha256", getSessionSecret())
    .update(clientAddress(request))
    .digest("hex");
  const result = await getLoginRateLimiter().limit(identifier);

  if (result.reason === "timeout") {
    const error = new Error("Rate limiting is temporarily unavailable.");
    error.code = "AUTH_RATE_LIMIT_UNAVAILABLE";
    throw error;
  }

  return {
    allowed: result.success,
    resetAt: result.reset,
  };
}
