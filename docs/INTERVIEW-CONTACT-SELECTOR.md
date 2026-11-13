# Selector de contacto: teléfono, correo y ambas

El cambio se limita al selector existente y al soporte de `both` en su validación y presentación administrativa.

- `index.html`: dos radios visuales superiores con los iconos Font Awesome solicitados; radio «Ambas» debajo, ocupando las dos columnas. Los iconos tienen nombres accesibles y se conserva el comportamiento nativo de teclado/selección única.
- `assets/interviews.css`: disposición fija de dos columnas en todos los tamaños, usando la paleta y los radios originales. Fondo, borde, color y radios cambian suavemente; escala sutil sin modificar el espacio ocupado. Se desactivan las animaciones con movimiento reducido.
- `assets/interviews.js`: reutiliza `InterviewMotion` para la microinteracción; teléfono requerido para `phone` y `both`.
- `assets/contact-icons.css`, `assets/fa-solid-900.woff2`, `assets/fa-regular-400.woff2`, `assets/fontawesome-LICENSE.txt`: Font Awesome Free 6.7.2 alojado localmente. No estaba disponible previamente. Se habilitan solamente los dos glifos requeridos, sin JavaScript ni llamadas a un CDN. Las fuentes originales no se modificaron.
- `lib/interview-validation.js`: acepta `phone`, `email` y `both`; conserva el correo obligatorio y la validación del teléfono. `both` exige ambos datos.
- `admin/interviews.js`: únicamente amplía la etiqueta de preferencia para mostrar «Ambas».
- `supabase/migrations/20261113010133_interview_contact_both.sql`: amplía dos restricciones existentes y la lista de métodos aceptados en `uev_submit_interview`. No agrega columnas, no cambia datos anteriores y mantiene RLS y permisos del RPC.
- `test/interview-api.test.js`, `test/interview-db.test.js`, `test/interview-contact.browser.mjs`: validación de ambos datos, envío HTTP a PostgreSQL con `both`, idempotencia, registros anteriores, permisos, teclado, dimensiones, iconos, movimiento reducido y presentación administrativa.

El usuario autorizó publicar esta actualización el 12 de noviembre de 2026. La migración se aplicó al proyecto `innlgxsvkcpdxxghxqki` antes de publicar el servidor y el formulario. La comprobación real de escritura, lectura, reintentos y rechazo de `both` sin teléfono o sin correo se ejecutó en una transacción con rollback. Una consulta independiente confirmó cero registros temporales. Se conservaron los permisos exclusivos del servidor.

Verificación: 75 pruebas automatizadas aprobadas, sintaxis y build correctos; ocho grupos generales de navegador aprobados. El selector se verifica en Chromium y WebKit, a 390/820/1440 px y con movimiento normal/reducido. Capturas de referencia en `artifacts/qa/contact/selector-*.png`. Las comprobaciones de navegador usan servicios simulados; la persistencia se verifica mediante el handler HTTP real y PostgreSQL aislado (PGlite).

La incidencia anterior de la matriz general de animaciones de papelera queda fuera de esta actualización; no se modificó ese motor ni sus estilos.
