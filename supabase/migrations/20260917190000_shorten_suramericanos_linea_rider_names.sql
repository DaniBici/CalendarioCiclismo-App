-- Reduce el nombre de uso de los inscritos en las pruebas en línea de los
-- Juegos Suramericanos Santa Fe 2026 a un solo nombre + un solo apellido,
-- trasladando el nombre completo a "otherNames" (que se conserva si ya era
-- más completo). Copia previa de las 42 fichas tocadas en
-- private.normalize_rider_names_20260917b_backup (rollback desde ahí).
BEGIN;

CREATE TABLE private.normalize_rider_names_20260917b_backup (
  gender text NOT NULL CHECK (gender IN ('male','female')),
  id text NOT NULL,
  row_data jsonb NOT NULL,
  backed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gender, id)
);
ALTER TABLE private.normalize_rider_names_20260917b_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.normalize_rider_names_20260917b_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.normalize_rider_names_20260917b_backup TO service_role;

INSERT INTO private.normalize_rider_names_20260917b_backup(gender, id, row_data)
SELECT 'male', r.id, to_jsonb(r) FROM public.riders_men r WHERE r.id IN (
 'ambrossi-ramos-facundo-nicolas','cobarrubia-lucero-leonardo-franco','moyano-tomas-eloy',
 'tivani-gerardo-matias','ferrufino-montano-kenny-erick','rojas-almanza-david','de-jesus-mendes-diego',
 'marques-ferreira-silva-lucca','reikdal-stachera-samuel-hauane','rojas-rivas-diego',
 'arango-carvajal-juan-esteban','arboleda-ruiz-anderson','parra-arias-jordan-arley','lorenzo-randish-abdul',
 'acuna-sanchez-carlos','alfonso-florentin-antonio','dominguez-silva-carlos-vidal',
 'monges-gonzalez-jonathan-daniel','riveros-diarte-francisco-daniel','gamero-zuniga-alonso-miguel',
 'gonzalez-zenteno-andre-alexander','quispe-colque-alain-rossbel','ruiz-calle-hugo-nestor-emiliano',
 'ruiz-calle-robinson-steven','pena-gonzalez-miguel-javier');

INSERT INTO private.normalize_rider_names_20260917b_backup(gender, id, row_data)
SELECT 'female', r.id, to_jsonb(r) FROM public.riders_women r WHERE r.id IN (
 'aguirre-mangue-maribel-roxana-2','vasquez-avila-elizabeth','barbosa-alves-do-nascimento-carolina',
 'borges-nicolle-wendy','leite-de-melo-alice-tamirys','leozzi-cabeca-livia','radatz-tamires-fanny',
 'castano-quintero-elizabeth','torres-ana-maria','espinola-salinas-agua-marina','huamani-quispe-alejandra',
 'lewis-hassinger-flor-de-mercedes','quispe-figueroa-kaori','rojas-barrueto-mariana','torrico-sara-nicole',
 'candelas-sanabria-fabiana-katherine','zambrano-olarte-shantal-anabella');

