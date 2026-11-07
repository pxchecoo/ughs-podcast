import { CONSENT_VERSION, validateSubmission } from '../lib/interview-validation.js';
const section = document.getElementById('interviews');
const form = document.getElementById('interview-form');
const toggle = document.getElementById('interview-toggle');
const shell = document.getElementById('interview-form-shell');
const status = document.getElementById('interview-status');
const button = document.getElementById('interview-submit');
const endpoint = ['universityenvivo.com','www.universityenvivo.com'].includes(location.hostname) ? 'https://ughs-podcast.vercel.app/api/interview-requests' : '/api/interview-requests';
let key = crypto.randomUUID(), busy = false, pendingPayload = null;
// Idempotency key stays in memory through retries. Personal data is never persisted in browser storage.
async function init() {
  const comingSoon = await (window.__siteStatusPromise ?? Promise.resolve(false));
  if (comingSoon) return;
  try {
    const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    if (!response.ok || data.enabled !== true) return;
    section.hidden = false;
    document.querySelectorAll('[data-interview-nav]').forEach(link => { link.hidden = false; });
  } catch { /* Feature remains hidden while unavailable. */ }
}
toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open)); shell.hidden = !open;
  if (open) form.elements.full_name.focus({ preventScroll: true });
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const values = Object.fromEntries(new FormData(form));
  const payload = pendingPayload ?? { ...values, previous_experience: values.previous_experience === '' ? null : values.previous_experience === 'true', consent_contact: form.elements.consent_contact.checked, consent_version: CONSENT_VERSION, submission_key: key };
  const validation = validateSubmission(payload);
  form.querySelectorAll('[data-error]').forEach(el => { el.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  function errors(fields) {
    for (const [field, message] of Object.entries(fields)) {
      const error = form.querySelector(`[data-error="${field}"]`);
      if (error) error.textContent = message;
      form.elements.namedItem(field)?.setAttribute?.('aria-invalid', 'true');
    }
    form.querySelector('[aria-invalid=true]')?.focus();
  }
  if (!validation.valid) { errors(validation.errors); status.textContent = 'Revisa los campos indicados.'; return; }
  pendingPayload = payload;
  busy = true; button.disabled = true; button.textContent = 'Enviando…'; form.setAttribute('aria-busy', 'true'); status.textContent = '';
  // Keep all data and the key during an uncertain result. Freeze fields to preserve the logical payload.
  const controls = [...form.elements]; controls.forEach(el => { el.disabled = true; });
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok || data.ok !== true) {
      if (data.error?.code === 'VALIDATION_FAILED') { pendingPayload = null; controls.forEach(el => { el.disabled = false; }); }
      if (data.error?.fields) errors(data.error.fields);
      throw new Error(data.error?.message ?? 'No pudimos guardar la solicitud. Reintenta con los mismos datos.');
    }
    shell.hidden = true; toggle.hidden = true;
    const success = document.getElementById('interview-success'); success.hidden = false; success.focus(); key = crypto.randomUUID(); pendingPayload = null;
  } catch (e) {
    status.textContent = e.name === 'TypeError' || e.name === 'TimeoutError' ? 'No pudimos confirmar el envío. Conservamos tus datos; reintenta para confirmar sin duplicar la solicitud.' : e.message;
    if (pendingPayload) status.textContent += ' Los campos quedan protegidos mientras confirmamos este envío. Usa Reintentar envío.';
  } finally {
    busy = false; controls.forEach(el => { el.disabled = pendingPayload !== null && el !== button; }); button.disabled = false; button.textContent = pendingPayload ? 'Reintentar envío' : 'Enviar solicitud'; form.removeAttribute('aria-busy');
  }
});
init();
