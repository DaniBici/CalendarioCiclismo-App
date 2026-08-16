-- Topología descubierta de los proveedores de resultados.
--
-- Los ids de sus etapas/eventos no cambian durante una edición. Guardarlos en
-- el enlace evita redescubrirlos en cada cron y permite a los fetchers pedir
-- directamente la jornada pendiente. Es una caché: si un proveedor cambia el
-- contrato, el siguiente fetch válido la sustituye por completo.

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "resultsFetchTopology" jsonb,
  ADD COLUMN IF NOT EXISTS "resultsFetchTopologyUpdatedAt" timestamptz;

COMMENT ON COLUMN public.race_uci_links."resultsFetchTopology" IS
  'Caché de etapas y eventos descubiertos por el fetcher de resultados. No es fuente editorial; se reemplaza tras cada fetch válido.';

COMMENT ON COLUMN public.race_uci_links."resultsFetchTopologyUpdatedAt" IS
  'Momento UTC del último refresco de resultsFetchTopology.';
