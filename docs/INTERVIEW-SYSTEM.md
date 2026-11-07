# Informe técnico — Sistema de entrevistas y salud de base de datos

Estado de publicación actualizado en [RELEASE.md](RELEASE.md). El informe siguiente describe la implementación original y sus límites iniciales.

Fecha: 7 de noviembre de 2026. Rama: `codex/interview-request-system`.

## 1. Arquitectura encontrada

La aplicación es HTML estático con CSS y JavaScript, npm y Node ES Modules. No hay framework, TypeScript ni compilador de interfaz. El dominio público responde desde GitHub Pages; Vercel aloja `/api` y `/admin`, que redirige desde el dominio público al host `ughs-podcast.vercel.app`. La inspección de Vercel confirmó el proyecto existente y su despliegue READY, pero no reveló el plan de facturación. El dominio no figura entre los dominios de ese proyecto Vercel. No se modificó el alojamiento.

Ya existían Google Analytics, reproductor, episodios, About, Contact y Coming Soon controlado por Redis. La autenticación de analíticas es una contraseña compartida y cookie firmada HttpOnly/Secure/SameSite=Strict. No identifica a cada moderadora. Se conserva para sus funciones originales; los datos de entrevistas exigen una cuenta individual Supabase Auth verificada y una entrada activa en `interview_staff`.

La sección expandible está dentro de `publicSite` antes de Contact y tiene enlaces en las navegaciones existentes. Reutiliza Inter, tarjetas, radios, fondos y colores originales, con ajustes de contraste limitados a sus controles. No se cambió Coming Soon ni se añadió un segundo dashboard. `/admin` muestra las secciones autorizadas según las sesiones existentes y la nueva cuenta personal.

## 2. Funcionalidades y estado real

| Estado | Alcance |
|---|---|
| Implementado y probado localmente | Formulario, validación compartida y servidor, confirmación posterior a persistencia, honeypot, rate limiting persistente, HMAC, idempotencia SQL, consentimiento versionado y política enlazada |
| Implementado y probado localmente | Gestión en `/admin`, búsqueda literal, filtros, orden, paginación de 20, detalle, contacto `mailto`, estados, notas, auditoría atómica, control de revisión concurrente |
| Implementado y probado localmente | Cuentas individuales, verificación remota de identidad y allowlist, moderadora/admin, exportación individual y eliminación individual con permiso explícito, confirmación y evento técnico |
| Implementado y probado localmente | Outbox atómico, envío inmediato en `waitUntil`, leases SQL, backoff, límite de intentos, reconciliación programable y botón administrativo de procesamiento |
| Implementado y probado localmente | Monitor completo en tabla independiente, lectura de integridad, limpieza incluso tras excepciones, confirmación de borrado, locks Redis, idempotencia diaria, logs externos, alerta y recuperación |
| Preparado; pendiente de configuración | Conexión Supabase, usuarios reales, correo Resend, Redis de staging, backend Preview, cabeceras CORS/origen, Cron y despliegue en ambos alojamientos |
| Bloqueado externamente | Credenciales y proyecto Supabase staging no disponibles; no hay proveedor de correo configurado ni destinatarios de prueba autorizados; falta aprobación institucional de privacidad/retención; plan y schedule real no verificables |
| No activado deliberadamente | Publicación del formulario, Cron real, eliminación automática de solicitudes, envío automático a solicitantes, grabación o publicación de entrevistas |
| No implementado | Exportación masiva, publicación de entrevistas y administración web de altas del personal: no son necesarias para el flujo solicitado y amplían el riesgo. Altas/roles se asignan manualmente por responsable autorizado. |

No se afirma que las integraciones remotas estén funcionando. Las pruebas de PostgreSQL usan un motor real local PGlite; no reproducen la pasarela Supabase ni GoTrue ni el entorno Vercel.

## 3. Archivos creados

