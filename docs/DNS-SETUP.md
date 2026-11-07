# Verificación de avisos.universityenvivo.com en GoDaddy

Dominio de envío preparado en Resend. No modifica el correo Gmail ni el alojamiento GitHub Pages. Solo añadir estos registros en la zona `universityenvivo.com`; conservar registros actuales.

| Tipo | Nombre | Valor | Prioridad |
|---|---|---|---|
| TXT | `resend._domainkey.avisos` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDE7wbhTChNMLD1hF2XNdE/VHyLO9WrT0rzghaCg4A32uBX3v7bp4NTviVS5sGZgVUUGePjY5OsqDN6IyBlZCDiwyWZKWitpykCrnKtUtuXYt3yQKVgssXkpcmwHk7F3Bzkim2QUjKMC+4ltuoa10Su9W3XG0viB6qaLfGuEJNQ8QIDAQAB` | — |
| MX | `send.avisos` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send.avisos` | `v=spf1 include:amazonses.com ~all` | — |
| CNAME | `rsend.avisos` | `send.forge.rmta.net` | — |

TTL automático o valor predeterminado del proveedor. Al guardar, verificar el dominio en Resend. El TXT DKIM es una clave **pública** DNS, no una credencial de aplicación.
