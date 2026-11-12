import { CONSENT_VERSION, validateSubmission } from '../lib/interview-validation.js';
import './interview-motion.js';
const motion = window.InterviewMotion;
const section = document.getElementById('interviews');
const form = document.getElementById('interview-form');
const toggle = document.getElementById('interview-toggle');
const shell = document.getElementById('interview-form-shell');
const status = document.getElementById('interview-status');
const button = document.getElementById('interview-submit');
const card = section.querySelector('.interview-card');
const fields = [...form.querySelectorAll('.interview-grid > div')];
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
toggle.addEventListener('click', event => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  if (!open && shell.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  // Pointer activation keeps focus on the CTA (and the mobile keyboard closed).
  // Keyboard users enter the form only once its real layout is available.
  const keyboard = event.detail === 0;
  motion.disclose(shell, open, { focus: () => {
    if (open && keyboard && document.activeElement === toggle) form.elements.full_name.focus({ preventScroll: true });
  } });
});
form.addEventListener('change', event => {
  if (event.target.name !== 'preferred_contact_method') return;
  const required = form.elements.preferred_contact_method.value === 'phone';
  form.elements.phone_number.required = required;
  motion.text(document.getElementById('interview-phone-label'), `Número de teléfono (${required ? 'obligatorio' : 'opcional'})`, card);
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const values = Object.fromEntries(new FormData(form));
  const payload = pendingPayload ?? { ...values, previous_experience: values.previous_experience === '' ? null : values.previous_experience === 'true', consent_contact: form.elements.consent_contact.checked, consent_version: CONSENT_VERSION, submission_key: key };
  const validation = validateSubmission(payload);
  function errors(errorFields, clear = false) {
    const previous = new Map([...form.querySelectorAll('[data-error]')].map(el => [el, el.textContent]));
    motion.layout(card, () => {
      if (clear) {
        form.querySelectorAll('[data-error]').forEach(el => { el.textContent = ''; });
        form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
      }
      for (const [field, message] of Object.entries(errorFields)) {
        const error = form.querySelector(`[data-error="${field}"]`);
        if (error) error.textContent = message;
        form.querySelectorAll(`[name="${field}"]`).forEach(el => el.setAttribute('aria-invalid', 'true'));
      }
    }, { elements: [...fields, status, button] });
    for (const [el, value] of previous) if (value !== el.textContent) motion.animate(el, [
      { opacity: 0, clipPath: 'inset(100% 0 0 0)' }, { opacity: 1, clipPath: 'inset(0)' }
    ], { duration: 200, channel: 'text' });
    form.querySelector('[aria-invalid=true]')?.focus();
  }
  errors(validation.valid ? {} : validation.errors, true);
  if (!validation.valid) { motion.text(status, 'Revisa los campos indicados.', card); return; }
  pendingPayload = payload;
  busy = true; motion.busy(button, true); button.disabled = true; motion.text(button, 'Enviando…', card); form.setAttribute('aria-busy', 'true'); motion.text(status, '', card);
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
    const success = document.getElementById('interview-success');
    await motion.morph(card, button, success, () => {
      motion.cancelDisclosure(shell);
      shell.hidden = true; toggle.hidden = true; success.hidden = false;
    }, { parts: [[card, card]], focus: () => success.focus() });
    key = crypto.randomUUID(); pendingPayload = null;
  } catch (e) {
    let message = e.name === 'TypeError' || e.name === 'TimeoutError' ? 'No pudimos confirmar el envío. Conservamos tus datos; reintenta para confirmar sin duplicar la solicitud.' : e.message;
    if (pendingPayload) message += ' Los campos quedan protegidos mientras confirmamos este envío. Usa Reintentar envío.';
    motion.text(status, message, card);
  } finally {
    busy = false; controls.forEach(el => { el.disabled = pendingPayload !== null && el !== button; }); button.disabled = false; motion.text(button, pendingPayload ? 'Reintentar envío' : 'Enviar solicitud', card); motion.busy(button, false); form.removeAttribute('aria-busy');
  }
});
init();
