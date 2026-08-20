-- ═══════════════════════════════════════════════════════════════════
--  SEED: Inscritos Itzulia Basque Country 2026
--  Ejecutar DESPUÉS de 006_startlists.sql
--  Resuelve el raceId automáticamente desde el slug.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  rid TEXT;
BEGIN
  SELECT id INTO rid FROM races WHERE slug = 'itzulia-basque-country-2026';
  IF rid IS NULL THEN
    RAISE EXCEPTION 'No se encontró la carrera con slug itzulia-basque-country-2026';
  END IF;

  -- Limpiar datos previos
  DELETE FROM startlist_riders WHERE "raceId" = rid;
  DELETE FROM startlist_teams  WHERE "raceId" = rid;

  -- ── Equipos ────────────────────────────────────────────────────
  INSERT INTO startlist_teams (id, "raceId", "teamName", "sortOrder") VALUES
    ('sl_itz26_0',  rid, 'Soudal Quick-Step', 0),
    ('sl_itz26_1',  rid, 'XDS Astana Team', 1),
    ('sl_itz26_2',  rid, 'Groupama-FDJ United', 2),
    ('sl_itz26_3',  rid, 'UAE Team Emirates KRG', 3),
    ('sl_itz26_4',  rid, 'Lidl-Trek', 4),
    ('sl_itz26_5',  rid, 'Red Bull-Bora-Hansgrohe', 5),
    ('sl_itz26_6',  rid, 'Decathlon AG2R La Mondiale Team', 6),
    ('sl_itz26_7',  rid, 'Burgos-BurPellet', 7),
    ('sl_itz26_8',  rid, 'Equipo Kern Pharma', 8),
    ('sl_itz26_9',  rid, 'Movistar Team', 9),
    ('sl_itz26_10', rid, 'Team Picnic PostNL', 10),
    ('sl_itz26_11', rid, 'Bahrain Victorious', 11),
    ('sl_itz26_12', rid, 'Alpecin-Deceuninck', 12),
    ('sl_itz26_13', rid, 'Lotto Intermarché', 13),
    ('sl_itz26_14', rid, 'Cofidis', 14),
    ('sl_itz26_15', rid, 'Caja Rural-Seguros RGA', 15),
    ('sl_itz26_16', rid, 'Euskaltel-Euskadi', 16),
    ('sl_itz26_17', rid, 'EF Education-EasyPost', 17),
    ('sl_itz26_18', rid, 'INEOS Grenadiers', 18),
    ('sl_itz26_19', rid, 'Team Visma-Lease a Bike', 19),
    ('sl_itz26_20', rid, 'Uno-X Mobility', 20),
    ('sl_itz26_21', rid, 'Lotto Intermarché (continuación)', 21);

  -- ── Corredores ─────────────────────────────────────────────────

  -- Soudal Quick-Step
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_0_0', 'sl_itz26_0', rid, 1, 'Mikel', 'Landa Meana'),
    ('sl_itz26_0_1', 'sl_itz26_0', rid, 2, 'Ayco', 'Bastiaens'),
    ('sl_itz26_0_2', 'sl_itz26_0', rid, 3, 'Steff', 'Cras'),
    ('sl_itz26_0_3', 'sl_itz26_0', rid, 4, 'Mauri', 'Vansevenant'),
    ('sl_itz26_0_4', 'sl_itz26_0', rid, 5, 'Martin', 'Svrček'),
    ('sl_itz26_0_5', 'sl_itz26_0', rid, 6, 'Ilan', 'Van Wilder'),
    ('sl_itz26_0_6', 'sl_itz26_0', rid, 7, 'Ethan Edward', 'Hayter');

  -- XDS Astana Team
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_1_0', 'sl_itz26_1', rid, 11, 'Clément', 'Champoussin'),
    ('sl_itz26_1_1', 'sl_itz26_1', rid, 12, 'Lorenzo', 'Fortunato'),
    ('sl_itz26_1_2', 'sl_itz26_1', rid, 13, 'Sergio Andrés', 'Higuita García'),
    ('sl_itz26_1_3', 'sl_itz26_1', rid, 14, 'Harold Alfonso', 'Tejada Canacue'),
    ('sl_itz26_1_4', 'sl_itz26_1', rid, 15, 'Nicola', 'Conci'),
    ('sl_itz26_1_5', 'sl_itz26_1', rid, 16, 'Christian', 'Scaroni'),
    ('sl_itz26_1_6', 'sl_itz26_1', rid, 17, 'Simone', 'Velasco');

  -- Groupama-FDJ United
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_2_0', 'sl_itz26_2', rid, 21, 'Guillaume', 'Martin Guyonnet'),
    ('sl_itz26_2_1', 'sl_itz26_2', rid, 22, 'Clément', 'Braz Afonso'),
    ('sl_itz26_2_2', 'sl_itz26_2', rid, 23, 'Maxime', 'Decomble'),
    ('sl_itz26_2_3', 'sl_itz26_2', rid, 24, 'Kévin', 'Geniets'),
    ('sl_itz26_2_4', 'sl_itz26_2', rid, 25, 'Quentin', 'Pacher'),
    ('sl_itz26_2_5', 'sl_itz26_2', rid, 26, 'Enzo', 'Paleni'),
    ('sl_itz26_2_6', 'sl_itz26_2', rid, 27, 'Rémy', 'Rochas');

  -- UAE Team Emirates KRG
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_3_0', 'sl_itz26_3', rid, 31, 'Isaac', 'Del Toro Romero'),
    ('sl_itz26_3_1', 'sl_itz26_3', rid, 32, 'Brandon', 'McNulty'),
    ('sl_itz26_3_2', 'sl_itz26_3', rid, 33, 'Igor', 'Arrieta Lizarraga'),
    ('sl_itz26_3_3', 'sl_itz26_3', rid, 34, 'Felix', 'Grossschartner'),
    ('sl_itz26_3_4', 'sl_itz26_3', rid, 35, 'Domen', 'Novak'),
    ('sl_itz26_3_5', 'sl_itz26_3', rid, 36, 'Adrià', 'Pericas Capdevila'),
    ('sl_itz26_3_6', 'sl_itz26_3', rid, 37, 'Marc', 'Soler');

  -- Lidl-Trek
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_4_0', 'sl_itz26_4', rid, 41, 'Juan', 'Ayuso Pesquera'),
    ('sl_itz26_4_1', 'sl_itz26_4', rid, 42, 'Bauke', 'Mollema'),
    ('sl_itz26_4_2', 'sl_itz26_4', rid, 43, 'Andrea', 'Bagioli'),
    ('sl_itz26_4_3', 'sl_itz26_4', rid, 44, 'Julien', 'Bernard'),
    ('sl_itz26_4_4', 'sl_itz26_4', rid, 45, 'Carlos', 'Verona Quintanilla'),
    ('sl_itz26_4_5', 'sl_itz26_4', rid, 46, 'Mattias', 'Skjelmose'),
    ('sl_itz26_4_6', 'sl_itz26_4', rid, 47, 'Quinn', 'Simmons');

  -- Red Bull-Bora-Hansgrohe
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_5_0', 'sl_itz26_5', rid, 51, 'Juan', 'Rodas'),
    ('sl_itz26_5_1', 'sl_itz26_5', rid, 52, 'Hélios', 'Etxeberria Ansalas'),
    ('sl_itz26_5_2', 'sl_itz26_5', rid, 53, 'Florian', 'Lipowitz'),
    ('sl_itz26_5_3', 'sl_itz26_5', rid, 54, 'Finn Lachlan', 'Fisher-Black'),
    ('sl_itz26_5_4', 'sl_itz26_5', rid, 55, 'Gianni', 'Moscon'),
    ('sl_itz26_5_5', 'sl_itz26_5', rid, 56, 'Luke', 'Tuckwell'),
    ('sl_itz26_5_6', 'sl_itz26_5', rid, 57, 'Emil', 'Herzog');

  -- Decathlon AG2R La Mondiale Team
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_6_0', 'sl_itz26_6', rid, 61, 'Paul', 'Seixas'),
    ('sl_itz26_6_1', 'sl_itz26_6', rid, 62, 'Matthew', 'Riccitello'),
    ('sl_itz26_6_2', 'sl_itz26_6', rid, 63, 'Lee', 'Bisalke'),
    ('sl_itz26_6_3', 'sl_itz26_6', rid, 64, 'Jordan', 'Labrosse'),
    ('sl_itz26_6_4', 'sl_itz26_6', rid, 65, 'Nicolas', 'Prodhomme'),
    ('sl_itz26_6_5', 'sl_itz26_6', rid, 66, 'Johannes', 'Staune-Mittet'),
    ('sl_itz26_6_6', 'sl_itz26_6', rid, 67, 'Aurélien', 'Paret Peintre');

  -- Burgos-BurPellet
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_7_0', 'sl_itz26_7', rid, 71, 'Ander', 'Okamika Bengoetxea'),
    ('sl_itz26_7_1', 'sl_itz26_7', rid, 72, 'Lorenzo', 'Quartucci'),
    ('sl_itz26_7_2', 'sl_itz26_7', rid, 73, 'José Luis', 'Faura Asensio'),
    ('sl_itz26_7_3', 'sl_itz26_7', rid, 74, 'Jordán', 'Fernández Rodríguez'),
    ('sl_itz26_7_4', 'sl_itz26_7', rid, 75, 'Carlos', 'García Pierna'),
    ('sl_itz26_7_5', 'sl_itz26_7', rid, 76, 'José Manuel', 'Díaz Gallego'),
    ('sl_itz26_7_6', 'sl_itz26_7', rid, 77, 'Aurelio', 'Marolo Toledo');

  -- Equipo Kern Pharma
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_8_0', 'sl_itz26_8', rid, 81, 'Iñigo', 'Elosegui Momeñe'),
    ('sl_itz26_8_1', 'sl_itz26_8', rid, 82, 'Iván', 'Cobo Cayon'),
    ('sl_itz26_8_2', 'sl_itz26_8', rid, 83, 'Nil', 'Gimeno Ferré'),
    ('sl_itz26_8_3', 'sl_itz26_8', rid, 84, 'Unai', 'Iribar Jauregi'),
    ('sl_itz26_8_4', 'sl_itz26_8', rid, 85, 'José', 'Ramos Muñoz'),
    ('sl_itz26_8_5', 'sl_itz26_8', rid, 86, 'Jorge', 'Gutiérrez González'),
    ('sl_itz26_8_6', 'sl_itz26_8', rid, 87, 'Ibón', 'Ruiz Sedano');

  -- Movistar Team
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_9_0', 'sl_itz26_9', rid, 91, 'Cian', 'Uijtdebroeks'),
    ('sl_itz26_9_1', 'sl_itz26_9', rid, 92, 'Jorge', 'Arcas'),
    ('sl_itz26_9_2', 'sl_itz26_9', rid, 93, 'Juan Pedro', 'López Pérez'),
    ('sl_itz26_9_3', 'sl_itz26_9', rid, 94, 'Raúl', 'García Pierna'),
    ('sl_itz26_9_4', 'sl_itz26_9', rid, 95, 'Manuel', 'Peñalver'),
    ('sl_itz26_9_5', 'sl_itz26_9', rid, 96, 'Roger', 'Adrià Oliveres'),
    ('sl_itz26_9_6', 'sl_itz26_9', rid, 97, 'Javier', 'Romo Oliver');

  -- Team Picnic PostNL
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_10_0', 'sl_itz26_10', rid, 101, 'Frank', 'Van Den Broek'),
    ('sl_itz26_10_1', 'sl_itz26_10', rid, 102, 'Matthew', 'Dinham'),
    ('sl_itz26_10_2', 'sl_itz26_10', rid, 103, 'Alexey', 'Faure Prost'),
    ('sl_itz26_10_3', 'sl_itz26_10', rid, 104, 'James', 'Knox'),
    ('sl_itz26_10_4', 'sl_itz26_10', rid, 105, 'Bjoern', 'Korff'),
    ('sl_itz26_10_5', 'sl_itz26_10', rid, 106, 'Guillermo Juan', 'Martínez'),
    ('sl_itz26_10_6', 'sl_itz26_10', rid, 107, 'Mattia', 'Gaffuri');

  -- Bahrain Victorious
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_11_0', 'sl_itz26_11', rid, 111, 'Pello', 'Bilbao López de Armentia'),
    ('sl_itz26_11_1', 'sl_itz26_11', rid, 112, 'Aus', 'Hindermann'),
    ('sl_itz26_11_2', 'sl_itz26_11', rid, 113, 'Rainer', 'Kepplinger'),
    ('sl_itz26_11_3', 'sl_itz26_11', rid, 114, 'Alberto', 'Bruttomesso'),
    ('sl_itz26_11_4', 'sl_itz26_11', rid, 115, 'Thomas Oliver', 'Stockwell'),
    ('sl_itz26_11_5', 'sl_itz26_11', rid, 116, 'Antonio', 'Tiberi'),
    ('sl_itz26_11_6', 'sl_itz26_11', rid, 117, 'Attila', 'Valter');

  -- Alpecin-Deceuninck
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_12_0', 'sl_itz26_12', rid, 121, 'Hugo', 'Houle'),
    ('sl_itz26_12_1', 'sl_itz26_12', rid, 122, 'Ramses', 'Debruyne'),
    ('sl_itz26_12_2', 'sl_itz26_12', rid, 123, 'Lennert', 'Belmans'),
    ('sl_itz26_12_3', 'sl_itz26_12', rid, 124, 'Emiel', 'Verstrynge'),
    ('sl_itz26_12_4', 'sl_itz26_12', rid, 125, 'Aaron', 'Dockx'),
    ('sl_itz26_12_5', 'sl_itz26_12', rid, 126, 'Gal', 'Glivar'),
    ('sl_itz26_12_6', 'sl_itz26_12', rid, 127, 'Luca', 'Vergallito');

  -- Lotto Intermarché
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_13_0', 'sl_itz26_13', rid, 131, 'Julian', 'Alaphilippe'),
    ('sl_itz26_13_1', 'sl_itz26_13', rid, 132, 'Fabien', 'Weiss'),
    ('sl_itz26_13_2', 'sl_itz26_13', rid, 133, 'Marco', 'Brenner'),
    ('sl_itz26_13_3', 'sl_itz26_13', rid, 134, 'Jacob', 'Eriksson'),
    ('sl_itz26_13_4', 'sl_itz26_13', rid, 135, 'Yannis', 'Voisard'),
    ('sl_itz26_13_5', 'sl_itz26_13', rid, 136, 'Hannes', 'Wilksch'),
    ('sl_itz26_13_6', 'sl_itz26_13', rid, 137, 'Lux', 'Witters');

  -- Cofidis
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_14_0', 'sl_itz26_14', rid, 141, 'Iñaki', 'Izagirre Insausti'),
    ('sl_itz26_14_1', 'sl_itz26_14', rid, 142, 'Alex', 'Aranburu Deva'),
    ('sl_itz26_14_2', 'sl_itz26_14', rid, 143, 'Emanuel', 'Buchmann'),
    ('sl_itz26_14_3', 'sl_itz26_14', rid, 144, 'Jamie', 'Medhat'),
    ('sl_itz26_14_4', 'sl_itz26_14', rid, 145, 'Yael', 'Joalland'),
    ('sl_itz26_14_5', 'sl_itz26_14', rid, 146, 'Jan', 'Maas'),
    ('sl_itz26_14_6', 'sl_itz26_14', rid, 147, 'Paul', 'Ourselin');

  -- Caja Rural-Seguros RGA
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_15_0', 'sl_itz26_15', rid, 151, 'Fernando', 'Barceló Aragón'),
    ('sl_itz26_15_1', 'sl_itz26_15', rid, 152, 'Ián', 'Castillo Ribalat'),
    ('sl_itz26_15_2', 'sl_itz26_15', rid, 153, 'Samuel', 'Castellano García'),
    ('sl_itz26_15_3', 'sl_itz26_15', rid, 154, 'Alex', 'Egoitz'),
    ('sl_itz26_15_4', 'sl_itz26_15', rid, 155, 'Julián', 'Arango-Benga Beitia'),
    ('sl_itz26_15_5', 'sl_itz26_15', rid, 156, 'Joseba', 'López Cuesta'),
    ('sl_itz26_15_6', 'sl_itz26_15', rid, 157, 'Birgen', 'Fernández Bustinza'),
    ('sl_itz26_15_7', 'sl_itz26_15', rid, 158, 'Gorka', 'Guerricagoitia');

  -- Euskaltel-Euskadi
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_16_0', 'sl_itz26_16', rid, 161, 'Gaël', 'Usarte Larrea'),
    ('sl_itz26_16_1', 'sl_itz26_16', rid, 162, 'Mikel', 'Bizkarena Etxeberria'),
    ('sl_itz26_16_2', 'sl_itz26_16', rid, 163, 'Txomin', 'Juaristi Arrieta'),
    ('sl_itz26_16_3', 'sl_itz26_16', rid, 164, 'Jonathan', 'Lastra Martínez'),
    ('sl_itz26_16_4', 'sl_itz26_16', rid, 165, 'Nicolás', 'Alústiza Goikoana'),
    ('sl_itz26_16_5', 'sl_itz26_16', rid, 166, 'Gotzon', 'Martín Sanz'),
    ('sl_itz26_16_6', 'sl_itz26_16', rid, 167, 'Iker', 'Mintegi Clavijo'),
    ('sl_itz26_16_7', 'sl_itz26_16', rid, 168, 'Jorge', 'Aranaz Soto'),
    ('sl_itz26_16_8', 'sl_itz26_16', rid, 169, 'Rubén', 'Pérez Moreno'),
    ('sl_itz26_16_9', 'sl_itz26_16', rid, 103, 'Itaki', 'Isasi Flores');

  -- EF Education-EasyPost
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_17_0', 'sl_itz26_17', rid, 171, 'Ben', 'Healy'),
    ('sl_itz26_17_1', 'sl_itz26_17', rid, 172, 'Markel', 'Beloki Fernández'),
    ('sl_itz26_17_2', 'sl_itz26_17', rid, 173, 'James', 'Shaw'),
    ('sl_itz26_17_3', 'sl_itz26_17', rid, 174, 'Lukas', 'Nerurkar'),
    ('sl_itz26_17_4', 'sl_itz26_17', rid, 175, 'Jordi Christian', 'Van Der Lijk'),
    ('sl_itz26_17_5', 'sl_itz26_17', rid, 176, 'Alex', 'Baudin'),
    ('sl_itz26_17_6', 'sl_itz26_17', rid, 177, 'Michael Shau', 'Leonard');

  -- INEOS Grenadiers
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_18_0', 'sl_itz26_18', rid, 181, 'Andrew', 'August'),
    ('sl_itz26_18_1', 'sl_itz26_18', rid, 182, 'Wade Lucas', 'Hamilton'),
    ('sl_itz26_18_2', 'sl_itz26_18', rid, 183, 'Ethan', 'Vauquelin'),
    ('sl_itz26_18_3', 'sl_itz26_18', rid, 184, 'Victor', 'Langellotti'),
    ('sl_itz26_18_4', 'sl_itz26_18', rid, 185, 'Axel', 'Laurence'),
    ('sl_itz26_18_5', 'sl_itz26_18', rid, 186, 'Brandon', 'Rivera Vargas'),
    ('sl_itz26_18_6', 'sl_itz26_18', rid, 187, 'Daryl', 'Impey');

  -- Team Visma-Lease a Bike
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_19_0', 'sl_itz26_19', rid, 191, 'Bruno', 'Armirail'),
    ('sl_itz26_19_1', 'sl_itz26_19', rid, 192, 'Menno', 'Huising'),
    ('sl_itz26_19_2', 'sl_itz26_19', rid, 193, 'Sean', 'Tulett'),
    ('sl_itz26_19_3', 'sl_itz26_19', rid, 194, 'Steven', 'Kruijswijk'),
    ('sl_itz26_19_4', 'sl_itz26_19', rid, 195, 'Tim', 'Rex'),
    ('sl_itz26_19_5', 'sl_itz26_19', rid, 196, 'Filippo', 'Horsell'),
    ('sl_itz26_19_6', 'sl_itz26_19', rid, 197, 'Francis', 'Mouassen'),
    ('sl_itz26_19_7', 'sl_itz26_19', rid, 198, 'Gaitán', 'Pons');

  -- Uno-X Mobility
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_20_0', 'sl_itz26_20', rid, 201, 'Cort Magnus', 'Nielsen'),
    ('sl_itz26_20_1', 'sl_itz26_20', rid, 202, 'Tobias Halland', 'Johannessen'),
    ('sl_itz26_20_2', 'sl_itz26_20', rid, 203, 'Anders Halland', 'Johannessen'),
    ('sl_itz26_20_3', 'sl_itz26_20', rid, 204, 'Andreas', 'Kron'),
    ('sl_itz26_20_4', 'sl_itz26_20', rid, 205, 'Johannes', 'Kulset'),
    ('sl_itz26_20_5', 'sl_itz26_20', rid, 206, 'Martin', 'Tuften'),
    ('sl_itz26_20_6', 'sl_itz26_20', rid, 207, 'Torstein', 'Træen');

  -- Lotto Intermarché (continuación)
  INSERT INTO startlist_riders (id, "teamId", "raceId", dorsal, "firstName", "lastName") VALUES
    ('sl_itz26_21_0', 'sl_itz26_21', rid, 211, 'Mathieu', 'Kockelmann'),
    ('sl_itz26_21_1', 'sl_itz26_21', rid, 212, 'Luke Matthew', 'Fox'),
    ('sl_itz26_21_2', 'sl_itz26_21', rid, 213, 'Felix', 'Brinkristoff'),
    ('sl_itz26_21_3', 'sl_itz26_21', rid, 214, 'Robin', 'Orins'),
    ('sl_itz26_21_4', 'sl_itz26_21', rid, 215, 'Reuben', 'Thompson'),
    ('sl_itz26_21_5', 'sl_itz26_21', rid, 216, 'Baptiste', 'Veistroffer'),
    ('sl_itz26_21_6', 'sl_itz26_21', rid, 217, 'Georg', 'Zimmermann');

END $$;
