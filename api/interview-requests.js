import { waitUntil } from '@vercel/functions';
import { jsonResponse, preflightResponse } from './_http.js';
import { validateSubmission } from '../lib/interview-validation.js';
import { AppError, checkOrigin, readJSON, keyedHash, database, persistentLimit, errorResponse, formEnabled } from '../lib/interview-server.js';
import { deliverNotifications } from '../lib/interview-mail.js';
const METHODS = 'GET, POST, OPTIONS';
export function createInterviewHandler({ db = database, limit = persistentLimit, enabled = formEnabled, deliver = deliverNotifications, background = waitUntil } = {}) {
  return { async fetch(request) {
    try {
      checkOrigin(request, request.method === 'POST');
      if (request.method === 'OPTIONS') return preflightResponse(request, METHODS);
      if (request.method === 'GET') return jsonResponse(request, { enabled: enabled() }, { allowedMethods: METHODS });
      if (request.method !== 'POST') throw new AppError(405, 'METHOD_NOT_ALLOWED');
      if (!enabled()) throw new AppError(503, 'FORM_DISABLED');
      await limit(request, 'submit');
      const body = await readJSON(request);
      const validated = validateSubmission(body);
      if (!validated.valid) throw new AppError(400, 'VALIDATION_FAILED', validated.errors);
      // Never claim success for spam that was not stored.
      if (body.website.trim()) throw new AppError(400, 'INVALID_REQUEST');
      const id = await db.rpc('uev_submit_interview', { p_data: validated.data, p_key_hash: keyedHash(body.submission_key, 'submission'), p_payload_hash: keyedHash(JSON.stringify(validated.data), 'payload') });
      if (!id) throw new AppError(503, 'PERSISTENCE_UNCONFIRMED');
      const task = deliver(id).catch(() => console.error('Notification remains pending', { code: 'NOTIFICATION_PENDING' }));
      // Durable outbox is authoritative even if the runtime cannot retain background work.
      try { background(task); } catch { await task; }
      return jsonResponse(request, { ok: true }, { status: 200, allowedMethods: METHODS });
    } catch (e) { return errorResponse(request, e, METHODS); }
  } };
}
export default createInterviewHandler();
