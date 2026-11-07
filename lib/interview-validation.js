// Shared by browser and server. Contains no environment values or credentials.
export const CONSENT_VERSION = '2026-11-07.v1';
export const POLICY_REFERENCE = '/privacy/#2026-11-07-v1';
export const STATUSES = ['pending', 'in_review', 'approved', 'rejected'];
export const STATUS_LABELS = { pending: 'Pendiente', in_review: 'En revisión', approved: 'Aprobada', rejected: 'Rechazada' };
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = { full_name: [2, 120, 'Escribe tu nombre completo (2–120 caracteres).'], email: [3, 254, 'Escribe un correo válido.'], school_affiliation: [0, 120, 'Utiliza hasta 120 caracteres.'], topic: [3, 180, 'Describe el tema en 3–180 caracteres.'], motivation: [10, 2000, 'Cuéntanos por qué en 10–2000 caracteres.'] };
export function validateSubmission(body) {
  const errors = {}, data = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: { form: 'Solicitud inválida.' } };
  const allowed = new Set([...Object.keys(fields), 'previous_experience', 'consent_contact', 'consent_version', 'submission_key', 'website']);
  if (Object.keys(body).some(key => !allowed.has(key))) errors.form = 'La solicitud contiene campos no permitidos.';
  for (const [name, [min, max, message]] of Object.entries(fields)) {
    const raw = body[name] ?? (min === 0 ? '' : null);
    const value = typeof raw === 'string' ? raw.normalize('NFC').trim().replace(/\r\n/g, '\n') : '';
    data[name] = name === 'email' ? value.toLowerCase() : value;
    if (typeof raw !== 'string' || value.length < min || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) errors[name] = message;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = fields.email[2];
  if (![true, false, null].includes(body.previous_experience)) errors.previous_experience = 'Selecciona una opción válida.';
  data.previous_experience = body.previous_experience;
  if (body.consent_contact !== true) errors.consent_contact = 'Necesitamos tu consentimiento para revisar la solicitud y contactarte.';
  if (body.consent_version !== CONSENT_VERSION) errors.consent_contact = 'La política cambió. Recarga la página y revisa el consentimiento.';
  if (!UUID.test(body.submission_key ?? '')) errors.form = 'Recarga la página antes de enviar.';
  if (typeof body.website !== 'string' || body.website.length > 120) errors.form = 'Solicitud inválida.';
  data.consent_contact = true;
  data.consent_version = CONSENT_VERSION;
  return { data, errors, valid: Object.keys(errors).length === 0 };
}
