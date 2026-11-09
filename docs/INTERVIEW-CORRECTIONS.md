# Correcciones de entrevistas y reproductor

Fecha: 9 de noviembre de 2026. El informe inicial de implementación local se conserva abajo; la publicación posterior se autorizó con «subelo».

## Publicación autorizada

El 9 de noviembre el usuario autorizó subir esta versión. Antes de publicar el backend se aplicó al proyecto existente `university-en-vivo` la migración revisada `interview_trash`, registrada por Supabase como `20261109161656`. Su fuente local es `supabase/migrations/20261109135836_interview_trash.sql`; el servicio registra su propia fecha de aplicación, igual que ocurrió con la migración original. No se debe volver a aplicar el archivo como una migración nueva.

Se verificaron huellas de integridad antes/después: una solicitud, cuatro eventos y una cuenta de personal conservaron exactamente todos sus campos anteriores. Ninguna solicitud pasó a papelera y no se concedieron permisos de eliminación ni purga. Las seis tablas mantienen RLS; `anon` y `authenticated` no pueden ejecutar los RPC de papelera, restauración o purga. Las pruebas destructivas siguen limitadas a PostgreSQL aislado.

Se repitieron sintaxis, build y 72 pruebas antes de subir. La publicación utiliza las integraciones existentes de GitHub Pages y Vercel desde `main`, sin cambiar dominios, variables de entorno, Cron ni autenticación.

