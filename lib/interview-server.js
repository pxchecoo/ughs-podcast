import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { getRedis } from '../api/_redis.js';
import { ALLOWED_ORIGINS, jsonResponse } from '../api/_http.js';
export class AppError extends Error {
  constructor(status, code, fields) { super(code); this.status = status; this.code = code; this.fields = fields; }
}
export const STAFF_COOKIE = '__Host-uev_interview_staff';
export function envRequired(name) {
  const value = process.env[name];
  if (!value) throw new AppError(503, 'CONFIGURATION_REQUIRED');
  return value;
}
export function keyedHash(value, scope) {
  const secret = envRequired('SUBMISSION_HASH_SECRET');
  if (secret.length < 32) throw new AppError(503, 'CONFIGURATION_REQUIRED');
  return createHmac('sha256', secret).update(`${scope}\0${value}`).digest('hex');
}
export function secureEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function checkOrigin(request, mutation = false) {
  const origin = request.headers.get('origin');
  // New admin uses same-origin cookies only. Public Pages POST is explicitly allowed.
  const previewOrigin = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  if ((!origin && mutation) || (origin && !ALLOWED_ORIGINS.has(origin) && origin !== previewOrigin)) throw new AppError(403, 'ORIGIN_NOT_ALLOWED');
}
export async function readJSON(request, max = 16384) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError(415, 'JSON_REQUIRED');
  if (Number(request.headers.get('content-length')) > max) throw new AppError(413, 'PAYLOAD_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, 'INVALID_REQUEST');
  let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new AppError(413, 'PAYLOAD_TOO_LARGE'); }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError(400, 'INVALID_REQUEST'); }
}
export function onlyKeys(body, keys) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(k => !keys.includes(k))) throw new AppError(400, 'INVALID_REQUEST');
}
export function createDatabase({ fetcher = fetch, environment = process.env } = {}) {
  return {
    async call(path, { method = 'GET', body, authToken, auth = false } = {}) {
      const base = environment.SUPABASE_URL, key = auth ? environment.SUPABASE_PUBLISHABLE_KEY : environment.SUPABASE_SECRET_KEY;
      if (!base || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base)) throw new AppError(503, 'CONFIGURATION_REQUIRED');
      let response;
      try {
        response = await fetcher(`${base.replace(/\/$/, '')}/${auth ? 'auth/v1' : 'rest/v1'}/${path}`, {
          method, headers: { apikey: key, ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          // Legacy service_role JWTs require Authorization. Modern sb_secret keys use apikey only.
          ...(!auth && key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
          'Content-Type': 'application/json', Prefer: 'return=representation' },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
        });
      } catch { throw new AppError(503, 'DATABASE_UNAVAILABLE'); }
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (auth && [400, 401, 403, 422].includes(response.status)) throw new AppError(401, 'INVALID_CREDENTIALS');
        const mapped = { '40001': [409, 'CONFLICT'], '42501': [403, 'FORBIDDEN'], 'P0002': [404, 'NOT_FOUND'], '22023': [400, 'INVALID_REQUEST'] }[data?.code];
        if (mapped) throw new AppError(...mapped);
        throw new AppError(503, 'DATABASE_UNAVAILABLE');
      }
      return data;
    },
    rpc(name, body = {}) { return this.call(`rpc/${name}`, { method: 'POST', body }); },
  };
}
export const database = createDatabase();
export async function persistentLimit(request, scope = 'submit', actor = '') {
  const limits = { submit: [5, '1 h'], login: [5, '15 m'], health: [2, '1 m'], staff: [90, '1 m'] };
  const [count, duration] = limits[scope] ?? limits.staff;
  const raw = actor || request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const limiter = new Ratelimit({ redis: getRedis(), limiter: Ratelimit.fixedWindow(count, duration), analytics: false, timeout: 0, prefix: `uev:interviews:limit:${scope}` });
  try {
    const result = await limiter.limit(keyedHash(raw, `rate:${scope}`));
    if (result.reason === 'timeout') throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE');
    if (!result.success) { const error = new AppError(429, 'RATE_LIMITED'); error.retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)); throw error; }
  } catch (e) { if (e instanceof AppError) throw e; throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE'); }
}
export function cookieToken(request) {
  return request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${STAFF_COOKIE}=`))?.slice(STAFF_COOKIE.length + 1) ?? null;
}
export function staffCookie(token, ttl = 0) {
  return `${STAFF_COOKIE}=${token}; Path=/; Max-Age=${ttl}; HttpOnly; Secure; SameSite=Strict`;
}
export async function authorizeStaff(request, permission = 'review', db = database) {
  const token = cookieToken(request);
  if (!token || token.length > 4096) throw new AppError(401, 'UNAUTHORIZED');
  const user = await db.call('user', { auth: true, authToken: token });
  if (!user?.id || !user.email_confirmed_at || user.is_anonymous) throw new AppError(401, 'UNAUTHORIZED');
  const [staff] = await db.call(`interview_staff?user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=user_id,role,can_export,can_delete&limit=1`);
  if (!staff || !['admin','moderator'].includes(staff.role) ||
      (permission !== 'review' && staff.role !== 'admin') ||
      (permission === 'export' && !staff.can_export) || (permission === 'delete' && !staff.can_delete)) throw new AppError(403, 'FORBIDDEN');
  return staff;
}
export const messages = {
  INVALID_REQUEST: 'Revisa los datos enviados.', INVALID_CREDENTIALS: 'Credenciales inválidas o cuenta sin acceso.',
  VALIDATION_FAILED: 'Revisa los campos indicados.', UNAUTHORIZED: 'Inicia sesión con tu cuenta personal.',
  FORBIDDEN: 'Tu cuenta no tiene permiso para esta operación.', CONFLICT: 'Otra persona modificó la solicitud. Recarga los detalles antes de guardar.',
  RATE_LIMITED: 'Demasiados intentos. Espera antes de reintentar.', FORM_DISABLED: 'Las solicitudes no están disponibles en este momento.',
  NOT_FOUND: 'La solicitud ya no está disponible.', PAYLOAD_TOO_LARGE: 'La solicitud supera el tamaño permitido.',
};
export function errorResponse(request, error, methods) {
  const safe = error instanceof AppError ? error : new AppError(503, 'SERVICE_UNAVAILABLE');
  // Never log provider responses, submitted data, tokens or raw exception messages.
  if (safe.status >= 500) console.error('Interview service unavailable', { code: safe.code, trace: randomUUID() });
  return jsonResponse(request, { error: { code: safe.code, message: messages[safe.code] ?? 'El servicio no está disponible. Puedes reintentar.', ...(safe.fields ? { fields: safe.fields } : {}) } },
    { status: safe.status, allowedMethods: methods, ...(safe.status === 429 ? { headers: { 'Retry-After': String(safe.retryAfter ?? 60) } } : {}) });
}
export function formEnabled() {
  return process.env.INTERVIEW_FORM_ENABLED === 'true' && ['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_PUBLISHABLE_KEY','SUBMISSION_HASH_SECRET','RESEND_API_KEY','NOTIFICATION_EMAIL_FROM','NOTIFICATION_EMAIL_TO','ADMIN_URL'].every(k => !!process.env[k]);
}
