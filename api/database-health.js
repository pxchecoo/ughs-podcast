import { jsonResponse, preflightResponse } from './_http.js';
import { AppError, checkOrigin, authorizeStaff, persistentLimit, errorResponse } from '../lib/interview-server.js';
import { healthSummary, runHealth } from '../lib/interview-health.js';
const METHODS = 'GET, POST, OPTIONS';
export function createHealthHandler({ authorize = authorizeStaff, limit = persistentLimit, summary = healthSummary, run = runHealth } = {}) {
  return { async fetch(request) {
    try {
      checkOrigin(request, request.method === 'POST');
      if (request.method === 'OPTIONS') return preflightResponse(request, METHODS);
      if (!['GET','POST'].includes(request.method)) throw new AppError(405, 'METHOD_NOT_ALLOWED');
      const staff = await authorize(request, 'admin');
      await limit(request, request.method === 'POST' ? 'health' : 'staff', staff.user_id);
      if (request.method === 'POST') await run({ mode: 'connectivity' });
      return jsonResponse(request, await summary(), { allowedMethods: METHODS });
    } catch (e) { return errorResponse(request, e, METHODS); }
  } };
}
export default createHealthHandler();
