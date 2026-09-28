-- Normaliza 25 identityKey masculinas que guardaban el id de la ficha en orden
-- nombre-apellido (altas catalog_gold y startlist_auto del 2026-05-21 al 2026-06-26).
-- Los resolvedores buscan compute_identity_key exacto o un alias; 14 de estas fichas no se
-- encontraban por ninguna vía. Ninguna clave nueva está ocupada ni coincide con otra
-- ficha. tillman-sarnowski queda fuera: su clave calculada pertenece al duplicado
-- sarnowski-tillman. Rollback: restaurar old_key por id.
DO $$
DECLARE n integer;
BEGIN
  UPDATE public.riders_men r SET "identityKey" = v.new_key
  FROM (VALUES
    ('eike-behrens','eike-behrens','behrens-eike'),
    ('fausto-valentin-penna','fausto-valentin-penna','fausto-penna-valentin'),
    ('hannes-geisel','hannes-geisel','geisel-hannes'),
    ('jesper-hilbring','jesper-hilbring','hilbring-jesper'),
    ('lars-kohlbrecher','lars-kohlbrecher','kohlbrecher-lars'),
    ('leon-arenz','leon-arenz','arenz-leon'),
    ('leopold-beirig','leopold-beirig','beirig-leopold'),
    ('louis-leidert','louis-leidert','leidert-louis'),
    ('luis-engelhardt','luis-engelhardt','engelhardt-luis'),
    ('lukas-heider','lukas-heider','heider-lukas'),
    ('moritz-binder','moritz-binder','binder-moritz'),
    ('moritz-mauss','moritz-mauss','mauss-moritz'),
    ('nicklas-janowitz','nicklas-janowitz','janowitz-nicklas'),
    ('nicolas-ehret','nicolas-ehret','ehret-nicolas'),
    ('oke-neumann','oke-neumann','neumann-oke'),
    ('paul-felix-petry','paul-felix-petry','felix-paul-petry'),
    ('paul-fietzke','paul-fietzke','fietzke-paul'),
    ('paul-morten-schneider','paul-morten-schneider','morten-paul-schneider'),
    ('pepe-albrecht','pepe-albrecht','albrecht-pepe'),
    ('samuel-kemm','samuel-kemm','kemm-samuel'),
    ('tim-glossner','tim-glossner','glossner-tim'),
    ('tobias-hader','tobias-hader','hader-tobias'),
    ('tom-luis-lehmeier','tom-luis-lehmeier','lehmeier-luis-tom'),
    ('toni-albrecht','toni-albrecht','albrecht-toni'),
    ('vincent-john','vincent-john','john-vincent')) v(id, old_key, new_key)
  WHERE r.id = v.id AND r."identityKey" = v.old_key
    AND v.new_key = public.compute_identity_key(r."firstName", r."lastName");
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 25 THEN RAISE EXCEPTION 'identityKey: se esperaban 25 filas y hay %', n; END IF;
END $$;
