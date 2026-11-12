import { jsonResponse, preflightResponse } from './_http.js';
import { AppError, checkOrigin, readJSON, onlyKeys, database, persistentLimit, authorizeStaff, staffCookie, cookieToken, errorResponse } from '../lib/interview-server.js';
import { deliverNotifications } from '../lib/interview-mail.js';
import { UUID, STATUSES } from '../lib/interview-validation.js';
const METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';
const DETAIL_COLUMNS = 'id,full_name,email,phone_number,preferred_contact_method,school_affiliation,topic,motivation,previous_experience,status,consent_contact,consent_version,consent_policy_reference,consent_accepted_at,reviewed_by,reviewed_at,internal_notes,revision,created_at,updated_at,deleted_at,deleted_by';
export function createInterviewAdminHandler({ db = database, limit = persistentLimit, authorize = authorizeStaff, deliver = deliverNotifications } = {}) {
  return { async fetch(request) {
    try {
      checkOrigin(request, !['GET','OPTIONS'].includes(request.method));
      if (request.method === 'OPTIONS') return preflightResponse(request, METHODS);
      if (!['GET','POST','PATCH','DELETE'].includes(request.method)) throw new AppError(405, 'METHOD_NOT_ALLOWED');
      const url = new URL(request.url), action = url.searchParams.get('action') ?? 'list';
      if (action === 'login' && request.method === 'POST') {
        await limit(request, 'login');
        const body = await readJSON(request, 4096); onlyKeys(body, ['email','password']);
        if (typeof body.email !== 'string' || body.email.length > 254 || typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw new AppError(400, 'INVALID_REQUEST');
        const result = await db.call('token?grant_type=password', { auth: true, method: 'POST', body: { email: body.email.trim(), password: body.password } });
        if (!result?.access_token || !Number.isFinite(result.expires_in)) throw new AppError(401, 'INVALID_CREDENTIALS');
        const verifyRequest = new Request(request.url, { headers: { cookie: staffCookie(result.access_token) } });
        const staff = await authorize(verifyRequest, 'review', db);
        return jsonResponse(request, { staff }, { allowedMethods: METHODS, headers: { 'Set-Cookie': staffCookie(result.access_token, Math.min(result.expires_in, 3600)) } });
      }
      if (action === 'logout' && request.method === 'POST') {
        const token = cookieToken(request);
        if (token) { try { await db.call('logout?scope=local', { auth: true, authToken: token, method: 'POST' }); } catch { /* Cookie still cleared. No refresh token is retained. */ } }
        return jsonResponse(request, { ok: true }, { headers: { 'Set-Cookie': staffCookie('') }, allowedMethods: METHODS });
      }
      const trash = url.searchParams.get('view') === 'trash';
      if (url.searchParams.has('view') && !['active','trash'].includes(url.searchParams.get('view'))) throw new AppError(400, 'INVALID_REQUEST');
      const permission = action === 'purge' ? 'purge' : request.method === 'DELETE' || action === 'restore' || trash ? 'delete' : action === 'export' ? 'export' : action === 'audit' || action === 'outbox' ? 'admin' : 'review';
      const staff = await authorize(request, permission, db);
      await limit(request, 'staff', staff.user_id);
      if (action === 'session' && request.method === 'GET') return jsonResponse(request, { staff }, { allowedMethods: METHODS });
      if (action === 'outbox' && request.method === 'POST') {
        await limit(request, 'health', staff.user_id);
        const result = await deliver();
        return jsonResponse(request, result, { allowedMethods: METHODS });
      }
      if (action === 'outbox' && request.method === 'GET') {
        const rows = await db.call('notification_outbox?select=id,status,attempts,next_attempt_at,error_code,created_at&status=neq.sent&order=created_at.desc&limit=30');
        return jsonResponse(request, { rows }, { allowedMethods: METHODS });
      }
      const id = url.searchParams.get('id');
      if (id && !UUID.test(id)) throw new AppError(400, 'INVALID_REQUEST');
      if (action === 'list' && request.method === 'GET' && !id) {
        const page = Number(url.searchParams.get('page') ?? 1), status = url.searchParams.get('status'), q = (url.searchParams.get('q') ?? '').trim();
        const order = url.searchParams.get('order') ?? 'desc';
        if (!Number.isInteger(page) || page < 1 || page > 400 || (status && !STATUSES.includes(status)) || q.length > 80 || !['asc','desc'].includes(order)) throw new AppError(400, 'INVALID_REQUEST');
        // RPC bound parameters: search punctuation cannot become PostgREST filter syntax.
        const rows = await db.rpc(trash ? 'uev_list_interview_trash' : 'uev_list_interviews', { p_actor: staff.user_id, p_page: page, p_status: status || null, p_search: q, p_order: order });
        return jsonResponse(request, { rows: rows.slice(0, 20), hasMore: rows.length > 20, page }, { allowedMethods: METHODS });
      }
      if (!id) throw new AppError(400, 'INVALID_REQUEST');
      if (request.method === 'GET' && action === 'audit') {
        const events = await db.call(`interview_request_events?request_id=eq.${id}&select=id,event_type,old_status,new_status,actor_id,notes_changed,created_at&order=created_at.desc&limit=100`);
        return jsonResponse(request, { events }, { allowedMethods: METHODS });
      }
      if (request.method === 'GET' && action === 'list') {
        const [row] = await db.call(`interview_requests?id=eq.${id}&deleted_at=${trash ? 'not.is.null' : 'is.null'}&select=${DETAIL_COLUMNS}&limit=1`);
        if (!row) throw new AppError(404, 'NOT_FOUND');
        return jsonResponse(request, { row }, { allowedMethods: METHODS });
      }
      if (action === 'export' && request.method === 'POST') {
        const body = await readJSON(request, 128); onlyKeys(body, ['confirm']);
        if (body.confirm !== true) throw new AppError(400, 'INVALID_REQUEST');
        const row = await db.rpc('uev_export_interview', { p_actor: staff.user_id, p_id: id });
        return jsonResponse(request, { row }, { allowedMethods: METHODS });
      }
      if (request.method === 'PATCH' && action === 'list') {
        const body = await readJSON(request, 18000); onlyKeys(body, ['revision','status','internal_notes']);
        if (!Number.isSafeInteger(body.revision) || body.revision < 1 || body.revision > 2147483647 || !STATUSES.includes(body.status) || typeof body.internal_notes !== 'string' || body.internal_notes.length > 4000) throw new AppError(400, 'INVALID_REQUEST');
        const row = await db.rpc('uev_review_interview', { p_actor: staff.user_id, p_id: id, p_revision: body.revision, p_status: body.status, p_notes: body.internal_notes.normalize('NFC').trim() });
        return jsonResponse(request, { row }, { allowedMethods: METHODS });
      }
      if (request.method === 'DELETE' && action === 'list') {
        const body = await readJSON(request, 256); onlyKeys(body, ['revision','confirmation']);
        if (body.confirmation !== 'ELIMINAR' || !Number.isSafeInteger(body.revision) || body.revision < 1 || body.revision > 2147483647) throw new AppError(400, 'INVALID_REQUEST');
        await db.rpc('uev_trash_interview', { p_actor: staff.user_id, p_id: id, p_revision: body.revision });
        return jsonResponse(request, { ok: true }, { allowedMethods: METHODS });
      }
      if ((request.method === 'POST' && action === 'restore') || (request.method === 'DELETE' && action === 'purge')) {
        const body = await readJSON(request, 256); onlyKeys(body, ['revision','confirmation']);
        if (!Number.isSafeInteger(body.revision) || body.revision < 1 || body.revision > 2147483647 || body.confirmation !== (action === 'restore' ? 'RESTAURAR' : 'ELIMINAR PERMANENTEMENTE')) throw new AppError(400, 'INVALID_REQUEST');
        await db.rpc(action === 'restore' ? 'uev_restore_interview' : 'uev_delete_interview', { p_actor: staff.user_id, p_id: id, p_revision: body.revision });
        return jsonResponse(request, { ok: true }, { allowedMethods: METHODS });
      }
      throw new AppError(405, 'METHOD_NOT_ALLOWED');
    } catch (e) { return errorResponse(request, e, METHODS); }
  } };
}
export default createInterviewAdminHandler();
