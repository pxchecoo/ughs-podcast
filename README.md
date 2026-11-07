# University en Vivo

Sitio existente en HTML/CSS/JavaScript, frontend en GitHub Pages y API/administración en Vercel.

La ampliación de entrevistas está implementada y su código está publicado en la web y el backend existentes, **con recepción desactivada hasta completar la configuración**. La fase de publicación autorizada por el usuario se documenta en [RELEASE.md](docs/RELEASE.md).

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

Antes de activar: proyecto Supabase staging, revisión de migración/RLS, cuentas individuales, correo verificado, política de privacidad aprobada, comprobación de plan/Cron y revisión de Preview. El flujo GitHub → Vercel y el de GitHub Pages se publican por separado; no hacer push a `main` para probar.