| Ruta | Propósito |
|---|---|
| `.env.example` | Variables sin valores reales, flags OFF |
| `README.md` | Entrada y comandos |
| `lib/interview-validation.js` | Reglas compartidas, consentimiento, etiquetas y UUID; único módulo de lib publicado como estático |
| `lib/interview-server.js` | Adaptador Supabase fetch, errores seguros, sesión personal, autorización, límites y HMAC |
| `lib/interview-mail.js` | Correo administrativo sin datos de solicitantes, idempotencia y procesamiento de outbox |
| `lib/interview-health.js` | Comprobación, limpieza, locks, incidentes y frescura |
| `api/interview-requests.js` | GET de habilitación y POST público |
| `api/interview-admin.js` | Sesión personal, list/detail/update/audit/export/delete/outbox con autorización por operación |
| `api/database-health.js` | Resumen y comprobación ligera para administradores |
| `api/interview-maintenance.js` | Endpoint Cron protegido para mantenimiento y reconciliación |
| `assets/interviews.js`, `assets/interviews.css` | Formulario, estados y accesibilidad |
| `assets/privacy.css`, `privacy/index.html` | Borrador de privacidad en ruta compatible con Pages |
| `admin/interviews.js` | Gestión de entrevistas dentro del panel existente |
| `supabase/migrations/202611070001_interviews.sql` | Esquema, constraints, índices, RPC, RLS y grants |
| `supabase/tests/permissions.sql` | Aserciones SQL de grants/RLS y denegación en transacción revertida |
| `config/vercel-cron.example.json` | Fragmento opcional para fusión manual; no schedule activo |
| `scripts/check.mjs` | Revisión de sintaxis de todos los módulos y JSON |
| `scripts/build.mjs` | Salida estática `dist` mediante lista de archivos permitidos |
| `scripts/dev.mjs` | Vista previa local sin secretos ni servicios externos |
| `test/interview-api.test.js` | Validación, HTTP, autenticación, roles, correo y Cron |
| `test/interview-db.test.js` | Migración real local, transacciones, restricciones, grants y aislamiento |
| `test/interview-health.test.js` | Fallos, limpieza, locks, alertas y frescura |
| `test/browser.mjs` | Chrome: responsive, formulario, admin, XSS y regresiones |
| `docs/DISCOVERY.md`, `docs/OPERATIONS.md`, `docs/VERIFICATION.md`, este archivo | Arquitectura, instalación, despliegue, límites, evidencia y recuperación |

`artifacts/qa/` y los logs locales de pruebas están ignorados por Git; contienen exclusivamente fixtures de prueba.

## 4. Archivos modificados

- `index.html`: enlaces y sección expandible, estilos y módulo nuevo. Contenido original preservado.
- `admin/index.html`: acceso personal y secciones nuevas dentro del dashboard existente.
- `admin/admin.js`: restaura ambas sesiones y muestra las áreas permitidas sin exigir acceso a Google Analytics para revisar entrevistas.
- `admin/admin.css`: reglas nuevas usando tokens existentes; accesibilidad y responsive.
- `package.json`, `package-lock.json`: comandos; `@vercel/functions` para `waitUntil`; PGlite y Playwright solo de desarrollo. Actualización correctiva de gRPC de la cadena existente.
- `vercel.json`: conserva rewrite y cabeceras; build estático y duración de nuevas funciones. **No contiene crons activos**.
- `.gitignore`: mantiene protección de `.env*`, permite `.env.example`, ignora salida y artefactos.

## 5. Base de datos y autorización

Se crean seis tablas, sin reemplazar ni vaciar tablas existentes:

- `interview_staff`: referencia a `auth.users`; rol moderator/admin, activo y permisos adicionales default false. No hay asignación automática por correo o signup.
- `interview_requests`: UUID, límites CHECK, consentimientos, referencia a política, fechas de servidor, revisión entera e idempotencia única mediante HMAC. Un segundo HMAC vincula la clave al contenido normalizado para impedir reutilización accidental con otro contenido.
- `interview_request_events`: eventos sin copia de respuestas ni notas; actor verificable. Operaciones directas de actualización/eliminación denegadas al rol operativo. Al eliminar una solicitud, queda un evento técnico sin vínculo a datos personales.
- `notification_outbox`: un aviso lógico por solicitud, intentos, next attempt, token/fecha de lease, provider ID y código seguro. Borrado de solicitud elimina su outbox; sent antiguos se purgan a los 30 días.
- `database_health_checks`: solo UUID de prueba/ejecución, token técnico y fecha. Sin triggers de entrevistas ni avisos.
- `database_health_runs`: modo full/connectivity, resultados por fase, tiempo, código seguro y fechas.

Índices: fecha/id y estado/fecha para solicitudes; request/date para eventos; vencimiento de avisos pendientes; fecha para salud. La búsqueda es una comparación literal parametrizada; se limita a 80 caracteres, 20 resultados y 400 páginas. No se añadieron índices de texto indiscriminados; si el volumen crece, revisar EXPLAIN en staging y diseñar búsqueda antes de ampliar esos límites.

Todas las tablas tienen RLS habilitado, grants explícitos y denegación por defecto a `anon`/`authenticated`. No hay políticas permisivas de navegador. El backend usa secreto con bypass de RLS: cada operación de personal verifica `/auth/v1/user`, confirmación, cuenta no anónima y allowlist; los RPC de cambios también verifican el actor en PostgreSQL. `service_role` no puede modificar directamente solicitudes, personal ni eventos; usa RPC autorizados. Los helpers internos no se publican con EXECUTE.

