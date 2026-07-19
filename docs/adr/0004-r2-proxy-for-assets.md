# ADR-0004: Proxy VPS (nginx) para assets de Cloudflare R2

**Fecha:** 2025-Q3
**Estado:** aceptado

## Contexto

Los assets de jornadas (perfiles de etapa, mapas, rutómetros, órdenes de salida) se almacenan en Cloudflare R2. R2 ofrece acceso público directo al bucket, pero con limitaciones:

- Las cabeceras HTTP del bucket público de R2 no son completamente configurables (Content-Type, Cache-Control, CORS).
- `Content-Disposition` debe estar ausente en los PDFs para que iOS los abra inline (no los descargue).
- Las URLs públicas de R2 tienen el dominio `r2.cloudflarestorage.com`, que no encaja con el branding del producto.
- En el futuro podría ser necesario añadir autenticación firmada para assets de pago.

## Decisión

Servir los assets a través de un reverse proxy nginx en el Hetzner VPS, bajo el dominio `assets.calendariociclismo.app`. El proxy añade las cabeceras necesarias y pasa las peticiones al bucket R2.

Las subidas se hacen directamente a R2 desde la Supabase Edge Function `r2-upload`, que usa las API keys de R2 y firma las peticiones.

## Alternativas consideradas

- **Acceso público directo a R2** → descartado por falta de control sobre cabeceras y necesidad de dominio propio.
- **Cloudflare Workers como proxy** → considerado pero descartado para evitar coste adicional de Workers cuando ya existe el VPS. Un Worker de proxy sería más simple de mantener a largo plazo si el VPS se elimina.
- **Supabase Storage** → considerado pero descartado porque R2 es más barato para almacenamiento de archivos grandes y Supabase Storage tiene límites en el free tier que R2 no tiene.

## Consecuencias

**Positivas:**
- Control total sobre cabeceras HTTP (Cache-Control, Content-Type, CORS, sin Content-Disposition).
- Dominio propio (`assets.calendariociclismo.app`) sin exponer la URL de R2.
- Posibilidad de añadir autenticación o transformaciones en el futuro sin cambiar las URLs públicas.

**Negativas:**
- El VPS es un punto de fallo adicional: si cae, los assets no son accesibles aunque R2 funcione.
- Requiere mantener la configuración nginx del VPS sincronizada con los cambios de R2.
- Añade latencia (VPS → R2) frente al acceso directo a R2 con CDN de Cloudflare. En la práctica, los assets se cachean en nginx y la latencia extra es mínima tras la primera petición.
