# ADR-0001: Migración de Firestore a Supabase/PostgreSQL

**Fecha:** 2025-Q1
**Estado:** aceptado

## Contexto

La primera versión del backend usaba Firebase Firestore como base de datos. Con el tiempo aparecieron varios problemas estructurales:

- Las consultas complejas (ordenar por categoría UCI, filtrar por género y categoría, rango de fechas) requerían índices compuestos que Firestore no generalizaba bien.
- El modelo de datos de carreras/etapas es relacional por naturaleza (carrera tiene muchas etapas, etapa tiene muchas emisiones, etc.). Firestore fuerza a duplicar datos o hacer múltiples round-trips.
- El coste se volvía impredecible con el crecimiento del volumen de lecturas.
- Sin SQL, añadir lógica de negocio en consultas (agrupaciones, joins) era muy costoso en código cliente.

## Decisión

Migrar a Supabase (PostgreSQL + REST API autogenerada + Auth + Edge Functions + Storage).

La migración se hizo en caliente: se exportaron los datos de Firestore, se modelaron como tablas relacionales (`races`, `race_days`, `broadcasts`, `assets`, `startlist_teams`, etc.) y se importaron a Supabase. El cliente web y las apps se actualizaron para usar la API REST de Supabase.

## Alternativas consideradas

- **Mantener Firestore** → descartado por limitaciones de consulta y coste creciente.
- **PlanetScale / Neon / Railway** → descartados porque Supabase ofrece en un solo producto: PostgreSQL + API REST autogenerada + Auth + Storage + Edge Functions + realtime. No necesitamos montar múltiples servicios.
- **Backend propio (Node.js en VPS)** → descartado por coste de mantenimiento para un equipo de una persona.

## Consecuencias

**Positivas:**
- Consultas SQL completas: filtros, joins, ordenaciones complejas en una sola query.
- REST API autogenerada sin código de servidor (PostgREST).
- Edge Functions para lógica que requiere service role (push, uploads a R2).
- Coste predecible y free tier generoso.
- Migraciones SQL versionadas en `supabase/migrations/`.
- Row Level Security (RLS) nativo.

**Negativas:**
- Las apps ya instaladas con Firestore necesitaron actualización forzada.
- El modelo relacional requiere más cuidado al añadir columnas (Room version bumps en Android, migraciones SQL).
- Sin realtime por defecto en las apps (se usa polling / pull-to-refresh en lugar de listeners de Firestore).
