# Movimiento de entrevistas

El diseño de reposo, los textos y el contrato de las APIs se conservan. El cambio se limita a los puntos de renderizado de entrevistas y mantenimiento; no modifica servicios, esquema, autenticación, permisos ni validaciones.

## Archivos

- `assets/interview-motion.js`: coordinador nativo compartido por ambas vistas.
- `assets/interview-motion.css`: curvas, respuesta de botones y snapshots compartidos, con selectores limitados a entrevistas.
- `admin/interviews.js`: reconciliación de filas por ID, transacciones de layout y conexión entre fila y detalle.
- `assets/interviews.js`: expansión reversible, revelado coordinado de campos, errores y envío confirmado.
- `assets/interviews.css`: elimina la entrada anterior que solo combinaba opacidad y desplazamiento vertical.
- `admin/index.html` e `index.html`: cargan los recursos de movimiento.
- `test/interview-motion.browser.mjs` y `package.json`: pruebas de navegador y comando `test:motion`.

## Técnicas y transiciones

El coordinador comparte una curva amortiguada `cubic-bezier(.22, 1, .36, 1)`. Las interacciones finitas duran entre 180 y 380 ms, con presión de botones de 100 ms y desfases de campos de hasta 120 ms. La pulsación discreta de loading dura mientras la petición permanece pendiente.

**Fila ↔ detalles.** View Transitions empareja el snapshot de la fila con el panel y el tema con el título. Los nombres solo existen durante la transición. La fila conserva su espacio y se oculta temporalmente durante el viaje del snapshot para evitar una segunda representación visible. El cierre devuelve el foco al botón Revisar de esa solicitud; si desapareció por un filtro, vuelve al buscador. Una nueva solicitud de detalle invalida las respuestas anteriores.

**Fallback compartido.** Sin View Transitions se usa un snapshot inerte de salida y Web Animations para interpolar posición, dimensiones y recorte. El destino se revela desde las coordenadas del origen sin comprimir la tipografía. Si el origen ya no está disponible, la mutación y el foco siguen funcionando con una transición local de layout.

**Listas.** Las filas existentes se reconcilian por `row.id`, sin reconstruir la tabla. FLIP mide sus posiciones presentadas antes del cambio y las posiciones finales tras ordenar o filtrar. Las filas que salen conservan un snapshot breve; las nuevas entran coordinadamente. La altura, paginación, estado vacío y detalle acompañan la misma transacción. Las filas actuales permanecen mientras llega la siguiente respuesta; la dirección se invierte al retroceder de página. Solo la generación de búsqueda vigente puede actualizar el DOM.

**Estados y mantenimiento.** Los valores anteriores y siguientes de etiquetas, fechas y mensajes se superponen mediante snapshots breves y recortes complementarios. El panel interpola su altura y sus controles acompañan los cambios de posición. Los botones conservan sus dimensiones de layout durante loading y coordinan presión, espera y confirmación. El contenido de salud y avisos procede de las mismas respuestas que antes: una conexión correcta no convierte por sí sola el estado completo en Operativa.

**Formulario.** El CTA y el formulario comparten una expansión reversible con dimensiones reales del contenedor y revelado secuenciado de campos. La validación se aplica en una transacción de layout. El botón mantiene su tamaño durante Enviando y el resultado confirmado empareja ese botón con el bloque de éxito. Se mantienen los datos y la misma clave de idempotencia en reintentos de resultado incierto.

## Interrupciones, accesibilidad y coste

- Cada canal de animación puede reemplazarse; FLIP parte de la posición que se está presentando, incluso en una reversión.
- Interrumpir un snapshot no descarta una actualización confirmada del DOM. Los detalles obsoletos se descartan mediante su generación.
- Los snapshots auxiliares son inertes, llevan `aria-hidden` y no conservan IDs. Se retiran al terminar, cancelar, cambiar el viewport, activar movimiento reducido o cerrar sesión.
- `prefers-reduced-motion` desactiva los viajes, snapshots auxiliares, pulsos y animaciones WAAPI; también se atienden cambios de preferencia en caliente.
- Se conservan controles nativos, validación, navegación por teclado, regiones de estado y foco al primer error o confirmación.
- No se usan dependencias nuevas, blur animado ni listeners de medición por frame. Se agrupan mediciones y mutaciones; solo las expansiones de contenedor necesitan interpolar altura durante el movimiento.
- El CSS de View Transitions se activa mediante un atributo temporal del documento. La política CSP de administración se conserva.

## Verificación reproducible

```sh
npm run check
npm test
npm run test:e2e
npm run test:motion
npm run build
```

`test:motion` recorre administración y formulario a 390, 820 y 1440 px, con View Transitions, sin esa API y con movimiento reducido. Comprueba filtros, identidad de nodos, paginación, tabla vacía, respuestas fuera de orden, detalle y foco, todos los estados de revisión, notas, historial, salud, avisos, envío pendiente, doble clic, reintento idempotente, confirmación, interrupciones durante frames activos, resize y retirada de snapshots.

Las respuestas de navegador son fixtures locales. No representan una prueba contra Supabase o el proveedor de correo real. Las pruebas existentes de API y PostgreSQL aislado cubren el contrato y la persistencia sin acceder a esos servicios.

Para repetir con WebKit instalado:

```sh
INTERVIEW_MOTION_BROWSER=webkit INTERVIEW_MOTION_WIDTH=390 npm run test:motion
```

Se aplica la CSP real a la página de administración. En WebKit se omite únicamente su captura de pantalla: el helper de screenshots de Playwright inserta un `<style>` inline, que esa política bloquea. Las interacciones, assertions y comprobación de CSP sí se ejecutan. Chromium genera los artefactos visuales.

Las capturas y el informe JSON se guardan en `artifacts/qa/motion/` (WebKit, en su subdirectorio). El directorio está ignorado por Git.

Para comparar el diseño con una copia del código original guardada antes de editar:

```sh
INTERVIEW_MOTION_BASELINE=/ruta/a/la/copia npm run test:motion
# Solo comparación estática:
INTERVIEW_MOTION_BASELINE=/ruta/a/la/copia INTERVIEW_MOTION_BASELINE_ONLY=1 npm run test:motion
```

La comparación exige igualdad de geometría, textos, colores, tipografías, bordes y espaciados, además de igualdad exacta de los PNG. Solo durante estas capturas se congelan las animaciones preexistentes de fondo para hacer determinista la comparación. La página publicada conserva esas animaciones.

No se realiza ningún despliegue.

## Resultado de esta verificación

- `npm run check`: correcto.
- `npm test`: 67 pruebas correctas, incluidas API y PostgreSQL aislado.
- `npm run test:e2e`: 8 grupos correctos.
- `npm run test:motion`: 18 grupos correctos en Chromium; 6 grupos adicionales correctos en WebKit a 390 px. Tras afinar snapshots y FLIP de columnas, se repitieron los flujos móvil nativo en Chromium y fallback en WebKit.
- Comparación con los originales previos a la edición: 15 combinaciones correctas (tabla/mantenimiento, detalle, formulario abierto, cerrado y confirmado, en tres anchos). Geometría, estilos y capturas coinciden exactamente.
- `npm run build`: correcto; 23 archivos estáticos. Las funciones de API conservan su compilación separada habitual de Vercel.
- No se ejecutaron peticiones contra Supabase, correo ni servicios de producción. No se desplegó.
