# Verificación ejecutada

Fecha: 7 de noviembre de 2026. Las pruebas locales usaron fixtures y mocks; la verificación alojada posterior fue de solo lectura y controles negativos, con acceso temporal mantenido en memoria.

## Resultados

| Comando/acción | Resultado real | Alcance |
|---|---|---|
| `npm test` antes de cambios | 22/22 aprobadas | Regresiones heredadas |
| `npm run check` | Aprobado | Sintaxis de todos los JS/MJS de API, admin, lib, assets y scripts; JSON Vercel |
| `npm test` final | 67/67 aprobadas | Unitarias, HTTP, SQL PostgreSQL local y regresiones |
| `npm run test:e2e` | 8 grupos de escenarios aprobados | Chrome headless, datos y APIs locales simuladas |
| `npm run build` | Aprobado, 21 archivos estáticos | Paquete dist por allowlist; funciones verificadas por sintaxis, pendientes de empaquetado Vercel |
| `git diff --check` | Sin errores | Espacios/conflictos en diff |
| `git check-ignore` | `.env.local`, `.env.production`, artifacts y dist ignorados | Protección de secretos/salida |
| Comparación de valores locales contra archivos revisables | Sin coincidencias, sin imprimir valores | No se copiaron credenciales locales a código/documentación |
| `npm audit --omit=dev` inicial | 7 avisos: 1 alto y 6 moderados | Cadena existente Google Analytics |
| `npm audit fix` | Corrigió gRPC a 1.14.7; permanecen 6 moderados | Sin `--force` ni sustitución mayor de Google Analytics |
| `npm install @google-analytics/data@7.3.0 --save-exact` y `npm audit --omit=dev --audit-level=low` | 0 vulnerabilidades reportadas | SDK actualizado con cambio de mínimo Node 22, compatible con Node 24 del proyecto |
| Inspección HTTPS del dominio | 200, servidor GitHub.com | Verifica alojamiento público; no prueba funcionalidades nuevas |
| Consulta Vercel read-only | Proyecto existente, sin framework, Node 24, producción READY | No revela plan de facturación ni constituye deploy nuevo |

Logs locales: `artifacts/unit-test-results.txt`, `artifacts/browser-test-results.txt`, `artifacts/dependency-audit.txt`. Capturas: `artifacts/qa/`, todas con fixtures locales. Artefactos ignorados por Git.

## Cobertura útil

### Formulario y HTTP

Campos requeridos, email válido/inválido, límites, consentimiento actual, campos administrativos inyectados, honeypot, tamaño de cuerpo incluso sin Content-Length, rate limit, flag OFF, origen ausente/no permitido, confirmación solo después del RPC, respuesta sin ID/email/datos internos y fallo de correo posterior al commit.

La validación se comparte entre cliente y servidor. Los tests de navegador hacen doble clic durante un envío lento, simulan fallo de red, comprueban que no aparece éxito, preservan campos, reintentan usando la misma clave y muestran confirmación solo con respuesta guardada. El contenido se congela en un resultado incierto para no cambiar el intento lógico.

### PostgreSQL y seguridad

El SQL completo se ejecutó sobre PostgreSQL real embebido PGlite. Auth schema y roles se crean únicamente como fixtures locales. Se probaron:

- Persistencia, estado inicial, timestamps, constraints, dos hashes y unicidad.
- Solicitud + evento + outbox atómicos, sin duplicar en reintento; cambio + evento atómicos.
- RLS en seis tablas, grants explícitos y denegación de SELECT/UPDATE/DELETE/RPC a anon/authenticated.
- Restricción de escrituras directas al rol de servidor sobre personal, solicitudes y auditoría.
- Moderadora permitida para revisar y denegada para exportar/eliminar; inactive denegado.
- Revisión concurrente desactualizada y transición inválida rechazadas.
- Exportación/eliminación explícitamente autorizadas y evento sin copia de datos personales.
- Búsqueda con puntuación de inyección tratada literalmente; paginación acotada.
- Lease de outbox, segundo claim excluido, token incorrecto rechazado, éxito y provider ID, fallo pendiente con backoff, límite de intentos y dead letter.
- Limpieza técnica conserva solicitudes y probes recientes.
- Handler HTTP público conectado al RPC SQL local: dos envíos del mismo intento generan una solicitud y un outbox.
- `supabase/tests/permissions.sql` ejecutado también dentro de esa base aislada.

Los endpoints verifican remoto `/auth/v1/user` y allowlist mediante mocks: JWT no se expone en JSON, cookie usa atributos seguros, usuarios no verificados/anónimos denegados, permisos solicitados por operación, inyección de columnas rechazada y sesión compartida no autoriza entrevistas.

### Correo y monitor

El transporte se sustituyó por un mock: se comprobó idempotency key estable, texto sin PII, destinatarios de servidor, timeout y resultado guardado. No hubo envíos reales.

El monitor se probó con errores de conectividad, mantenimiento, inserción con respuesta perdida, lectura, token corrupto, borrado, confirmación que todavía encuentra un registro e historial inaccesible. Se comprueba limpieza en finally, estado fallido, códigos sanitizados, duración, caché externa, exclusión por lock, slot diario, alertas suprimidas y recuperación. Se verificó que éxito viejo pasa a desconocido, fallo nuevo prevalece y lectura ligera exitosa no oculta un full fallido.

