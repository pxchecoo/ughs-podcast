import { database, AppError, envRequired } from './interview-server.js';
export function mailConfig() {
  const url = new URL(envRequired('ADMIN_URL'));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new AppError(503, 'MAIL_CONFIGURATION_REQUIRED');
  return { from: envRequired('NOTIFICATION_EMAIL_FROM'), to: envRequired('NOTIFICATION_EMAIL_TO').split(',').map(x => x.trim()).filter(Boolean), url: `${url.origin}/admin#interview-requests` };
}
export async function sendMail({ subject, text, key }, { fetcher = fetch } = {}) {
  const { from, to } = mailConfig();
  let response;
  try {
    response = await fetcher('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${envRequired('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ from, to, subject, text }), signal: AbortSignal.timeout(5000) });
  } catch { const e = new AppError(503, 'MAIL_NETWORK'); e.retry = true; throw e; }
  if (!response.ok) { const e = new AppError(503, response.status === 429 ? 'MAIL_RATE_LIMIT' : 'MAIL_PROVIDER'); e.retry = response.status === 429 || response.status >= 500; throw e; }
  const result = await response.json();
  if (typeof result.id !== 'string') { const e = new AppError(503, 'MAIL_RESPONSE'); e.retry = true; throw e; }
  return result.id;
}
export async function deliverNotifications(requestId = null, { db = database, send = sendMail } = {}) {
  // Configuration is checked before claiming; missing credentials leave durable pending rows untouched.
  mailConfig(); envRequired('RESEND_API_KEY');
  const rows = await db.rpc('uev_claim_notifications', { p_request_id: requestId });
  const summary = { processed: 0, sent: 0, failed: 0 };
  for (const row of rows) {
    let provider = null, error = null, retry = false;
    try {
      provider = await send({ subject: 'Nueva solicitud de entrevista — University en Vivo',
        text: `Se ha recibido una nueva solicitud de entrevista. Accede al panel administrativo para revisar los detalles.\n\n${mailConfig().url}`,
        key: `uev-interview/${row.id}` });
    } catch (e) { error = ['MAIL_NETWORK','MAIL_RATE_LIMIT','MAIL_PROVIDER','MAIL_RESPONSE'].includes(e.code) ? e.code : 'MAIL_UNAVAILABLE'; retry = e.retry === true; }
    await db.rpc('uev_finish_notification', { p_id: row.id, p_lease: row.lease_token, p_provider_id: provider, p_error: error, p_retry: retry });
    summary.processed++; if (provider) summary.sent++; else summary.failed++;
  }
  return summary;
}
