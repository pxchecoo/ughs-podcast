# Configuración y operación

## Preparación local y staging

1. Revisar `docs/DISCOVERY.md` y el diff en `codex/interview-request-system`. El checkout inicial estaba limpio. No fusionar ni hacer push a la rama pública para probar.
2. Usar Node 22–24 y `npm ci`. Ejecutar `npm run check`, `npm test`, `npm run build` y `npm run test:e2e`.
3. Las pruebas SQL crean roles y un `auth.users` mínimo en PostgreSQL PGlite en memoria. No cargan `.env.local` ni contactan Supabase/Redis/Resend. Browser usa exclusivamente rutas interceptadas. `npm run dev` sirve una vista estática con APIs deshabilitadas; no promete guardar datos.
4. Crear un proyecto Supabase independiente de producción para staging mediante el responsable autorizado. Nunca copiar las credenciales de producción a Preview/local. Configurar un Redis de staging independiente del Redis que controla Coming Soon real.
5. Revisar la migración y aplicarla una vez en ese staging mediante el flujo oficial Supabase de migraciones o SQL Editor. No se incluyó un script que aplique migraciones automáticamente. Si hay colisión de nombres, la transacción falla: investigar antes de continuar, no borrar tablas.
6. Ejecutar `supabase/tests/permissions.sql` desde SQL Editor con rol propietario en staging; su transacción termina en rollback. Ejecutar también pruebas de solicitudes anon y usuarios autenticados usando sus claves de staging contra PostgREST: las tablas y RPC privilegiados deben denegarse.
7. Registrar en la revisión la versión aplicada. No volver a aplicar la migración inicial; preparar nuevas migraciones aditivas para futuras revisiones.

## Variables y llaves

Copiar `.env.example` a un archivo ignorado para desarrollo únicamente si se decide conectar staging manualmente. La vista previa estática no lo carga automáticamente. Para APIs reales usar Vercel Preview o Vercel dev configurado explícitamente con staging, sin descargar/reescribir el `.env.local` existente de este usuario.

