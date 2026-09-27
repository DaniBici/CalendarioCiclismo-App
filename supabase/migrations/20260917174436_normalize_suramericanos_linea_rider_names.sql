-- Normaliza nombre y apellidos (diacríticos y mayúsculas) de los corredores
-- inscritos en las pruebas en línea de los Juegos Suramericanos Santa Fe 2026
-- (línea masculino 7d617eeb, línea femenino e61f9e21) y mueve el nombre completo
-- a "otherNames" cuando la ficha guardaba solo el primer nombre/apellido.
-- Copia previa de las 33 fichas afectadas en
-- private.normalize_rider_names_20260917_backup (rollback = restaurar desde ahí).
BEGIN;

CREATE TABLE private.normalize_rider_names_20260917_backup (
  gender text NOT NULL CHECK (gender IN ('male','female')),
  id text NOT NULL,
  row_data jsonb NOT NULL,
  backed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gender, id)
);
ALTER TABLE private.normalize_rider_names_20260917_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.normalize_rider_names_20260917_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.normalize_rider_names_20260917_backup TO service_role;

INSERT INTO private.normalize_rider_names_20260917_backup(gender, id, row_data)
SELECT 'male', r.id, to_jsonb(r) FROM public.riders_men r WHERE r.id IN (
 'ambrossi-ramos-facundo-nicolas','contte-tomas','moyano-tomas-eloy','tivani-gerardo-matias',
 'gonzeli-otavio','acuna-sanchez-carlos','alfonso-florentin-antonio','monges-gonzalez-jonathan-daniel',
 'ruiz-calle-hugo-nestor-emiliano','duque-mateo','rossi-joao-pedro','baeza-cristobal','kotsakis-francisco',
 'quintana-hector','quiroz-tomas','strah-mendez-alex','silva-thomas','perez-ciro','linarez-leangel',
 'navas-paredes-elian-kevin','guama-bayron');

INSERT INTO private.normalize_rider_names_20260917_backup(gender, id, row_data)
SELECT 'female', r.id, to_jsonb(r) FROM public.riders_women r WHERE r.id IN (
 'martelli-sofia','torres-ana-maria','garcia-mariana','abreu-alvarado-veronica','vasquez-avila-elizabeth',
 'huamani-quispe-alejandra','leozzi-cabeca-livia','monsalvez-florencia','espinola-salinas-agua-marina',
 'gonzalez-yarela','silva-paola','wynants-luciana');

UPDATE public.riders_men SET "firstName"='Facundo Nicolás' WHERE id='ambrossi-ramos-facundo-nicolas';
UPDATE public.riders_men SET "firstName"='Tomás' WHERE id='contte-tomas';
UPDATE public.riders_men SET "firstName"='Tomás Eloy' WHERE id='moyano-tomas-eloy';
UPDATE public.riders_men SET "firstName"='Gerardo Matías' WHERE id='tivani-gerardo-matias';
UPDATE public.riders_men SET "firstName"='Otávio', "otherNames"='Otávio Augusto Gonzeli' WHERE id='gonzeli-otavio';
UPDATE public.riders_men SET "lastName"='Acuña Sánchez' WHERE id='acuna-sanchez-carlos';
UPDATE public.riders_men SET "lastName"='Alfonso Florentín' WHERE id='alfonso-florentin-antonio';
UPDATE public.riders_men SET "lastName"='Monges González' WHERE id='monges-gonzalez-jonathan-daniel';
UPDATE public.riders_men SET "firstName"='Hugo Néstor Emiliano' WHERE id='ruiz-calle-hugo-nestor-emiliano';
UPDATE public.riders_men SET "otherNames"='Mateo Duque Cano' WHERE id='duque-mateo';
UPDATE public.riders_men SET "otherNames"='João Pedro Rossi' WHERE id='rossi-joao-pedro';
UPDATE public.riders_men SET "otherNames"='Cristóbal Baeza Muñoz' WHERE id='baeza-cristobal';
UPDATE public.riders_men SET "otherNames"='Francisco Kotsakis Lagos' WHERE id='kotsakis-francisco';
UPDATE public.riders_men SET "otherNames"='Héctor Exequiel Quintana Vidal' WHERE id='quintana-hector';
UPDATE public.riders_men SET "otherNames"='Tomás Quiroz Martínez' WHERE id='quiroz-tomas';
UPDATE public.riders_men SET "otherNames"='Alex Strah Méndez' WHERE id='strah-mendez-alex';
UPDATE public.riders_men SET "otherNames"='Guillermo Thomas Silva Coussan' WHERE id='silva-thomas';
UPDATE public.riders_men SET "otherNames"='Ciro Pérez Álvarez' WHERE id='perez-ciro';
UPDATE public.riders_men SET "otherNames"='Leangel Rubén Linarez Meneses' WHERE id='linarez-leangel';
UPDATE public.riders_men SET "otherNames"='Elian Kevin Navas Paredes' WHERE id='navas-paredes-elian-kevin';
UPDATE public.riders_men SET "otherNames"='Byron Patricio Guamá de la Cruz' WHERE id='guama-bayron';

UPDATE public.riders_women SET "firstName"='Sofía' WHERE id='martelli-sofia';
UPDATE public.riders_women SET "firstName"='Ana María' WHERE id='torres-ana-maria';
UPDATE public.riders_women SET "lastName"='García' WHERE id='garcia-mariana';
UPDATE public.riders_women SET "firstName"='Verónica', "otherNames"='Verónica Abreu Alvarado' WHERE id='abreu-alvarado-veronica';
UPDATE public.riders_women SET "lastName"='Vásquez Ávila' WHERE id='vasquez-avila-elizabeth';
UPDATE public.riders_women SET "lastName"='Huamaní Quispe' WHERE id='huamani-quispe-alejandra';
UPDATE public.riders_women SET "firstName"='Lívia', "lastName"='Leozzi Cabeça' WHERE id='leozzi-cabeca-livia';
UPDATE public.riders_women SET "otherNames"='Florencia Monsálvez Rojo' WHERE id='monsalvez-florencia';
UPDATE public.riders_women SET "otherNames"='Agua Marina Espínola Salinas' WHERE id='espinola-salinas-agua-marina';
UPDATE public.riders_women SET "otherNames"='Yarela González Obando' WHERE id='gonzalez-yarela';
UPDATE public.riders_women SET "otherNames"='Paola Silva Wynants' WHERE id='silva-paola';
UPDATE public.riders_women SET "otherNames"='Luciana Wynants Castrillón' WHERE id='wynants-luciana';

COMMIT;