`uev_submit_interview` guarda solicitud, evento y outbox en una transacción. `uev_review_interview` bloquea la fila, compara revisión, valida transición y guarda evento en la misma transacción. Finales approved/rejected deben reabrirse a in_review para cambiar decisión; pending debe pasar por in_review antes de approved. La eliminación y exportación individual exigen permisos específicos, confirmación y auditoría.

La migración inicial deliberadamente falla ante colisiones de nombres en vez de ocultar incompatibilidades con IF NOT EXISTS. El ejecutor registra una sola aplicación; revisiones posteriores deben ser migraciones aditivas nuevas.

## 6. Variables de entorno

Todas se configuran en Vercel → proyecto existente → Settings → Environment Variables, separando Development, Preview y Production. Las variables privadas no se incluyen en la salida estática ni se configuran en GitHub Pages. `.env.example` está vacío salvo valores de configuración públicos y flags OFF.

| Nombre | Propósito | Entorno | Clasificación | Origen/configuración |
|---|---|---|---|---|
| `SUPABASE_URL` | Proyecto API/DB | Dev/Preview/Production distintos | Config servidor | Dashboard Supabase → Connect/Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Acceso a Auth con token de usuario | Cada proyecto | Publicable por diseño, se usa solo en servidor aquí | Supabase → Settings → API Keys |
| `SUPABASE_SECRET_KEY` | RPC/tablas de servidor | Cada proyecto | Secreta, bypass RLS | Supabase → Settings → API Keys; preferir `sb_secret_`; acepta JWT service_role heredado |
| `SUBMISSION_HASH_SECRET` | HMAC de claves, contenido y límites | Cada entorno | Secreta, mínimo 32 caracteres | Generar y guardar manualmente por responsable; no se generó en esta tarea |
| `RESEND_API_KEY` | Proveedor de avisos | Sandbox/staging/producción separados | Secreta | Resend → API Keys, alcance de envío adecuado |
| `NOTIFICATION_EMAIL_FROM` | Remitente verificado | Cada entorno | Config servidor | Resend → Domains; identidad institucional aprobada |
| `NOTIFICATION_EMAIL_TO` | Destinatarios administrativos separados por comas | Cada entorno | Config privada | Lista aprobada por responsable; nunca en cliente |
| `ADMIN_URL` | Origen HTTPS del panel para avisos | Preview/Production | Config servidor | Host real verificado, sin query/usuario/contraseña; actual backend en ejemplo |
| `INTERVIEW_FORM_ENABLED` | Apertura del formulario | Cada entorno | Config servidor | `false` hasta terminar aceptación; solo literal `true` habilita |
| `INTERVIEW_MAINTENANCE_ENABLED` | Permite Cron | Solo producción autorizada | Config servidor | `false` por defecto |
| `CRON_SECRET` | Bearer de Cron | Producción | Secreta, mínimo 32 caracteres | Configurar manualmente; Vercel lo adjunta al Cron |
| `DATABASE_HEALTH_SCHEDULE_CONFIRMED` | Texto de próxima ventana verificable | Producción | Config servidor | Vacío; `daily-13-utc` solo tras confirmar schedule real |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Redis existente | Dev/Preview/Production separados | URL/config y token secreto | Integración existente de Vercel/Upstash |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Alias existentes de Redis | Si ya se usan | Config y secreto | Compatibilidad del proyecto; no duplicar valores innecesariamente |
| `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` | Login heredado de analíticas | Entornos actuales | Secretas | Conservar valores existentes; no autorizan entrevistas |
| `GA_PROPERTY_ID`, `GA_CLIENT_EMAIL`, `GA_PRIVATE_KEY` | Analíticas existentes | Entornos actuales | Config/privada/secreta | Conservar configuración Google existente |
| `VERCEL_ENV`, `VERCEL_URL` | Entorno y origen propio de Preview | Vercel | Plataforma, no crear manualmente allí | Inyectadas por Vercel; solo el host exacto de Preview se acepta adicionalmente |

Los flags no verifican automáticamente la aprobación institucional, el plan o todos los permisos. El responsable debe completar el checklist de activación. No cambiar `SUBMISSION_HASH_SECRET` durante reintentos activos: alteraría las claves de deduplicación; coordinar rotación y ventana de cierre.

## 7. Configuración manual pendiente

La secuencia completa está en [OPERATIONS.md](OPERATIONS.md). Hace falta crear/seleccionar staging seguro, revisar y aplicar SQL allí, ejecutar pruebas de permisos, crear cuentas verificadas sin signup público, asignar allowlist, verificar remitente/destinatarios, aprobar privacidad y retención, configurar Preview, confirmar plan y schedule, y revisar ambos flujos de alojamiento. No se cambió nada en esos servicios.

