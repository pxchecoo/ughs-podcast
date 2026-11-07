import { randomUUID, randomBytes } from 'node:crypto';
import { database, AppError } from './interview-server.js';
import { getRedis } from '../api/_redis.js';
import { sendMail } from './interview-mail.js';
const LOCK = 'uev:interviews:health:lock';
const RELEASE = "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
export function summarizeHealth(latest, lastSuccess, now = Date.now()) {
  const recent = latest && now - Date.parse(latest.finished_at) <= 30 * 3600000 && Date.parse(latest.finished_at) <= now + 60000;
  return { state: !recent || (latest.mode !== 'full' && latest.status === 'ok') ? 'unknown' : latest.status === 'ok' ? 'ok' : 'failed', latest: latest ?? null, lastSuccess: lastSuccess ?? null,
    nextCheck: process.env.DATABASE_HEALTH_SCHEDULE_CONFIRMED === 'daily-13-utc' ? 'Diariamente, aproximadamente entre 9:00 y 10:00 a. m. (Puerto Rico)' : null };
}
export async function healthSummary({ db = database, redis = getRedis() } = {}) {
  // External result preserves a failure newer than any DB success during an outage.
  const external = await redis.get('uev:interviews:health:latest');
  try {
    const rows = await db.call('database_health_runs?select=*&order=finished_at.desc&limit=1');
    const full = await db.call('database_health_runs?mode=eq.full&select=*&order=finished_at.desc&limit=1');
    const success = await db.call('database_health_runs?mode=eq.full&status=eq.ok&select=finished_at&order=finished_at.desc&limit=1');
    const externalFull = await redis.get('uev:interviews:health:latest-full');
    const candidates = [external, externalFull, rows[0], full[0]].filter(Boolean).sort((a,b) => Date.parse(b.finished_at)-Date.parse(a.finished_at));
    // A read-only success never conceals a failed write/delete probe.
    const latest = candidates.find(x => x.mode === 'full' || x.status === 'failed') ?? candidates[0];
    return { ...summarizeHealth(latest, success[0]?.finished_at), latestProbe: candidates[0] ?? null };
  } catch (e) {
    if (external?.status === 'failed') return summarizeHealth(external, null);
    throw e;
  }
}
export async function reportIncident(result, { redis, send = sendMail, now = Date.now() }) {
  let previous;
  try { previous = await redis.get('uev:interviews:health:incident'); } catch { /* fallback provider idempotency */ }
  const failed = result.status === 'failed';
  if (!failed && previous?.state !== 'failed') return;
  if (failed && previous?.state === 'failed' && now - (previous.lastSent ?? 0) < 6 * 3600000) return;
  const incident = previous?.state === 'failed' ? previous.id : randomUUID();
  const key = failed ? `health/failure/${incident}/${Math.floor(now / (6 * 3600000))}` : `health/recovery/${incident}`;
  try {
    await send({ subject: failed ? 'University en Vivo — Problemas de base de datos' : 'University en Vivo — Base de datos recuperada',
      text: failed ? 'El monitor detectó un problema técnico. Revisa el estado y los logs autorizados en Vercel. No se incluyen datos de solicitantes.' : 'La comprobación de base de datos se completó correctamente. Revisa las notificaciones pendientes en el panel.', key: previous ? key : `health/${failed ? 'failure' : 'recovery'}/${Math.floor(now / (6 * 3600000))}` });
    try { await redis.set('uev:interviews:health:incident', { id: incident, state: failed ? 'failed' : 'ok', lastSent: now }, { ex: 30 * 86400 }); } catch { /* provider key still suppresses bounded retries */ }
  } catch { console.error('Health alert unavailable', { code: 'HEALTH_ALERT_PENDING' }); }
}
export async function runHealth({ mode = 'full', slot = null, db = database, redis = getRedis(), send = sendMail, clock = Date.now } = {}) {
  const owner = randomUUID();
  if (!await redis.set(LOCK, owner, { nx: true, ex: 300 })) throw new AppError(409, 'HEALTH_BUSY');
  try {
    if (slot) { const cached = await redis.get(`uev:interviews:health:slot:${slot}`); if (cached) return cached; }
    const started = clock(), id = randomUUID(), technical = randomBytes(24).toString('hex');
    const result = { id, mode, status: 'failed', connectivity: false, insertion: null, readback: null, deletion: null,
      duration_ms: 0, error_code: null, created_at: new Date(started).toISOString() };
    let phase = 'CONNECTIVITY', inserted = false;
    try {
      await db.call('database_health_checks?select=id&limit=1'); result.connectivity = true;
      if (mode === 'full') {
        phase = 'MAINTENANCE'; await db.rpc('uev_cleanup_technical');
        phase = 'INSERTION';
        // Mark before awaiting: an insert can commit even when the response is lost.
        inserted = true;
        await db.call('database_health_checks', { method: 'POST', body: { id, run_id: id, technical_value: technical } }); result.insertion = true;
        phase = 'READBACK';
        const [row] = await db.call(`database_health_checks?id=eq.${id}&run_id=eq.${id}&select=technical_value`);
        if (row?.technical_value !== technical) throw new Error('integrity'); result.readback = true;
        phase = 'DELETION';
        await db.call(`database_health_checks?id=eq.${id}&run_id=eq.${id}`, { method: 'DELETE' });
        const remaining = await db.call(`database_health_checks?id=eq.${id}&select=id`);
        if (remaining.length) throw new Error('deletion'); result.deletion = true; inserted = false;
      }
      result.status = 'ok';
    } catch { result.error_code = `HEALTH_${phase}_FAILED`; }
    finally {
      if (inserted) {
        try {
          await db.call(`database_health_checks?id=eq.${id}&run_id=eq.${id}`, { method: 'DELETE' });
          const remaining = await db.call(`database_health_checks?id=eq.${id}&select=id`);
          result.deletion = remaining.length === 0;
        } catch { result.deletion = false; }
        if (!result.deletion) result.error_code = 'HEALTH_CLEANUP_FAILED';
        result.status = 'failed';
      }
    }
    result.duration_ms = Math.max(0, clock() - started); result.finished_at = new Date(clock()).toISOString();
    try { await db.call('database_health_runs', { method: 'POST', body: result }); }
    catch { result.status = 'failed'; result.error_code = result.error_code ?? 'HEALTH_HISTORY_FAILED'; }
    // Always log a fixed technical code outside Supabase; no SQL/raw errors.
    if (result.status === 'failed') console.error('Database health failed', { run: id, code: result.error_code });
    try {
      await redis.set('uev:interviews:health:latest', result, { ex: 31 * 86400 });
      if (mode === 'full') await redis.set('uev:interviews:health:latest-full', result, { ex: 31 * 86400 });
    } catch { console.error('Health cache unavailable', { code: 'HEALTH_CACHE_FAILED' }); }
    if (mode === 'full' || result.status === 'failed') await reportIncident(result, { redis, send, now: clock() });
    if (slot) await redis.set(`uev:interviews:health:slot:${slot}`, result, { ex: result.status === 'ok' ? 30 * 3600 : 300 });
    return result;
  } finally { await redis.eval(RELEASE, [LOCK], [owner]); }
}
