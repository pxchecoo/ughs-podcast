import { jsonResponse } from './_http.js';
import { AppError, secureEqual, errorResponse } from '../lib/interview-server.js';
import { runHealth } from '../lib/interview-health.js';
import { deliverNotifications, sendMail } from '../lib/interview-mail.js';
import { database } from '../lib/interview-server.js';
export const maxDuration = 120;
export function createMaintenanceHandler({ run = runHealth, deliver = deliverNotifications, environment = process.env, db = database, send = sendMail } = {}) {
  return { async fetch(request) {
    try {
      if (!environment.CRON_SECRET || environment.CRON_SECRET.length < 32 || !secureEqual(request.headers.get('authorization'), `Bearer ${environment.CRON_SECRET}`)) throw new AppError(401, 'UNAUTHORIZED');
      if (request.method !== 'GET') throw new AppError(405, 'METHOD_NOT_ALLOWED');
      if (environment.INTERVIEW_MAINTENANCE_ENABLED !== 'true' || environment.VERCEL_ENV !== 'production') throw new AppError(503, 'MAINTENANCE_DISABLED');
      const result = await run({ slot: new Date().toISOString().slice(0, 10) });
      let notificationState = 'not_run';
      if (result.status === 'ok') { try { const sent = await deliver(); notificationState = sent.failed ? 'pending' : 'processed'; } catch { notificationState = 'pending'; console.error('Outbox reconciliation failed', { code: 'OUTBOX_PENDING' }); } }
      if (result.status === 'ok') {
        try {
          const failed = await db.call('notification_outbox?status=eq.failed&select=id&limit=1');
          if (failed.length) await send({ subject: 'University en Vivo — Avisos requieren revisión', text: 'Existen notificaciones administrativas pendientes de revisión. Consulta el panel y el proveedor de correo antes de reintentarlas. Las solicitudes permanecen guardadas.', key: `uev-outbox-review/${new Date().toISOString().slice(0,10)}` });
        } catch { console.error('Outbox maintenance alert unavailable', { code: 'OUTBOX_REVIEW_REQUIRED' }); }
      }
      return jsonResponse(request, { ok: result.status === 'ok', notifications: notificationState }, { status: result.status === 'ok' ? 200 : 503 });
    } catch (e) { return errorResponse(request, e, 'GET'); }
  } };
}
export default createMaintenanceHandler();