UPDATE public.riders_men SET "firstName"='Facundo', "lastName"='Ambrossi', "otherNames"='Facundo Nicolás Ambrossi Ramos' WHERE id='ambrossi-ramos-facundo-nicolas';
UPDATE public.riders_men SET "firstName"='Leonardo', "lastName"='Cobarrubia', "otherNames"='Leonardo Franco Cobarrubia Lucero' WHERE id='cobarrubia-lucero-leonardo-franco';
UPDATE public.riders_men SET "firstName"='Tomás', "otherNames"='Tomás Eloy Moyano' WHERE id='moyano-tomas-eloy';
UPDATE public.riders_men SET "firstName"='Gerardo', "otherNames"='Gerardo Matías Tivani' WHERE id='tivani-gerardo-matias';
UPDATE public.riders_men SET "firstName"='Kenny', "lastName"='Ferrufino', "otherNames"='Kenny Erick Ferrufino Montaño' WHERE id='ferrufino-montano-kenny-erick';
UPDATE public.riders_men SET "lastName"='Rojas', "otherNames"='David Rojas Almanza' WHERE id='rojas-almanza-david';
UPDATE public.riders_men SET "lastName"='de Jesus', "otherNames"='Diego de Jesus Mendes' WHERE id='de-jesus-mendes-diego';
UPDATE public.riders_men SET "lastName"='Marques', "otherNames"='Lucca Marques Ferreira Silva' WHERE id='marques-ferreira-silva-lucca';
UPDATE public.riders_men SET "firstName"='Samuel', "lastName"='Reikdal', "otherNames"='Samuel Hauane Reikdal Stachera' WHERE id='reikdal-stachera-samuel-hauane';
UPDATE public.riders_men SET "lastName"='Rojas', "otherNames"='Diego Rojas Rivas' WHERE id='rojas-rivas-diego';
UPDATE public.riders_men SET "firstName"='Juan', "lastName"='Arango', "otherNames"='Juan Esteban Arango Carvajal' WHERE id='arango-carvajal-juan-esteban';
UPDATE public.riders_men SET "lastName"='Arboleda', "otherNames"='Anderson Arboleda Ruiz' WHERE id='arboleda-ruiz-anderson';
UPDATE public.riders_men SET "firstName"='Jordan', "lastName"='Parra', "otherNames"='Jordan Arley Parra Arias' WHERE id='parra-arias-jordan-arley';
UPDATE public.riders_men SET "firstName"='Randish', "otherNames"='Randish Abdul Lorenzo' WHERE id='lorenzo-randish-abdul';
UPDATE public.riders_men SET "lastName"='Acuña', "otherNames"='Carlos Acuña Sánchez' WHERE id='acuna-sanchez-carlos';
UPDATE public.riders_men SET "lastName"='Alfonso', "otherNames"='Antonio Alfonso Florentín' WHERE id='alfonso-florentin-antonio';
UPDATE public.riders_men SET "firstName"='Carlos', "lastName"='Domínguez', "otherNames"='Carlos Vidal Domínguez Silva' WHERE id='dominguez-silva-carlos-vidal';
UPDATE public.riders_men SET "firstName"='Jonathan', "lastName"='Monges', "otherNames"='Jonathan Daniel Monges González' WHERE id='monges-gonzalez-jonathan-daniel';
UPDATE public.riders_men SET "firstName"='Francisco', "lastName"='Riveros', "otherNames"='Francisco Daniel Riveros Diarte' WHERE id='riveros-diarte-francisco-daniel';
UPDATE public.riders_men SET "firstName"='Alonso', "lastName"='Gamero', "otherNames"='Alonso Miguel Gamero Zúñiga' WHERE id='gamero-zuniga-alonso-miguel';
UPDATE public.riders_men SET "firstName"='André', "lastName"='González', "otherNames"='André Alexander González Zenteno' WHERE id='gonzalez-zenteno-andre-alexander';
UPDATE public.riders_men SET "firstName"='Alaín', "lastName"='Quispe', "otherNames"='Alaín Rossbel Quispe Colque' WHERE id='quispe-colque-alain-rossbel';
UPDATE public.riders_men SET "firstName"='Hugo', "lastName"='Ruiz', "otherNames"='Hugo Néstor Emiliano Ruiz Calle' WHERE id='ruiz-calle-hugo-nestor-emiliano';
UPDATE public.riders_men SET "firstName"='Robinson', "lastName"='Ruiz', "otherNames"='Robinson Steven Ruiz Calle' WHERE id='ruiz-calle-robinson-steven';
UPDATE public.riders_men SET "firstName"='Miguel' WHERE id='pena-gonzalez-miguel-javier';

UPDATE public.riders_women SET "firstName"='Maribel', "lastName"='Aguirre', "otherNames"='Maribel Roxana Aguirre Mangue' WHERE id='aguirre-mangue-maribel-roxana-2';
UPDATE public.riders_women SET "lastName"='Vásquez', "otherNames"='Elizabeth Vásquez Ávila' WHERE id='vasquez-avila-elizabeth';
UPDATE public.riders_women SET "lastName"='Barbosa', "otherNames"='Carolina Barbosa Alves do Nascimento' WHERE id='barbosa-alves-do-nascimento-carolina';
UPDATE public.riders_women SET "firstName"='Nicolle', "otherNames"='Nicolle Wendy Borges' WHERE id='borges-nicolle-wendy';
UPDATE public.riders_women SET "firstName"='Alice', "lastName"='Leite', "otherNames"='Alice Tamirys Leite de Melo' WHERE id='leite-de-melo-alice-tamirys';
UPDATE public.riders_women SET "lastName"='Leozzi', "otherNames"='Lívia Leozzi Cabeça' WHERE id='leozzi-cabeca-livia';
UPDATE public.riders_women SET "firstName"='Tamires', "otherNames"='Tamires Fanny Radatz' WHERE id='radatz-tamires-fanny';
UPDATE public.riders_women SET "lastName"='Castaño', "otherNames"='Elizabeth Castaño Quintero' WHERE id='castano-quintero-elizabeth';
UPDATE public.riders_women SET "firstName"='Ana', "otherNames"='Ana María Torres' WHERE id='torres-ana-maria';
UPDATE public.riders_women SET "firstName"='Agua', "otherNames"='Agua Marina Espínola Salinas' WHERE id='espinola-salinas-agua-marina';
UPDATE public.riders_women SET "lastName"='Huamaní', "otherNames"='Alejandra Janet Huamaní Quispe' WHERE id='huamani-quispe-alejandra';
UPDATE public.riders_women SET "firstName"='Flor', "lastName"='Lewis', "otherNames"='Flor De Mercedes Lewis Hassinger' WHERE id='lewis-hassinger-flor-de-mercedes';
UPDATE public.riders_women SET "lastName"='Quispe', "otherNames"='Kaori Quispe Figueroa' WHERE id='quispe-figueroa-kaori';
UPDATE public.riders_women SET "lastName"='Rojas', "otherNames"='Mariana Rojas Barrueto' WHERE id='rojas-barrueto-mariana';
UPDATE public.riders_women SET "firstName"='Sara' WHERE id='torrico-sara-nicole';
UPDATE public.riders_women SET "firstName"='Fabiana' WHERE id='candelas-sanabria-fabiana-katherine';
UPDATE public.riders_women SET "firstName"='Shantal' WHERE id='zambrano-olarte-shantal-anabella';

COMMIT;
