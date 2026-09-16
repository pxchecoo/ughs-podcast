import { createHmac } from "node:crypto";

import { getSessionSecret } from "./_session.js";

const WINDOW_MS = 15 * 60 * 1_000;
const MAX_ATTEMPTS = 5;
const attempts = new Map();

function clientAddress(request) {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown";

  return forwarded.split(",")[0].trim();
}

function identifierFor(request) {
  return createHmac("sha256", getSessionSecret())
    .update(clientAddress(request))
    .digest("hex");
}

function pruneExpired(now) {
  if (attempts.size < 500) return;

  for (const [key, value] of attempts) {
    if (value.resetAt <= now) attempts.delete(key);
  }
}

export async function checkLoginRateLimit(request) {
  const now = Date.now();
  const identifier = identifierFor(request);
  pruneExpired(now);

  let entry = attempts.get(identifier);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
  }

  entry.count += 1;
  attempts.set(identifier, entry);

  // Add a small delay to password checks so brute-force attempts are slower,
  // even before the per-instance limit is reached.
  await new Promise((resolve) => setTimeout(resolve, 250));

  return {
    allowed: entry.count <= MAX_ATTEMPTS,
    resetAt: entry.resetAt,
  };
}
