# Contacto de solicitudes de entrevistas

Se verificó la estructura del repositorio y el esquema alojado del proyecto `university-en-vivo` (`innlgxsvkcpdxxghxqki`) antes de editar. El flujo real es `index.html` → `assets/interviews.js` → `/api/interview-requests` → `uev_submit_interview` → `public.interview_requests`. El validador compartido se ejecuta tanto en el navegador como en el servidor.

## Cambios

- `index.html`: teléfono con `type=tel`, teclado móvil, autocompletado y prefijo inicial +1; grupo de radio obligatorio con llamada/correo, sin selección predeterminada.
- `assets/interviews.css`: estilos exclusivos de los campos añadidos usando la paleta, tamaños y radios existentes; transiciones desactivadas con movimiento reducido.
- `assets/interviews.js`: obligatoriedad condicional, etiquetas animadas mediante el motor existente y errores/foco accesibles para las opciones de contacto. Conserva selección y teléfono en el payload protegido durante reintentos.
- `lib/interview-validation.js`: normalización internacional y comprobación de formato; teléfono opcional por correo, obligatorio por llamada. El correo sigue siendo obligatorio. No se verifica que el número exista o reciba llamadas.
- `api/interview-admin.js`: incluye ambos campos exclusivamente en detalles autenticados. La API pública conserva su respuesta sin datos personales.
- `admin/index.html`, `admin/interviews.js`: teléfono y método en detalles; copiar teléfono/correo, llamar y redactar correo. Datos anteriores muestran «No especificado». Acciones de contacto ocultas en papelera; revisar, exportar, restaurar y eliminar conservan sus permisos.
- `package.json`: comando `npm run test:contact`.
- `test/interview-api.test.js`, `test/interview-db.test.js`, `test/interview-contact.browser.mjs`: cobertura nueva para validación, almacenamiento, migración sobre datos antiguos, permisos, copiar, enlaces y reintentos.
- `test/browser.mjs`, `test/interview-motion.browser.mjs`: los envíos válidos seleccionan ahora explícitamente el nuevo campo obligatorio.

## Migración y activación

Migración generada con Supabase CLI: `supabase/migrations/20261112185026_interview_contact_preferences.sql`.

Agrega `phone_number text` y `preferred_contact_method text` a la tabla existente. Las columnas permiten NULL para conservar registros anteriores, sin rellenar preferencias inventadas. Agrega restricciones de formato, valores permitidos (`phone`/`email`) y teléfono requerido para llamadas. Reemplaza únicamente la función de envío para persistir ambos valores dentro de la misma transacción de solicitud, historial y outbox; conserva idempotencia, RLS y ejecución exclusiva del servidor. No añade datos personales a logs, auditoría ni avisos.

La función SQL acepta temporalmente el payload antiguo sin ambos campos para permitir desplegar por etapas; el endpoint HTTP actualizado exige siempre una opción explícita. Los nuevos campos enviados a la función SQL también se validan mediante restricciones y comprobación de tipos.

Antes de publicar: aplicar la migración al proyecto confirmado, publicar el formulario/módulo público actualizado y desplegar la API/panel. El usuario autorizó la publicación el 12 de noviembre de 2026. La migración se aplicó al proyecto confirmado de Supabase; el historial alojado la registra como `20261112191859_interview_contact_preferences`. Se verificaron la escritura, lectura, idempotencia y permisos en una transacción con rollback; una consulta independiente confirmó cero filas temporales. No quedaron solicitudes ni notificaciones ficticias en producción.

## Verificación

- `npm run check` y `npm run build`: correctos.
- `npm test`: 75 pruebas correctas, incluyendo PostgreSQL aislado (PGlite), persistencia HTTP → RPC, restricciones y denegación de lectura de correo/teléfono a `anon`/`authenticated`.
- `npm run test:contact` y `INTERVIEW_MOTION_BROWSER=webkit npm run test:contact`: ocho combinaciones correctas (390/1440 px, movimiento normal/reducido, Chromium/WebKit). Los servicios se simulan en el navegador; se comprueban las escrituras al portapapeles con un sustituto controlado, su fallo y los destinos de llamada/correo sin iniciar contactos reales.
- `npm run test:corrections`: seis combinaciones correctas (390/820/1440 px, movimiento normal/reducido), incluida apertura/cierre, foco, valores y reproductor existente.
- `npm run test:e2e`: ocho grupos correctos; formulario, panel, sesión, permisos de interfaz, errores, reintentos y Coming Soon.
- Capturas de los campos nuevos revisadas en `artifacts/qa/contact/` (archivos locales ignorados por Git).

## Limitación de la verificación de animaciones

`npm run test:motion` no completa la matriz general: en Chromium, 390 px, modo `fallback`, falla un clic en `#interview-trash-view` después de enviar una solicitud a la papelera (`test/interview-motion.browser.mjs`, escenario de papelera). Playwright informa que `#interview-requests` intercepta el clic. También hubo un fallo intermitente en el escenario nativo; su repetición aislada pasó. La copia limpia de HEAD pasó ambos escenarios aislados. Por ello no se certifica ausencia total de regresiones con los detalles ampliados.

Los ajustes experimentales de desplazamiento, composición y apilamiento no resolvieron el problema y se retiraron. Se conservan sin modificaciones el CSS administrativo y el motor de animaciones. La nueva funcionalidad de contacto pasa sus ocho combinaciones específicas, y las pruebas generales y de correcciones indicadas arriba pasan; la incidencia de interacción tras la animación permanece documentada. El usuario solicitó publicar después de recibir el informe de esta limitación. No se afirma que la matriz general de animaciones haya pasado completa.

El escenario aislado de papelera a 390 px pasó en WebKit y en Chromium de Playwright (modo fallback), pero la repetición de la matriz completa en Chromium volvió a fallar. Se mantiene la limitación; no se considera resuelta por una ejecución aislada. Los ajustes experimentales posteriores también se retiraron.