### Interfaz y regresiones

Chrome instalado localmente; viewports 390×844, 820×1180 y 1440×1000. Se verificaron etiquetas, foco inicial, activación de CTA con teclado, `prefers-reduced-motion`, errores específicos, doble envío, reintento, confirmación y ausencia de overflow de documento. Las tablas pueden desplazarse dentro de su contenedor en móvil.

Admin: cuenta personal en dashboard existente sin depender de analíticas, texto de prueba XSS mostrado literalmente, acciones según rol, notas y cambio de estado, borrado de datos de detalle al cerrar sesión, restauración de cuenta admin, estado vacío exacto, búsqueda sin resultados y botón de salud con resultado desconocido tras lectura sola. Coming Soon ON/OFF conserva su comportamiento y flag de entrevistas OFF mantiene sección oculta.

Se inspeccionaron capturas del formulario móvil y admin de escritorio; ajustes scoped de contraste usan texto original oscuro sobre rosa y acento oscuro existente sobre botones administrativos. No se cambiaron los estilos globales de la página por preferencia estética.

## Correcciones realizadas durante verificación

- El script `check` original no recorría correctamente todos los archivos; ahora los valida uno por uno.
- `npm test` se acotó a `*.test.js`; navegador se ejecuta por separado con `test:e2e`.
- Se deshabilitó el timeout permisivo por defecto del rate limiter: Redis indisponible causa rechazo seguro.
- Una lectura ligera exitosa no se interpreta como prueba de escritura/borrado ni cierra incidentes de full.
- Se añadió limpieza aun cuando se pierde la respuesta de inserción y confirmación posterior al DELETE.
- La UI congela el intento incierto y conserva clave/contenido para reintento.
- Se eliminan detalles y notas del DOM al terminar sesión personal.
- Se separó salida estática por allowlist de los módulos de servidor/SQL/archivos locales.
- Se corrigió la dependencia transitiva gRPC señalada con severidad alta.

## Limitaciones y pruebas pendientes

- No hay proyecto/credenciales Supabase staging configurados: no se ejecutaron migraciones ni pruebas en un Supabase alojado. PGlite no reproduce la pasarela, Auth, caches ni concurrencia de varias conexiones reales.
- No se comprobó el flujo real GoTrue/PostgREST, revocación real, HTTPS cookies, CORS entre Pages/Vercel o empaquetado de funciones en Vercel Preview.
- No hay correo sandbox ni permiso para enviar pruebas a destinatarios reales: entrega, bounces, DNS y cuotas pendientes.
- Cron no está activado; el plan y programación de la cuenta no fueron verificables. No se probó una ejecución real del scheduler ni un lock Redis multiinstancia alojado.
- No hay lint/typecheck configurados y el proyecto no usa TypeScript; no se anuncian esos checks como ejecutados. Sintaxis, pruebas y build se ejecutaron realmente.
- No hubo VoiceOver/lector de pantalla humano ni dispositivo iPhone/iPad físico; se probaron sus tamaños representativos en Chrome.
- Los seis avisos moderados que quedaron tras el primer audit fix se resolvieron actualizando el SDK oficial de Analytics a 7.3.0, compatible con el Node 24 existente. Se verificaron los métodos usados, sintaxis, pruebas y build; no se alteró el código ni la configuración de Analytics. [Changelog oficial](https://github.com/googleapis/google-cloud-node/blob/main/packages/google-analytics-data/CHANGELOG.md).
- No se validó producción con registros de usuarios. El checklist posterior de `INTERVIEW-SYSTEM.md` evita modificar solicitudes reales.

## Verificación alojada de la fase de publicación

Se creó el proyecto dedicado `university-en-vivo` en Supabase (costo confirmado $0/mes), sin reutilizar proyectos anteriores. Se aplicó la migración, se confirmó RLS en las seis tablas y se ejecutó permissions.sql con rollback. No contiene solicitudes ni cuentas de personal todavía. Esta evidencia posterior complementa los resultados locales anteriores; ver RELEASE.md para estado de publicación/configuración.

El Preview real de Vercel completó build en Node 24 y pasó verificación HTTPS con acceso temporal en memoria. Se confirmaron 200 en configuración/admin/privacidad, 401 de aplicación en sesiones/salud/Cron sin credenciales, 404 en módulos privados/SQL/.env, 503 con FORM_DISABLED en POST y 403 por Origin no permitido. La lectura de Coming Soon respondió correctamente sin modificar el estado. El helper `scripts/verify-deployment.mjs` recibe las URLs temporales por stdin y no las guarda ni imprime.

La misma verificación HTTPS pasó en el alias de producción y GitHub Pages terminó su build. Chrome confirmó home/Coming Soon/flag OFF y ausencia de overflow en el dominio oficial. El único log de error observado fue FORM_DISABLED de la prueba negativa esperada; no se crearon solicitudes ni se enviaron correos. Ver RELEASE.md para IDs y configuración pendiente.
