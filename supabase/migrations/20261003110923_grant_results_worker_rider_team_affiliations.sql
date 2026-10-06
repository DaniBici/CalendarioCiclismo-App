-- El trigger private.mark_historical_catalog_row (SECURITY INVOKER) consulta
-- public.rider_team_affiliations al insertar en riders_men/riders_women. El
-- worker de resultados del VPS crea fichas al resolver por nombre las carreras
-- resultsOnly y fallaba con «permission denied for table
-- rider_team_affiliations» (Clàssica Camp de Morvedre 2025, 2026-10-03).
GRANT SELECT ON TABLE public.rider_team_affiliations TO cc_results_worker;
