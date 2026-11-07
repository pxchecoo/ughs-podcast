# University en Vivo

Sitio existente en HTML/CSS/JavaScript, frontend en GitHub Pages y API/administración en Vercel.

El sistema de entrevistas está publicado en la web y el backend existentes, con Supabase, acceso personal de administración, remitente verificado y mantenimiento diario. La configuración y evidencia de activación están en [RELEASE.md](docs/RELEASE.md).

```sh
npm ci
npm run check
npm test
npm run build
npm run test:e2e
npm run dev
```

`dev` abre una vista estática en `http://127.0.0.1:4173`; no carga `.env.local` ni conecta servicios. Las pruebas de navegador interceptan toda petición de red y usan datos locales de prueba. En macOS usan Chrome instalado; en Linux instalar Chromium con `npx playwright install chromium`, o indicar `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

- [Informe técnico, estado y archivos](docs/INTERVIEW-SYSTEM.md)
- [Configuración, permisos y recuperación](docs/OPERATIONS.md)
- [Descubrimiento verificado](docs/DISCOVERY.md)
- [Resultados de pruebas y revisión de seguridad](docs/VERIFICATION.md)
- [Migración SQL revisable](supabase/migrations/202611070001_interviews.sql)
- [Ejemplo de variables sin secretos](.env.example)

Para cambios futuros, usar staging y revisar Preview antes de publicar. GitHub Pages y Vercel despliegan por separado. La revisión de conservación a los 180 días es manual; los avisos requieren observar su primera entrega legítima.
