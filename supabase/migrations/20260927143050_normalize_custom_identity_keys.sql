-- Normaliza cinco identityKey con formato propio (valor = id de la ficha), que ningún
-- resolvedor calcula: resolve_riders, resolve_uci_results_by_name, match_existing_riders y
-- plan_startlist_import buscan compute_identity_key(firstName, lastName) exacto o un alias.
--
--   ficha                   clave anterior           clave nueva
--   tobias-muller (M)       tobias-muller            muller-tobias   (alias previo muller-tobias)
--   tekirdag-arda (M)       tekirdag-arda            arda-tekirdag   (alias previo arda-tekirdag)
--   timo-frohlich (M)       timo-frohlich            frohlich-timo
--   yakisir-reyhan (W)      yakisir-reyhan           reyhan-yakisir
--   almeida-joao-sub23-pt   almeida-joao-sub23-pt    almeida-joao-2007
--
-- João Almeida sub-23 (2007-01-18) es homónimo de almeida-joao (1998-08-05, clave
-- almeida-joao): adopta la convención base-añoNacimiento, que trg_set_identity_key
-- conserva al editar el nombre; la clave anterior se recalculaba a almeida-joao y chocaba
-- con el índice único. Rollback: restaurar la clave anterior de esta tabla por id.
DO $$
DECLARE n integer;
BEGIN
  UPDATE public.riders_men r SET "identityKey" = v.new_key
  FROM (VALUES ('tobias-muller','tobias-muller','muller-tobias'),
               ('tekirdag-arda','tekirdag-arda','arda-tekirdag'),
               ('timo-frohlich','timo-frohlich','frohlich-timo'),
               ('almeida-joao-sub23-pt','almeida-joao-sub23-pt','almeida-joao-2007')) v(id, old_key, new_key)
  WHERE r.id = v.id AND r."identityKey" = v.old_key;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 4 THEN RAISE EXCEPTION 'identityKey masculinas: se esperaban 4 filas y hay %', n; END IF;

  UPDATE public.riders_women SET "identityKey" = 'reyhan-yakisir'
  WHERE id = 'yakisir-reyhan' AND "identityKey" = 'yakisir-reyhan';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'identityKey femenina: se esperaba 1 fila y hay %', n; END IF;
END $$;
