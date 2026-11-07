# Publicación — University en Vivo

El usuario autorizó completar la configuración y publicar el 7 de noviembre de 2026. Esta autorización sustituye la restricción inicial de no publicar de forma automática.

## Infraestructura preparada

- GitHub: `pxchecoo/ughs-podcast`, main, Pages legacy desde raíz, dominio oficial existente. No se cambió dominio ni DNS.
- Vercel: proyecto existente `ughs-podcast`, Node 24, backend y admin. No se creó un sitio independiente.
- Supabase: proyecto dedicado `university-en-vivo`, ref `innlgxsvkcpdxxghxqki`, región us-east-1, organización autorizada `pxchecoo's Org`. Costo de creación confirmado $0/mes. No se modificaron los proyectos previos.
- Migración aplicada al proyecto nuevo vacío; RLS en las seis tablas y prueba SQL de permisos confirmadas.
- Resend: subdominio de envío `avisos.universityenvivo.com` preparado sin tracking. API key solo de envío y restringida a ese dominio, instalada directamente en Vercel sin mostrarse ni guardarse en archivos.
- Destinatario y canal de privacidad indicado por el usuario: `ughspodcast@gmail.com`.
- Variables nuevas de servidor instaladas en Production de Vercel: URL, publishable key, HMAC, Cron secret, proveedor, remitente, destinatario, ADMIN_URL y flags OFF. No se leyeron credenciales privadas existentes ni se reutilizaron claves de Analytics.
- Dependencias: actualización oficial de Analytics a 7.3.0, Node >=22 compatible con el proyecto. Audit actual: 0 vulnerabilidades reportadas.

## Activación pendiente

1. El propietario debe copiar la clave secreta de Supabase al campo `SUPABASE_SECRET_KEY` de Vercel → ughs-podcast → Environment Variables → Production, directamente entre paneles. No pegar secretos en el chat. Las herramientas conectadas de Supabase exponen claves publicables, no la clave privilegiada necesaria para el backend.
2. Añadir los registros de [DNS-SETUP.md](DNS-SETUP.md) en GoDaddy. No hay conexión disponible a ese proveedor de DNS; no se cambiaron registros existentes. Luego verificar el dominio de envío en Resend.
3. Crear/verificar la cuenta personal autorizada en Supabase Auth. Solo después asignar su UUID verificado al rol adecuado. No se fabricaron identidades ni se otorgaron permisos a usuarios sin verificar.
4. Revisar/aprobar el borrador de privacidad y los plazos institucionales con el canal proporcionado antes de abrir recepción.
5. Verificar el flujo completo con servicios configurados; habilitar el formulario y mantenimiento solo entonces.

## Publicación

Preview verificado: `dpl_8EXKQ1u3j3nHLuy8SJT1xXwhiUKB`, commit `96e2b8b72f8fb20dca0b527f53cb03e0eecddaaa`, READY. Build de Vercel completado y verificación HTTPS de APIs, admin, privacidad, módulos públicos, bloqueo de módulos de servidor/SQL/.env, POST deshabilitado, Origin no permitido y lectura de Coming Soon. No se crearon ni modificaron registros de aplicación. La publicación de main sigue a esta comprobación; los flags permanecen OFF hasta completar la configuración.
