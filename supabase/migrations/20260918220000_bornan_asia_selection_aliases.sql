-- Alias de selección nacional para los NOC asiáticos que aún no tenían ninguno.
-- `ensure_startlist_team` clasifica una selección nacional solo si el nombre
-- normalizado aparece en `team_selection_aliases`; sin alias crearían un club.
-- Necesario para la importación automática de inscritos de los Juegos Asiáticos
-- 2026 (Bornan), cuyas selecciones se resuelven por nombre de país.
INSERT INTO public.team_selection_aliases
  (id, name, "foldedName", "selectionScope", "selectionCode", "countryCode", source, verified)
VALUES
  ('tsa_asia_af', 'Afghanistan', 'afghanistan', 'national', 'af', 'af', 'curated', true),
  ('tsa_asia_bd', 'Bangladesh',  'bangladesh',  'national', 'bd', 'bd', 'curated', true),
  ('tsa_asia_mo', 'Macao',       'macao',       'national', 'mo', 'mo', 'curated', true),
  ('tsa_asia_qa', 'Qatar',       'qatar',       'national', 'qa', 'qa', 'curated', true),
  ('tsa_asia_sy', 'Syria',       'syria',       'national', 'sy', 'sy', 'curated', true)
ON CONFLICT (id) DO NOTHING;
