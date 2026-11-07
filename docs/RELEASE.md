# Publicación — University en Vivo

El usuario autorizó completar la configuración y publicar el 7 de noviembre de 2026. Esa autorización sustituye la restricción inicial de no publicar automáticamente. El 7 de noviembre confirmó la configuración manual y eligió revisar todas las solicitudes y el historial a los 180 días.

## Configuración completada

- Web pública existente: https://universityenvivo.com, GitHub Pages desde `main` de `pxchecoo/ughs-podcast`.
- API y panel existentes: https://ughs-podcast.vercel.app, Vercel, Node 24. No se cambió Coming Soon ni Analytics.
- Supabase dedicado: `university-en-vivo`, ref `innlgxsvkcpdxxghxqki`, us-east-1, organización autorizada `pxchecoo's Org`. Creación confirmada gratuita, sin reutilizar otros proyectos. Migración aplicada; seis tablas con RLS; prueba de permisos ejecutada con rollback.
- El propietario instaló `SUPABASE_SECRET_KEY` directamente en Vercel Production. No se leyó ni se copió a archivos o al chat. La conexión real fue comprobada desde el backend.
- Cuenta `ughspodcast@gmail.com` confirmada en Supabase Auth y asignada a `interview_staff` como admin activo. Exportación y eliminación permanecen deshabilitadas por defecto; pueden concederse explícitamente cuando haga falta. Las cuentas nuevas no reciben permisos automáticamente.
- Resend: `avisos.universityenvivo.com` **verified**, incluidos DKIM, MX, SPF y CNAME. DNS añadido por el propietario en GoDaddy y comprobado contra el servidor autoritativo. Tracking desactivado; key solo de envío y restringida a ese dominio, instalada únicamente en Vercel Production.
- Avisos y solicitudes de privacidad: `ughspodcast@gmail.com`.
- Política publicada versión `2026-11-07.v1`: revisión manual de todas las solicitudes a los 180 días de última actividad y del historial a los 180 días de cada evento. No se habilitó eliminación automática. La conservación adicional necesita justificación y nueva fecha de revisión.
- `vercel.json` incluye Cron protegido `0 13 * * *`, una vez al día: ventana aproximada de 9:00 a 10:00 a. m. de Puerto Rico. La API de equipo no expone el nombre del plan; se verificó la capacidad mediante un despliegue aceptado con el límite más restrictivo documentado, sin cambiar el plan ni contratar servicios.
- Production: mantenimiento y formulario habilitados; próxima ventana registrada después del despliegue exitoso del schedule. Preview no recibe credenciales de producción.

## Evidencia de activación

- Commit de política y Cron: `7415b65204a1cb88ca6cc0d49f4b460c814e9b44`; Vercel producción `dpl_C3XQ5r2nFzGMRp5BiAucqZy3aAW8`, READY.
- Invocación autorizada del endpoint de mantenimiento por HTTPS: HTTP 200, `ok=true`, outbox procesado sin avisos pendientes. No se expuso el secreto de Cron.
- Supabase registró ejecución full correcta a `2026-11-07T16:05:08.032Z`, duración 562 ms, conectividad/inserción/lectura/borrado correctos y sin código de error. Consulta independiente confirmó cero registros temporales, cero solicitudes y cero notificaciones.
- Verificación alojada: sesiones, salud y Cron anónimos 401; módulos privados, SQL y `.env` 404; mutación de origen ajeno 403; admin/política/módulo público 200; Coming Soon consultable sin cambios. Antes de apertura se confirmó POST deshabilitado sin persistencia.
- Local: sintaxis, build, 67 pruebas automatizadas y ocho grupos de navegador aprobados; audit sin vulnerabilidades reportadas en la verificación de publicación.

## Límites de la verificación

No se crearon solicitudes ficticias en producción ni se enviaron correos de prueba a destinatarios reales. El envío, bounces y cuotas deben observarse con la primera notificación legítima; el outbox conserva los fallos para reintento. La contraseña del administrador no se solicitó ni se usó: el titular debe iniciar sesión con su cuenta para comprobar su acceso personal. El primer disparo automático futuro del scheduler todavía no ha ocurrido; se ejecutó su endpoint protegido con éxito y se desplegó la programación diaria.

La revisión de retención es manual. Para gestionar acceso, recuperación, incidentes y eliminación autorizada, consultar [OPERATIONS.md](OPERATIONS.md). No se crearon cuentas de moderadoras porque no se proporcionaron sus identidades.
