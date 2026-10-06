-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260627152256, nombre rebuild_cn_linea_sub23_masc_2026_startlist_by_community). Texto aplicado en producción, sin cambios.

DO $$
DECLARE
  v_race text := '16cceff0-4caf-42a2-a7c8-b367a5c414bc';
  v_team text;
  r record;
  v_gid text;
BEGIN
  CREATE TEMP TABLE _old_links ON COMMIT DROP AS
  SELECT fold_name("lastName" || ' ' || "firstName") AS fk, "globalRiderId"
  FROM startlist_riders WHERE "raceId" = v_race;

  DELETE FROM startlist_riders WHERE "raceId" = v_race;
  DELETE FROM startlist_teams WHERE "raceId" = v_race;

  FOR r IN
    SELECT * FROM (VALUES
      (0,'Aragon',1,'Albelda Garcia','Ruben'),
      (0,'Aragon',2,'Castaño Carmona','Ismael'),
      (0,'Aragon',3,'Femenias Aguirre','Pablo'),
      (0,'Aragon',4,'Jaray Albericio','Pablo'),
      (0,'Aragon',5,'Riverola Badel','Luca'),
      (0,'Aragon',6,'Rubio Millan','Cesar'),
      (0,'Aragon',7,'Sanahuja Barriendos','Daniel'),
      (0,'Aragon',8,'Vaca Condoy','Andres Alejandro'),
      (1,'Andalucia',9,'Cordero Santos','Mario'),
      (1,'Andalucia',10,'Fernandez Marin','Francisco Jesus'),
      (1,'Andalucia',11,'Jimenez Blazquez','Jose Ramon'),
      (1,'Andalucia',12,'Loaisa Lopez','Ivan'),
      (1,'Andalucia',13,'Nieto Olmedilla','Daniel'),
      (1,'Andalucia',14,'Peñas Sanchez','Manuel'),
      (1,'Andalucia',15,'Recuerda Bueno','Manuel'),
      (1,'Andalucia',16,'Rodriguez Palacios','Manuel'),
      (2,'Cantabria',17,'Aguero Gonzalez','Alex'),
      (2,'Cantabria',18,'Cabo Martinez','Alvaro'),
      (2,'Cantabria',19,'Diaz Prado','Iker'),
      (2,'Cantabria',20,'Garcia Martin','Pablo'),
      (2,'Cantabria',21,'Stetsiv','Andrei'),
      (2,'Cantabria',22,'Velez Sanchez','Iker'),
      (2,'Cantabria',23,'Vian Lopez','Oscar'),
      (3,'Castilla y Leon',24,'Cuella Perez','Juan Maria'),
      (3,'Castilla y Leon',25,'Diez Lopez','Unai'),
      (3,'Castilla y Leon',26,'Dominguez Martin','Miguel'),
      (3,'Castilla y Leon',27,'Fuentes Paniego','Oscar'),
      (3,'Castilla y Leon',28,'Garcia Gomez','Emilio'),
      (3,'Castilla y Leon',29,'Hermosa Sanchez','Juan'),
      (3,'Castilla y Leon',30,'Martin Martin','Alvar'),
      (3,'Castilla y Leon',31,'Marugan Arnanz','Angel'),
      (3,'Castilla y Leon',32,'Sastre Jimenez','Yeray'),
      (4,'Castilla-La Mancha',33,'Fajardo Toledo','Alex'),
      (4,'Castilla-La Mancha',34,'Garcia Galan','Mario'),
      (4,'Castilla-La Mancha',35,'Garcia Galan','Ruben'),
      (4,'Castilla-La Mancha',36,'Lopez Garcia','Javier'),
      (4,'Castilla-La Mancha',37,'Moñino Rodriguez','Alberto'),
      (4,'Castilla-La Mancha',38,'Paredes Garrido','Alejandro'),
      (4,'Castilla-La Mancha',39,'Sanroma Arroyo','Manuel'),
      (5,'Catalunya',40,'Aguilera Jorba','Nil'),
      (5,'Catalunya',41,'Cadena Subirana','Joan'),
      (5,'Catalunya',42,'Collell Vallelado','Marc'),
      (5,'Catalunya',43,'Diaz Ibañez','Joel'),
      (5,'Catalunya',44,'Figuls Sellares','Jaume'),
      (5,'Catalunya',45,'Gozalbo Farre','Marti'),
      (5,'Catalunya',46,'Olvera Reyes','Lucas'),
      (5,'Catalunya',47,'Roca Trias','Albert'),
      (5,'Catalunya',48,'Rubirola Vila','Marc'),
      (5,'Catalunya',49,'Viladrich Anguera','Ivan'),
      (6,'Comunidad de Madrid',50,'Anguela Yaguez','Mario'),
      (6,'Comunidad de Madrid',51,'Fajardo Perez','Samuel'),
      (6,'Comunidad de Madrid',52,'Garcia Guell','Victor'),
      (6,'Comunidad de Madrid',53,'Ortega Sanz','Pablo'),
      (6,'Comunidad de Madrid',54,'Pradas Blanco','Hugo'),
      (6,'Comunidad de Madrid',55,'Quevedo Lopez','Sergio'),
      (7,'Comunitat Valenciana',56,'Calabuig Vazquez','Estanislao'),
      (7,'Comunitat Valenciana',57,'Cepa Server','Daniel'),
      (7,'Comunitat Valenciana',58,'Domens Peña','Alberto'),
      (7,'Comunitat Valenciana',59,'Garzelli Benimeli','Luca'),
      (7,'Comunitat Valenciana',60,'Gutierrez Mercader','Iban'),
      (7,'Comunitat Valenciana',61,'Llopis Giner','Emilio'),
      (7,'Comunitat Valenciana',62,'Mestre Ginestar','Xavi'),
      (7,'Comunitat Valenciana',63,'Monroig Gimeno','Izan'),
      (7,'Comunitat Valenciana',64,'Sansano Cespedes','Alvaro'),
      (7,'Comunitat Valenciana',65,'Zaragoza Pascual','Vicent'),
      (8,'Euskadi',66,'Alarcia Quintano','Aimar'),
      (8,'Euskadi',67,'Conejero Laconcha','Jon'),
      (8,'Euskadi',68,'Errasti Urteaga','Unax'),
      (8,'Euskadi',69,'Fernandez de Gorostiza Mitxelena','Aimar'),
      (8,'Euskadi',70,'Ibañez Beltran de Salazar','Gabriel'),
      (8,'Euskadi',71,'Iriarte Sanz','Igor'),
      (8,'Euskadi',72,'Martin Cuevas','Marco'),
      (8,'Euskadi',73,'Olabe Cierbide','Markel'),
      (8,'Euskadi',74,'Otegi Ariztimuño','Ander'),
      (8,'Euskadi',75,'Vidal Mendia','Urko'),
      (9,'Extremadura',76,'Antunez Romero','Pablo'),
      (9,'Extremadura',77,'Bermejo Cobos','Mario'),
      (9,'Extremadura',78,'Leno Rodriguez','Pablo'),
      (9,'Extremadura',79,'Martin Gamonales','Raul'),
      (9,'Extremadura',80,'Martin San Facundo','Iker'),
      (9,'Extremadura',81,'Monge Rubio','Miguel'),
      (9,'Extremadura',82,'Perez Lebrato','Gonzalo'),
      (9,'Extremadura',83,'Perez Lucas','Iker'),
      (10,'Galicia',84,'Garcia Neira','Hector'),
      (10,'Galicia',85,'Lorenzo Gonzalez','Aron'),
      (10,'Galicia',86,'Perez Cuña','Jorge'),
      (10,'Galicia',87,'Puentes Jorge','Ivan'),
      (10,'Galicia',88,'Vieito Fernandez','Daniel'),
      (11,'Illes Balears',89,'Barcelo Gascon','Jaume'),
      (11,'Illes Balears',90,'Crespi Ros','Francisco'),
      (11,'Illes Balears',91,'Dols Lorenzo','Lluc'),
      (11,'Illes Balears',92,'Gamundi Adrover','Joan'),
      (11,'Illes Balears',93,'Gonzalez Estevez','Daniel'),
      (11,'Illes Balears',94,'Mir Recio','Marti'),
      (12,'Islas Canarias',95,'Gonzalez Cabrera','Alberto'),
      (12,'Islas Canarias',96,'Lado de la Nuez','Daniel'),
      (12,'Islas Canarias',97,'Perez Melian','Alberto'),
      (12,'Islas Canarias',98,'Suarez Medina','Jose Carlos'),
      (13,'La Rioja',99,'Pascual Galdamez','Javier'),
      (14,'Navarra',100,'Atondo Elgorriaga','Mikel Arriet'),
      (14,'Navarra',101,'Buteau Enecoiz','Unai'),
      (14,'Navarra',102,'Dorronsoro Iparragirre','Ioritz'),
      (14,'Navarra',103,'Egurza Martinez de Morentin','Adrian'),
      (14,'Navarra',104,'Imaz Perez','Ekain'),
      (14,'Navarra',105,'Lacasta Balda','Aimar'),
      (14,'Navarra',106,'Lopez Rey','Iñaki'),
      (14,'Navarra',107,'Morras Huerta','Ekai'),
      (14,'Navarra',108,'Tadeo Arcauz','Aimar'),
      (14,'Navarra',109,'Uncilla Aldasoro','Mikel'),
      (15,'Principado de Asturias',110,'Arboleya del Valle','Canor'),
      (15,'Principado de Asturias',111,'Giles Moscatelli','Valentino'),
      (15,'Principado de Asturias',112,'Gutierrez Gonzalez','Raul'),
      (15,'Principado de Asturias',113,'Menendez Menendez','Pelayo'),
      (15,'Principado de Asturias',114,'Osorio Robledo','Pablo'),
      (15,'Principado de Asturias',115,'Rodriguez Navarro','Arbas'),
      (16,'Region de Murcia',116,'Abril Michilot','Alejandro'),
      (16,'Region de Murcia',117,'Caballero Sanchez','Elias'),
      (16,'Region de Murcia',118,'Diaz Tomas','Dario'),
      (16,'Region de Murcia',119,'Garcia Tomas','Pedro'),
      (16,'Region de Murcia',120,'Gonzalez Guerrero','Jose Antonio'),
      (16,'Region de Murcia',121,'Lajarin Rojas','Luis Alberto'),
      (16,'Region de Murcia',123,'Pina Perez','Jose Maria'),
      (16,'Region de Murcia',124,'Rodriguez Andreo','Alexis'),
      (17,'Andorra',125,'Fuentes Caporali','Enzo'),
      (17,'Andorra',126,'Mora Viudez','Gerard'),
      (17,'Andorra',127,'Naudi Rubio','Miquel'),
      (17,'Andorra',128,'Regada Hierro','Adria')
    ) AS t(grp, community, dorsal, last, first)
    ORDER BY grp, dorsal
  LOOP
    SELECT id INTO v_team FROM startlist_teams
      WHERE "raceId" = v_race AND "teamName" = r.community;
    IF v_team IS NULL THEN
      v_team := gen_random_uuid()::text;
      INSERT INTO startlist_teams (id, "raceId", "teamName", "sortOrder", "teamId", "isDev", "isConfirmed", "createdAt")
      VALUES (v_team, v_race, r.community, r.grp, NULL, false, true, now());
    END IF;

    SELECT "globalRiderId" INTO v_gid FROM _old_links
      WHERE fk = fold_name(r.last || ' ' || r.first) LIMIT 1;

    INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName", "countryCode", "globalRiderId", "createdAt")
    VALUES (gen_random_uuid()::text, v_team, v_race, r.dorsal, r.first, r.last, 'es', v_gid, now());
  END LOOP;
END $$;
