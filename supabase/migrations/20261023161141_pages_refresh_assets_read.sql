-- El vigilante de Pages del VPS (cc-pages-refresh, docs/runbooks/pages-refresh-vps.md)
-- usa el rol cc_results_worker y lee assets para la firma de documentos por
-- jornada. Solo lectura: la política public_read_assets ya admite a todos los roles.
GRANT SELECT ON TABLE public.assets TO cc_results_worker;
