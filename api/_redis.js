import { Redis } from "@upstash/redis";

let redisClient;

export function resolveRedisCredentials(environment = process.env) {
  const url =
    environment.UPSTASH_REDIS_REST_URL ?? environment.KV_REST_API_URL;
  const token =
    environment.UPSTASH_REDIS_REST_TOKEN ?? environment.KV_REST_API_TOKEN;

  if (!url || !token) {
    const error = new Error("Persistent site storage is not configured.");
    error.code = "SITE_STORAGE_UNAVAILABLE";
    throw error;
  }

  return { url, token };
}

export function getRedis() {
  if (redisClient) return redisClient;

  const { url, token } = resolveRedisCredentials();

  redisClient = new Redis({
    url,
    token,
    signal: () => AbortSignal.timeout(3_000),
  });

  return redisClient;
}