Los advisors no añadieron hallazgos: conservan los avisos informativos de RLS sin políticas (intencional por el acceso exclusivo del servidor) y la advertencia previa de [protección contra contraseñas filtradas deshabilitada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No se modificó esa configuración de Auth.

## Informe inicial antes de autorizar publicación

## Apertura: causa reproducida y corrección

Se reprodujo el código original en Chromium a 390 y 1440 px antes de editarlo. Se guardaron capturas a ~160 ms y mediciones por frame en `artifacts/qa/corrections/before-*`. Los originales se pueden repetir desde `git show HEAD:<archivo>` mientras estos cambios no se hayan confirmado.

El CTA utilizaba el fallback genérico de morphing entre elementos distintos. Este mecanismo simultáneamente ocultaba el botón real, expandía una copia del botón, animaba la altura de la tarjeta, trasladaba el formulario desde las coordenadas del botón y recortaba el formulario y cada campo por separado. Había diez animaciones simultáneas. Los campos recorrían unos 70 px durante la apertura, mientras se expandía el contenedor. El foco se asignaba inmediatamente al primer campo, aún recortado; en teléfonos podía provocar la aparición prematura del teclado. En las mediciones originales de escritorio emulado no se observó un salto del scroll: no se atribuye al scroll un fallo que no se reprodujo.

La apertura usa ahora `InterviewMotion.disclose`: una expansión de la altura real del shell (360 ms al abrir, 280 ms al cerrar) y un revelado coordinado (desde 130 ms), con el easing existente. Conserva el morphing de la tarjeta, el CTA en su posición y la tipografía sin traslaciones o escalado. La altura solo se mide al iniciar/interrumpir la transición; no hay cálculos de dimensiones por frame en la implementación. `flow-root` mantiene dentro del shell los márgenes que antes colapsaban, conservando las posiciones finales de los campos.

`aria-expanded` responde inmediatamente. El shell es inerte durante la transición para impedir foco en campos recortados. El teclado entra al primer campo al terminar y solo si el usuario conserva el foco en el CTA; el puntero no solicita foco ni abre el teclado móvil. Al cerrar, los nodos y valores se conservan. La inversión parte de la altura y opacidad presentadas. Resize, pagehide y cambios de preferencia de movimiento finalizan y limpian la transición. La validación, idempotencia, endpoint y flujo de envío se conservan. La confirmación de envío cancela cualquier apertura pendiente dentro de su propia transacción de layout, evitando que una transición tardía vuelva a mostrar el formulario después del éxito.

Las pruebas instrumentadas finales a 390, 820 y 1440 px midieron **0 px de desplazamiento del scroll y de los campos durante la apertura**, tanto en Chromium como en WebKit y con movimiento reducido. No sustituyen una prueba en un teléfono físico con teclado virtual.

## Reproductor inferior

Se retiraron exclusivamente `#dockBadge` y su asignación de ícono. El `#mainIcon` del reproductor principal y los íconos de episodios se conservan. En móvil, el grid pasa de `48px 1fr` a `minmax(0, 1fr)`: el texto ocupa el ancho disponible y los controles conservan su fila. En escritorio el flex existente utiliza automáticamente el espacio liberado.

Se comprobaron los textos sin truncamiento en el episodio inicial, su alineación al padding original, los enlaces de ambos botones a YouTube, el cambio de episodio y los eventos/progreso/íconos del elemento de audio con un WAV sintético local. Los botones de reproducción existentes abren el enlace del episodio en YouTube; se conservó ese comportamiento. No se cambió la lógica audiovisual ni se probó la disponibilidad de medios externos reales.

## Papelera, permisos y auditoría

Se reutilizaron las cuentas individuales, sesión HttpOnly/Secure, allowlist, autorización remota de usuario, rate limit, control de origen, revisión optimista, RPC y modelo RLS existentes. No se cambió la autenticación de analíticas ni el monitor o las notificaciones.

| Operación | Permiso requerido en servidor y SQL |
|---|---|
| Revisar y cambiar estados activos | Cuenta activa de moderadora o administrador, como antes |
| Eliminar hacia papelera, consultar papelera y restaurar | Administrador activo con `can_delete = true` |
| Eliminar permanentemente | Administrador activo con `can_delete = true` **y** `can_purge = true`, además de estar en papelera |

La migración `supabase/migrations/20261109135836_interview_trash.sql`, creada con `supabase migration new`, agrega `deleted_at`, `deleted_by` y `can_purge` (false por defecto). No concede permisos ni modifica/elimina solicitudes existentes. La restricción SQL impide asignar el nuevo permiso a moderadoras o sin `can_delete`.

`DELETE /api/interview-admin?id=<uuid>` con revisión y confirmación `ELIMINAR` envía a papelera. `POST ...?action=restore&id=<uuid>` exige `RESTAURAR`. `DELETE ...?action=purge&id=<uuid>` exige `ELIMINAR PERMANENTEMENTE` y el permiso adicional. Se validan UUID, claves del cuerpo, revisión entera y confirmación; el actor siempre procede de la sesión del servidor. Los errores SQL se traducen a mensajes seguros. El listado activo, sus páginas y las funciones de revisión/exportación excluyen solicitudes en papelera. `view=trash` exige permiso de eliminación, incluso al pedir un detalle directamente. No hay un contador de entrevistas separado en la arquitectura existente; la paginación deriva del listado filtrado.

Cada cambio bloquea la fila, verifica revisión/permiso y escribe su evento en la misma transacción. Una revisión obsoleta devuelve 409 sin duplicar eventos. RLS y grants siguen denegando lectura/escritura/RPC a `anon` y `authenticated`; `service_role` puede leer y ejecutar entradas controladas, pero no actualizar solicitudes o permisos directamente. Se reemplazó también el RPC de borrado antiguo para impedir que clientes anteriores eludan el nuevo permiso o la papelera.

El borrado definitivo elimina la fila y sus datos personales, elimina el outbox relacionado por la FK existente y deja los eventos técnicos con `request_id = null`, sin nombre, correo, tema, notas ni hashes del solicitante. No se agrega retención automática. La política publicada mantiene revisión manual a los 180 días de la última actividad relevante, con justificación y nueva revisión si se conserva más tiempo; esto incluye las solicitudes en papelera. Una petición verificada de supresión de datos requiere el borrado definitivo manual, no solo mover a papelera. Las copias de seguridad y su retención siguen los procedimientos existentes del proveedor; esta función no modifica backups.

## Confirmación y movimiento administrativo

El diálogo nativo utiliza los tokens visuales existentes, expansión/recorte coordinado con WAAPI y microinteracciones. Cancelar o Escape no envían peticiones. El foco permanece dentro del diálogo y vuelve al botón de origen, también en WebKit. Confirmar muestra `Procesando…`, fija las dimensiones del botón y bloquea envíos repetidos. Un error se muestra dentro del diálogo sin retirar la fila ni anunciar éxito. El borrado permanente añade una segunda etapa y exige escribir la frase completa.

Tras éxito confirmado se cierra el diálogo, se reutiliza el morphing detalle → fila y luego se contrae el snapshot de la fila mientras las restantes se recolocan con FLIP. Se conservan los filtros; si se vacía la última página, se consulta la anterior antes de reemplazar las filas. No se recarga la página. Si falla la consulta posterior a una mutación confirmada, se retira localmente esa fila con movimiento y se informa explícitamente que no pudo actualizarse la paginación.

Las pruebas detectaron un caso de hit testing en Chromium después de repetidas transiciones: al devolver una fila se veían los controles, pero el panel interceptaba sus clics. La fuente temporal del morphing ahora utiliza `opacity: 0` en lugar de alternar `visibility`; conserva sus regiones de interacción mientras viaja el snapshot y se restaura al primer pointerdown/keydown, al terminar o al cancelar. Además, los recortes animados de administración se limitan a snapshots inertes; sus elementos interactivos conservan FLIP, dimensiones y desplazamientos. Se conservan View Transitions y los recortes originales del formulario y del monitor. El diálogo está fuera del panel animado. No se agregan promociones de GPU, lecturas por frame ni estilos persistentes. El cierre previo a retirar una fila puede esperar al final del morphing; los demás consumidores conservan su contrato anterior.

## Archivos

| Archivos | Cambio |
|---|---|
| `assets/interviews.js`, `assets/interviews.css` | Apertura, cierre, foco y flujo estable del formulario |
| `assets/interview-motion.js`, `assets/interview-motion.css` | Disclosure reversible, contracción opcional de filas y espera opcional al terminar un morph |
| `index.html` | Retirar el badge inferior y aprovechar su espacio móvil |
| `admin/index.html`, `admin/admin.css`, `admin/interviews.js` | Confirmación accesible, papelera, restauración, purga y estados animados |
| `api/interview-admin.js`, `lib/interview-server.js` | Rutas protegidas, permiso de purga y separación activo/papelera |
| `supabase/migrations/20261109135836_interview_trash.sql` | Esquema y funciones SQL aditivas, restricciones y auditoría |
| `test/interview-api.test.js`, `test/interview-db.test.js` | Permisos, transacciones, PII, errores y recorrido HTTP → PostgreSQL aislado |
| `test/interview-motion.browser.mjs` | Casos de cancelación, error, doble clic, papelera, restauración, purga, contracción y paginación |
| `test/interview-corrections.browser.mjs`, `package.json` | Comando reproducible de geometría, foco, interrupciones y reproductor |
| `docs/INTERVIEW-MOTION.md`, este informe | Documentación actualizada y límites de verificación |

## Pruebas y límites

Los comandos reproducibles son:

```sh
npm run check
npm test
npm run test:e2e
npm run test:motion
npm run test:corrections
INTERVIEW_MOTION_BROWSER=webkit INTERVIEW_MOTION_WIDTH=390 npm run test:motion
INTERVIEW_MOTION_BROWSER=webkit npm run test:corrections
npm run build
```

- `npm test`: **72 pruebas correctas**. PGlite aplica ambas migraciones y verifica RLS/grants, SQL, revisiones, preservación/restauración de datos, purga con permiso adicional, integridad del historial/FK y ausencia de borrado automático. Incluye llamadas al handler administrativo contra PostgreSQL aislado, además de la persistencia e idempotencia del formulario.
- `npm run check`: correcto; sintaxis de módulos y configuración JSON.
- `npm run lint`: se intentó y devolvió `Missing script: "lint"`. No existe configuración de linter en este repositorio; no se presenta como un lint aprobado.
- `npm run test:corrections`: **6 combinaciones correctas en Chromium y 6 en WebKit** (3 anchos × movimiento normal/reducido), con mediciones y audio local real.
- Build: correcto, **23 archivos estáticos**, sin secretos o código de servidor en `dist`. El empaquetado remoto de funciones sigue siendo responsabilidad del pipeline de Vercel.

- `npm run test:e2e`: **8 grupos correctos**, incluidos acceso personal, moderadora sin eliminación, formulario, validaciones, reintentos, estados vacíos, monitor y Coming Soon.
- `npm run test:motion`: **18 grupos correctos en Chromium** (390, 820 y 1440 px × nativo/fallback/reducido × administración/formulario). La matriz final se ejecutó por ancho con `INTERVIEW_MOTION_WIDTH` para permitir pruebas independientes en paralelo. Todos los modos incluyen cancelar/Escape, foco, fallo de servidor sin retiro de fila, doble clic, contracción del snapshot, papelera, restauración, confirmación adicional de purga, conservación de filtros y reajuste de página. Incluye la respuesta de envío durante una reapertura pendiente del formulario.
- WebKit a 390 px: **6 grupos correctos**, con los mismos tres modos y flujos administrativos/públicos. En WebKit se omite solo la captura administrativa, conservando su CSP; Chromium guarda capturas del viewport durante el flujo.
- `git diff --check`: correcto.

Los logs, capturas y mediciones se guardan bajo `artifacts/qa/corrections/` y `artifacts/qa/motion/`, ignorados por Git; solo contienen fixtures.

No se ejecutaron operaciones contra Supabase/GoTrue/PostgREST remotos, Redis real, correo ni producción. Las respuestas del navegador son fixtures; las pruebas SQL y de integración HTTP utilizan PGlite en memoria. No se corrieron advisors remotos ni se verificó el empaquetado de Vercel, un teléfono físico o el teclado virtual del sistema.

## Activación pendiente, sin ejecutar

Primero validar esta migración y el backend en un Supabase aislado/Preview mediante el procedimiento existente. La nueva versión del backend necesita la migración: sin ella fallará de forma cerrada. Para producción se necesita autorización para aplicar la migración antes de publicar el backend y luego el frontend. No aplicar la migración ni desplegar automáticamente.

Un responsable con acceso SQL puede conceder `can_purge` a administradores individuales aprobados; la migración no lo concede a nadie. No se incluye ninguna instrucción ejecutable que modifique cuentas o solicitudes reales. La migración no debe revertirse borrando columnas con información de papelera; usar una corrección aditiva revisada si fuese necesario.

Se consultaron las [guías oficiales de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), el changelog y sus avisos relevantes. No fue necesario introducir dependencias nuevas ni modificar servicios de alojamiento.
