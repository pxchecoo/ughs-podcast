import { Redis } from "@upstash/redis";

let redisClient;

export function getRedis() {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    const error = new Error("Authentication storage is not configured.");
    error.code = "AUTH_STORAGE_UNAVAILABLE";
    throw error;
  }

  redisClient = new Redis({
    url,
    token,
    signal: () => AbortSignal.timeout(3_000),
  });

  return redisClient;
}