En Vercel → proyecto **ughs-podcast** → Settings → Environment Variables, seleccionar cada entorno. Configurar las variables descritas en `INTERVIEW-SYSTEM.md`; claves y tokens como Secret. Obtener URL/keys del Dashboard Supabase del proyecto seleccionado; los secretos modernos `sb_secret_` se usan únicamente en servidor y omiten Authorization JWT, mientras que la compatibilidad legacy service_role sí lo incluye. Ver [claves oficiales Supabase](https://supabase.com/docs/guides/api/api-keys).

Usar un secreto HMAC independiente y estable de al menos 32 caracteres, y otro para Cron. No reutilizar las claves de Google Analytics. No pegar valores en issues, PRs, capturas, logs ni comandos visibles. El archivo `.env.example` no contiene valores reales. El frontend GitHub Pages no necesita estas variables ni un bundle de Supabase.

El origen público y el backend actual están en la allowlist existente de `api/_http.js`. Las mutaciones nuevas requieren Origin. Preview admite adicionalmente solo su propio `https://${VERCEL_URL}` cuando VERCEL_ENV es preview; no acepta cualquier host vercel.app. Un frontend de staging en otro origen requiere revisión y allowlist explícita, incluida respuesta CORS, antes de probarlo. No usar `*` con credenciales. Los endpoints personales se usan desde el mismo origen Vercel de `/admin`.

## Personal y permisos

1. En el proyecto Supabase staging: Authentication → Users, crear/autorizar cuentas institucionales individuales siguiendo el procedimiento de la escuela y verificar el email. No se implementó signup público. Desactivar nuevas altas públicas en Auth si no se utilizan para otros fines; revisar compatibilidad del proyecto antes de alterar ese ajuste.
2. Registrar el UUID verificado de cada cuenta. No aceptar un UUID enviado por el navegador como actor: el servidor lo obtiene de `/auth/v1/user`.
3. Un responsable de DB asigna el rol mediante SQL revisado. Ejemplo, sustituyendo el UUID solo por uno comprobado:

```sql
-- Asignación manual por propietario, primero en staging.
insert into public.interview_staff(user_id, role)
values ('UUID-DE-USUARIO-VERIFICADO', 'moderator');
-- Administrador sin permisos de exportación ni eliminación por defecto:
insert into public.interview_staff(user_id, role)
values ('OTRO-UUID-VERIFICADO', 'admin');
```

4. Conceder can_export/can_delete únicamente tras una decisión explícita de la persona responsable y por usuario. Son false por defecto; CHECK impide concederlos a moderadoras. No se habilitaron para nadie en esta tarea.
5. Para revocar acceso: propietario cambia `active=false`. El servidor reconsulta la allowlist en cada petición y las funciones de cambio vuelven a comprobarla. Esto bloquea el acceso incluso si aún existe un JWT no vencido.
6. Las cookies nuevas son host-only, HttpOnly, Secure y SameSite=Strict; duran como máximo una hora y nunca más que el access token. No se conserva refresh token: al expirar se inicia sesión de nuevo. Logout borra cookie y solicita logout de la sesión Auth; los access tokens Supabase pueden seguir válidos hasta su expiración, por eso la revocación inmediata usa la allowlist. Revisar MFA/políticas institucionales antes de abrir acceso real.

La contraseña compartida continúa autorizando solo las funciones heredadas de analíticas y Coming Soon. No da acceso a entrevistas ni salud. Se puede iniciar sesión personal dentro de la misma pantalla de `/admin` sin depender de Google Analytics.

## Correo y reintentos

1. Usar Resend con cuenta y dominio remitente autorizados. Verificar el dominio según sus registros SPF/DKIM; revisar DMARC con la persona responsable de DNS. Esta tarea no cambió DNS ni creó API keys. Configuración en [documentación oficial de dominios Resend](https://resend.com/docs/dashboard/domains/introduction).
2. Configurar RESEND_API_KEY, remitente institucional y destinatarios administrativos autorizados. Para staging usar destinatarios de sandbox o un buzón de prueba cuyo uso haya sido expresamente autorizado. No enviar a estudiantes ni correos reales de prueba sin autorización.
3. El aviso es texto plano, asunto exacto solicitado y enlace HTTPS al área `/admin#interview-requests`. No incluye nombre, email, tema, motivación ni notas del solicitante. No hay correo automático al solicitante. `mailto` abre el cliente del personal para una comunicación manual.
4. Solicitud/evento/outbox se confirman en un RPC. Solo después se intenta el envío en `waitUntil`; si falla, la solicitud sigue guardada. El usuario no depende de Resend para recibir confirmación de almacenamiento.
5. Cada procesamiento reclama hasta tres eventos mediante `FOR UPDATE SKIP LOCKED`, con lease UUID de tres minutos. Finalizar exige token vigente. Un worker interrumpido permite reclamar de nuevo tras expirar el lease.
6. Máximo seis intentos en siete días desde el primer intento; backoff de 120, 240, 480, 960, 1920 y hasta 3600 segundos. El worker respeta next_attempt_at; el Cron diario solo reintenta cuando vuelva a ejecutarse. **No se ofrece reintento inmediato** con un schedule diario. El botón administrativo permite procesar hasta tres pendientes vencidos por invocación, limitado a dos por minuto por administrador.
7. Error de red/429/5xx queda pendiente; 4xx permanentes o límite de intentos/ventana queda failed para revisión. La API del proveedor se limita a cinco segundos. Sent significa **aceptado por el proveedor**, no prueba de entrega al buzón; verificar logs/bounces en Resend.
8. La clave de proveedor estable usa el UUID del evento. Resend conserva su idempotencia por una ventana limitada, actualmente 24 horas. Reintentos después de esa ventana pueden duplicar un aviso si el proveedor había aceptado el anterior y se perdió la confirmación local; no se garantiza exactamente una entrega. Referencia: [idempotencia Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).
9. Ante failed: revisar provider ID, hora y logs de Resend antes de cualquier reactivación manual. No hay botón de reenvío indiscriminado de dead letters. Si se requiere reactivar un evento tras revisión, hacerlo mediante SQL de propietario acotado al UUID, documentando la autorización y el riesgo de duplicado. No cambiar datos de solicitudes para forzar avisos.
10. El Cron registra OUTBOX_PENDING si falla la reconciliación y envía un aviso técnico diario si detecta failed. Los avisos administrativos fallidos no eliminan solicitudes. Sent de más de 30 días se limpia; failed queda disponible para revisión con datos técnicos mínimos. Aprobar su retención definitiva.

La reconciliación procesa un lote de tres. Ante backlog mayor, un administrador puede repetir el botón respetando el límite. Revisar capacidad/frecuencia según tráfico antes de aumentar lotes o contratar otro plan; no se añadió una cola externa.

## Cron Vercel: preparar sin activar

No hay Cron preexistente en el checkout ni se añadió uno activo. `config/vercel-cron.example.json` contiene solamente el fragmento revisable. Confirmar primero plan, límites de funciones, variables, endpoint y flujo de despliegue. La consulta read-only del equipo no reveló el plan, por lo que se dejó como bloqueo explícito.

La [documentación vigente Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing) permite Cron en todos los planes; Hobby limita cada job a ejecución diaria y puede ejecutarlo entre el inicio y el final de la hora configurada. `0 13 * * *` representa 13:00 UTC; en Puerto Rico, una ventana aproximada de 9:00 a 10:00 a. m. El plan real debe confirmarse antes de incorporar este fragmento a `vercel.json`, preservando cualquier otro schedule que exista entonces.

La ruta real es **GET `/api/interview-maintenance`**, sin redirect. Requiere Authorization Bearer CRON_SECRET válido de al menos 32 caracteres, INTERVIEW_MAINTENANCE_ENABLED=true y VERCEL_ENV=production. No basta User-Agent. Dev/Preview están denegados por ese endpoint incluso con secreto correcto; la rutina puede probarse mediante pruebas locales y, con autorización específica, en un entorno staging aislado mediante un proceso controlado, sin alterar el guard de producción para probar.

Vercel adjunta el secreto configurado al Cron. Revisar que protecciones de Deployment no impidan al scheduler alcanzar el endpoint. No introducir bypass públicos ni desactivar protección global para resolverlo. Configurar DATABASE_HEALTH_SCHEDULE_CONFIRMED=daily-13-utc solo después de comprobar el schedule desplegado; antes la UI dice programación no disponible.

## Monitor y alertas

- Lock Redis compartido, propietario UUID y TTL de 300 segundos, superior al límite local configurado de función (120 segundos). Liberación con compare-and-delete, nunca elimina un lock de otro worker.
- Una invocación completa exitosa guarda cache de slot diario por 30 horas. Duplicados del día devuelven ese resultado; fallos solo se cachean cinco minutos para permitir un reintento de recuperación. Si ya hay trabajo activo, respuesta 409.
- Full comprueba conectividad, limpieza técnica, inserción de token aleatorio, lectura/comparación, borrado y lectura final para confirmar ausencia. Un DELETE HTTP exitoso no basta. Si se pierde una respuesta de INSERT, el finally igualmente intenta limpiar ese UUID de ejecución.
- Se eliminan solo probes de más de 48 horas, historial de más de 30 días y avisos sent antiguos. Una ejecución activa dura como máximo 120 segundos, muy lejos de las 48 horas del barrido. No se insertan entrevistas falsas ni se borran solicitudes reales en mantenimiento.
- El botón personal de administrador es una comprobación **ligera** de lectura. Guarda su resultado técnico; una lectura exitosa nunca oculta un full fallido ni demuestra permisos de escritura/borrado.
- Operativa exige un full exitoso reciente, con máximo de 30 horas y sin una comprobación posterior fallida. Una lectura exitosa por sí sola muestra estado desconocido hasta tener full verificable. Historial viejo no se trata como estado actual.
- Fallos escriben código fijo y UUID de ejecución en logs Vercel, incluso si Supabase no puede registrar el historial. Redis conserva el último resumen y el estado de incidente; Resend envía un aviso técnico sin PII. Se suprimen repeticiones del mismo incidente por seis horas. Recuperación se envía solo tras full exitoso y un incidente previamente fallido.
- Si no responde Redis, no se puede adquirir el lock distribuido: se deniega la operación y queda log técnico. Si la pérdida ocurre al registrar incidente, se intenta deduplicar usando clave temporal del proveedor; pueden perderse estado/recuperación o repetirse avisos al cruzar ventanas. No se garantiza alerta única ni disponibilidad si fallan varios servicios. Si falla correo se registra HEALTH_ALERT_PENDING para revisión; el siguiente full vuelve a intentarlo.
- Cron puede retrasarse, duplicarse u omitirse. Revisar last check y logs; no hay garantía de disponibilidad del plan gratuito.

## Privacidad y retención antes de habilitar

El borrador `privacy/index.html` requiere responsable, canal institucional directo y operativo, plazos para pending/in_review, plazos de auditoría y revisión jurídica/institucional. Su aviso de borrador es deliberado: no activar el formulario mientras permanezca pendiente.

Propuesta para revisar: rejected a 180 días; approved a 365 de última actividad relevante. No está programada la eliminación de datos reales. Un responsable con can_delete puede eliminar una solicitud específica, tras solicitud/autorización institucional y confirmación en la UI. Una moderadora no puede hacerlo.

Para corrección de datos personales: verificar identidad por canal institucional, tramitar con responsable de DB mediante una transacción revisada y acotada al UUID, conservar constancia técnica sin copiar el contenido anterior. La UI permite corregir estado/notas, no reescribir respuestas del solicitante. No realizar correcciones ad hoc sin una solicitud válida.

La versión de política vigente y referencia están en la validación compartida y RPC SQL. Antes del primer envío real puede completarse este borrador; después, congelar la versión publicada. Cambios posteriores deben preservar la referencia histórica, añadir versión nueva y migración que actualice la versión aceptada; no reescribir silenciosamente una política ya consentida.

El contacto no autoriza voz, imagen, grabación ni publicación. Para estudiantes, gestionar permisos separados y los de las personas encargadas según el procedimiento institucional aplicable. Esta función nunca publica contenido.

## Deploy manual y rollback

1. Mantener flags OFF. Revisar npm audit y pruebas. Configurar proyecto/variables de Preview con staging; no editar el dominio ni DNS.
2. Aplicar y validar migración en staging antes de un Preview real. Probar GoTrue, cookies HTTPS, revocación de rol, PostgREST, origen/CORS y envío sandbox autorizado. Confirmar Node 24 y empaquetado de las cuatro nuevas funciones con imports de lib.
3. `npm run build` crea salida estática permitida en dist. Vercel compila root api por separado. Confirmar en Preview que `/admin`, `/privacy/`, `/lib/interview-validation.js` y `/api/*` responden correctamente y que secretos/módulos privados no son archivos públicos. El build local no prueba todo el pipeline de Vercel.
4. Obtener aprobación institucional, seguridad y revisión del diff antes de cualquier fusión o deploy público. Aplicar SQL de producción solo con autorización específica y respaldo/plan revisado. Configurar variables separadas y cuentas aprobadas.
5. Desplegar backend con flags OFF, verificar endpoints no destructivos. Publicar frontend mediante el flujo GitHub Pages real, previamente confirmado en Settings → Pages. No se creó ni cambió ese flujo en esta sesión.
6. Activar formulario solo tras checklist completo; activar Cron únicamente tras configuración y aprobación. Si el plan/reloj no está confirmado, no indicar próxima hora en UI.
7. Si algo falla: desactivar flag del formulario, conservar datos y outbox; restaurar el anterior deployment Vercel/versión de frontend manualmente. La migración es aditiva: no hacer DROP ni rollback destructivo de tablas con solicitudes. El código antiguo puede coexistir con las tablas nuevas. Una corrección de esquema se hace con migración aditiva revisada.
8. Si falla aplicación de SQL dentro del BEGIN/COMMIT, el motor revierte la transacción. Revisar el error y estado de migraciones, no repetir a ciegas ni modificar migraciones ya aplicadas.

## Recuperación operativa

### Supabase inaccesible o pausado

1. Revisar logs Vercel por HEALTH_CONNECTIVITY_FAILED/HEALTH_* y la página de estado de Supabase; no copiar detalles de SQL a canales públicos.
2. Responsable entra al [Dashboard oficial Supabase](https://supabase.com/dashboard), elige organización y proyecto pausado, y usa la opción oficial de Restore/Resume disponible allí. Esperar hasta que el Dashboard indique disponibilidad. Si ya no admite restauración directa, seguir el procedimiento de backup/restore que muestre el proveedor; no usar endpoints no documentados.
3. Ejecutar comprobación ligera autorizada para confirmar lectura. Revisar último full; una lectura por sí sola no elimina una incidencia de escritura/borrado. Para full, esperar Cron o autorizar una ejecución controlada del endpoint de mantenimiento con secreto desde un entorno seguro; no compartir el secreto ni usar tráfico artificial masivo.
4. Revisar outbox e intentos vencidos y procesar pendientes. Reconciliar failed con logs del proveedor antes de reenviar.
5. La actividad diaria no garantiza evitar pausas Free. Supabase documenta que puede pausar proyectos de baja actividad y que Pro evita pausa por inactividad: [disponibilidad oficial](https://supabase.com/docs/guides/platform/going-into-prod), [pausa de proyectos](https://supabase.com/docs/guides/platform/pausing).

### Vercel/API

Revisar deployment READY, logs filtrados por códigos seguros, variables del entorno correcto, duración y origen. Un 401 es sesión/secreto; 403 es origen/permiso; 409 es revisión concurrente o lock; 429 requiere esperar Retry-After; 503 no confirma persistencia. Mantener el mismo intento del formulario y no recargar mientras no se confirme. Si el pipeline nuevo falla, dejar flags OFF y restaurar versión previa sin tocar DB.

### Correo

Confirmar dominio verificado, remitente autorizado, permisos de key, destinatarios, cuotas actuales y logs/bounces Resend. Los límites y precios del plan dependen de la cuenta y deben verificarse en su Dashboard; no se asumió un plan. Revisar outbox desde cuenta admin, procesar pendientes y revisar failed manualmente. No eliminar solicitudes para corregir correo.

### Cron o Redis

Si no hay comprobación reciente, la UI debe pasar a desconocido. Revisar schedule desplegado, secret, flags, entorno production, logs, rutas y protección de deployment. No lanzar bucles de tráfico para compensar pausas. Redis de rate limiting/locks debe estar configurado; ante su indisponibilidad, la API nueva falla cerrada. Los identificadores de red usan HMAC y TTL del fixed window de Upstash, no IPs completas persistentes. Conservar ADMIN_SESSION_SECRET y la configuración Redis de Coming Soon original.