## 8. Pruebas y evidencia

Consultar [VERIFICATION.md](VERIFICATION.md) para comandos y resultados, incluidas limitaciones. Existen pruebas reales locales de PostgreSQL y pruebas HTTP conectadas a ese motor, además de mocks de proveedores y navegador. No se sustituyeron credenciales reales por valores ficticios presentados como válidos.

## 9. Seguridad y límites pendientes

Entradas acotadas por streaming, método/acción/columnas permitidos, origen explícito para mutaciones, cookie host-only HttpOnly/Secure/SameSite=Strict, identidad remota, rol por operación, RPC privados, revisiones optimistas, texto con `textContent`, errores/logs sanitizados, no-store, rate limiting Redis con expiración y sin fallback permisivo por timeout, secrets de servidor y salida estática por allowlist.

No hay almacenamiento de respuestas ni tokens de sesión en localStorage/sessionStorage; el formulario mantiene su intento en memoria y congela sus campos ante un resultado incierto para reintentar el mismo contenido. Una recarga/cierre pierde ese estado: se debe evitar recargar durante una confirmación incierta y resolverla con el equipo si no se puede recuperar. No hay deduplicación permanente por email, para permitir futuras solicitudes legítimas.

Pendientes: revisión institucional; MFA/políticas de contraseñas y revocación a nivel de organización; pruebas reales GoTrue/PostgREST/CORS y Vercel; infraestructura y plan; accesibilidad con lector de pantalla humano; la verificación alojada y configuración restante indicadas en RELEASE.md. La actualización oficial de Analytics a 7.3.0 resolvió los avisos de dependencias; audit actual reporta cero vulnerabilidades. Las claves privilegiadas siempre requieren controles de servidor: RLS no compensa un backend comprometido.

## 10. Despliegue manual

Preparar Preview con credenciales de staging y flags OFF, aplicar migración revisada en staging, probar flujo completo, inspeccionar salida estática y funciones Vercel, y revisar el diff. La configuración de build nueva publica solo `dist/` como archivos estáticos y permite a Vercel compilar las funciones de `/api` por separado; esa compilación completa de plataforma aún necesita verificarse en Preview.

GitHub Pages debe seguir publicando el frontend con su flujo actual, que no está definido en este checkout. Confirmarlo en Settings → Pages antes de fusionar. No inferir que un deploy Vercel actualiza el dominio público. Desplegar backend antes del frontend conserva la compatibilidad con el sitio anterior; con flags OFF, un frontend nuevo oculta la sección si la API no está preparada. No publicar o fusionar automáticamente.

## 11. Verificación posterior sin alterar solicitudes reales

- Confirmar home, navegación, episodios, About, Contact y Coming Soon en sus estados esperados sin cambiar el toggle de producción para probar.
- Consultar configuración pública del formulario y política; confirmar flags y versión aprobada.
- Comprobar que login inválido, sesión compartida y usuario sin allowlist no acceden a entrevistas.
- Verificar sesión personal de cuenta autorizada, roles y estados vacíos/reales sin modificar registros de solicitantes.
- Ejecutar solo comprobación ligera autorizada; revisar historial full del Cron y limpieza técnica.
- Confirmar Cron en Dashboard, sin redirecciones, secretos ausentes/incorrectos denegados y logs sin PII.
- Revisar outbox por estado sin reenviar ni abrir acciones destructivas sobre datos reales.
- Probar inserciones, reintentos, exportación y eliminación únicamente con fixtures en staging.
- Confirmar que URLs estáticas no entregan `.env.local`, SQL ni módulos de servidor.

## 12. Recuperación

Procedimientos concretos para Supabase, Vercel, correo, Cron, rollback y permisos en [OPERATIONS.md](OPERATIONS.md). El monitor registra fallos fuera de Supabase y envía avisos por Resend, usando Redis para incidentes. Si fallan también Redis o correo, no existe garantía de alerta; los logs y la observación del proveedor siguen siendo necesarios.

## 13. Confirmaciones de la fase inicial, antes de la autorización de publicación

No se accedió a datos de producción ni se ejecutó SQL remoto; solo se consultaron metadatos del proyecto Vercel y cabeceras del sitio público. No se eliminaron datos de producción, no se publicaron secretos, no se hicieron cambios irreversibles de infraestructura, no se desplegó ni se hizo push/merge. No se generaron credenciales ni se enviaron correos o notificaciones reales de prueba. Los únicos borrados fueron fixtures de bases locales y salida estática generada para reconstrucción.
