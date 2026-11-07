# Descubrimiento verificado — 7 noviembre 2026

- Checkout limpio inicialmente en `main`; trabajo aislado en `codex/interview-request-system`. Remote GitHub `pxchecoo/ughs-podcast`. Sin AGENTS.md aplicable ni workflows GitHub en el checkout.
- HTML estático, CSS y JavaScript ES Modules; sin React, TypeScript ni compilación. npm, lockfile; Node local 22.21.0, proyecto Vercel 24.x. Pruebas `node --test`: 22/22 antes de cambios.
- Dominio público: respuesta HTTPS 200, `server: GitHub.com`; CNAME y código confirman frontend GitHub Pages. Backend y admin: proyecto Vercel `ughs-podcast`, sin framework, despliegue existente READY. No se modificó infraestructura. Plan de facturación no revelado por herramientas disponibles.
- `/admin` redirige a Vercel. Sesión heredada firmada, cookie HttpOnly Secure SameSite=Strict, contraseña compartida; no identidad individual ni roles. Esa sesión no puede autorizar acceso a datos escolares. Ampliación compatible: Supabase Auth individual y allowlist `interview_staff`, cookie propia; el panel original conserva analíticas y Coming Soon.
- Upstash Redis existente para Coming Soon; límite de login heredado en memoria. Nueva funcionalidad reutiliza Redis persistente con TTL, sin cambiar el comportamiento de Coming Soon.
- Sin configuración Supabase, proveedor de correo o Cron existentes. `.env.local` ignorado: se inspeccionaron solo nombres, no valores. No se usarán credenciales locales para pruebas externas.
- Identidad pública: Inter; `--bg #fff7f7`, `--text #281d1f`, `--muted #7e666a`, `--soft-red #e98e98`, radios 32/24/18px, tarjetas translúcidas. Admin: Inter/sistema, acento #d97984 y #aa4f5b, radios 28/20/14px. Reutilizar estilos y clases.
- Google Analytics existente, reproductor, episodios, About, Contact y Coming Soon preservados. Las nuevas respuestas del formulario no se envían a analíticas.
- Sección expandible en home, dentro de `publicSite`, antes de Contact; enlaces en ambas navegaciones. Oculta por defecto y habilitada solo por API/flag. Política estática accesible en `/privacy/` (compatible con Pages).
- APIs nuevas planificadas como cuatro funciones planas, siguiendo `default { fetch }`, para evitar proliferación de funciones en planes pequeños. Operaciones diferenciadas por método/acción validada. Supabase vía fetch nativo, sin SDK en navegador.
- SQL revisable, transacciones RPC y RLS deny-by-default. Migraciones y pruebas únicamente locales; pendiente staging, credenciales, aprobación de privacidad y cuentas individuales. Cron preparado como configuración opcional, sin activarlo ni inventar el plan.
