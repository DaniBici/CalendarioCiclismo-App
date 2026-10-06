-- Normaliza los nombres de los corredores españoles de la Clàssica Camp de
-- Morvedre 2025 (6e08f4f2) y 2026 (FoJNjtj1): un apellido de uso salvo los
-- conocidos por los dos y los homónimos (García Gozalvez), y tildes
-- confirmadas en fuentes. El nombre completo pasa a "otherNames" y la clave
-- de identidad anterior queda como alias para que un volcado no recree la
-- ficha. Copia previa de las fichas y de las inscripciones afectadas en
-- private.normalize_morvedre_rider_names_20261004_backup
-- (rollback = restaurar desde ahí y borrar los alias con esta nota).

BEGIN;

CREATE TABLE private.normalize_morvedre_rider_names_20261004_backup (
  entity text NOT NULL CHECK (entity IN ('riders_men','startlist_riders')),
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  backed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, row_key)
);
ALTER TABLE private.normalize_morvedre_rider_names_20261004_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.normalize_morvedre_rider_names_20261004_backup
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE private.normalize_morvedre_rider_names_20261004_backup
  TO service_role;

CREATE TEMP TABLE _fichas (id text PRIMARY KEY, old_first text, old_last text,
  new_first text, new_last text, new_other text, old_key text) ON COMMIT DROP;
INSERT INTO _fichas VALUES
 ('arino-bolinches-gonzalo','Gonzalo','Ariño Bolinches','Gonzalo','Ariño','Gonzalo Ariño Bolinches','arino-bolinches-gonzalo'),
 ('curto-pellicer-edgar','Edgar','Curto Pellicer','Edgar','Curto','Edgar Curto Pellicer','curto-edgar-pellicer'),
 ('esparza-garin-unai','Unai','Esparza Garin','Unai','Esparza','Unai Esparza Garin','esparza-garin-unai'),
 ('garcia-navarro-oscar','Oscar','Garcia Navarro','Óscar','García','Óscar García Navarro','garcia-navarro-oscar'),
 ('soriano-garcia-iker','Iker','Soriano Garcia','Iker','Soriano','Iker Soriano García','garcia-iker-soriano'),
 ('garcia-pablo','Pablo','Garcia','Pablo','García','Pablo García Francés','garcia-pablo'),
 ('garcia-gozalvez-pablo','Pablo','Garcia Gozalvez','Pablo','García Gozalvez',NULL,'garcia-gozalvez-pablo'),
 ('martinez-garcia-victor','Victor','Martinez','Víctor','Martínez','Víctor Martínez García','martinez-victor'),
 ('gutierrez-ibanez-diego','Diego','Gutierrez','Diego','Gutiérrez','Diego Gutiérrez Ibáñez','diego-gutierrez'),
 ('martin-gotzon','Gotzon','Martin','Gotzon','Martín','Gotzon Martín Sanz','gotzon-martin');

DO $preflight$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM _fichas f JOIN public.riders_men r ON r.id = f.id
   WHERE r."firstName" = f.old_first AND r."lastName" = f.old_last
     AND r."identityKey" = f.old_key AND r.nationality = 'es';
  IF v_n <> 10 THEN
    RAISE EXCEPTION 'Fichas cambiadas desde la auditoría: % de 10', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.startlist_riders sr JOIN _fichas f ON f.id = sr."globalRiderId"
   WHERE sr."raceId" IN ('6e08f4f2-2d37-4093-9929-d1df1e82e627','FoJNjtj1ex8AemXhlGmo')
     AND sr."firstName" = f.old_first AND sr."lastName" = f.old_last;
  IF v_n <> 13 THEN
    RAISE EXCEPTION 'Inscripciones cambiadas desde la auditoría: % de 13', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rider_identity_aliases a JOIN _fichas f
              ON a."aliasKey" = f.old_key AND a.gender = 'male'
             WHERE f.old_key <> public.compute_identity_key(f.new_first, f.new_last)) THEN
    RAISE EXCEPTION 'Algún alias de clave anterior ya existe';
  END IF;
  IF EXISTS (SELECT 1 FROM public.riders_men r JOIN _fichas f
              ON r."identityKey" = public.compute_identity_key(f.new_first, f.new_last)
             WHERE r.id <> f.id) THEN
    RAISE EXCEPTION 'La clave de identidad nueva colisiona con otra ficha';
  END IF;
END
$preflight$;

INSERT INTO private.normalize_morvedre_rider_names_20261004_backup (entity, row_key, row_data)
SELECT 'riders_men', r.id, to_jsonb(r) FROM public.riders_men r JOIN _fichas f ON f.id = r.id;

INSERT INTO private.normalize_morvedre_rider_names_20261004_backup (entity, row_key, row_data)
SELECT 'startlist_riders', sr.id, to_jsonb(sr)
FROM public.startlist_riders sr JOIN _fichas f ON f.id = sr."globalRiderId"
WHERE sr."raceId" IN ('6e08f4f2-2d37-4093-9929-d1df1e82e627','FoJNjtj1ex8AemXhlGmo');

UPDATE public.riders_men r
SET "firstName" = f.new_first,
    "lastName" = f.new_last,
    "otherNames" = COALESCE(f.new_other, r."otherNames"),
    "updatedAt" = now()
FROM _fichas f WHERE r.id = f.id;

UPDATE public.startlist_riders sr
SET "firstName" = f.new_first, "lastName" = f.new_last
FROM _fichas f
WHERE f.id = sr."globalRiderId"
  AND sr."raceId" IN ('6e08f4f2-2d37-4093-9929-d1df1e82e627','FoJNjtj1ex8AemXhlGmo');

INSERT INTO public.rider_identity_aliases ("aliasKey", gender, "riderId", note)
SELECT f.old_key, 'male', f.id,
       'Morvedre 2026-10-04: nombre oficial largo -> nombre de uso (rename, misma ficha)'
FROM _fichas f JOIN public.riders_men r ON r.id = f.id
WHERE r."identityKey" <> f.old_key;

DO $verify$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM _fichas f JOIN public.riders_men r ON r.id = f.id
   WHERE r."firstName" = f.new_first AND r."lastName" = f.new_last;
  IF v_n <> 10 THEN RAISE EXCEPTION 'Fichas sin el nombre nuevo: %', 10 - v_n; END IF;

  SELECT count(*) INTO v_n FROM public.startlist_riders_resolved v JOIN _fichas f ON f.id = v."globalRiderId"
   WHERE v."raceId" IN ('6e08f4f2-2d37-4093-9929-d1df1e82e627','FoJNjtj1ex8AemXhlGmo')
     AND v."firstName" = f.new_first AND v."lastName" = f.new_last;
  IF v_n <> 13 THEN RAISE EXCEPTION 'Inscripciones resueltas sin el nombre nuevo: %', 13 - v_n; END IF;

  SELECT count(*) INTO v_n FROM public.rider_identity_aliases
   WHERE note = 'Morvedre 2026-10-04: nombre oficial largo -> nombre de uso (rename, misma ficha)';
  IF v_n <> 5 THEN RAISE EXCEPTION 'Alias creados: % de 5', v_n; END IF;

  SELECT count(*) INTO v_n FROM private.normalize_morvedre_rider_names_20261004_backup;
  IF v_n <> 23 THEN RAISE EXCEPTION 'Backup con % filas de 23', v_n; END IF;
END
$verify$;

COMMIT;
