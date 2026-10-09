-- Catálogo UCI 2026: 4WD Rentacar - Facatativa cambia de perfil UCI.
-- La UCI retiró el perfil 21481 el 26/09/2026 y registró el 21530 (Banco
-- Industrial - 4WD Rentacar) con los mismos 13 corredores, todos en la ficha
-- local de este equipo. El enlace de temporada pasa de un perfil al otro;
-- `uci_catalog_review_team` no puede hacerlo porque (season, team_id) es único.
UPDATE private.uci_catalog_team_links
   SET profile='21530', source_name='BANCO INDUSTRIAL - 4WD RENTACAR', source_code='BI4', reviewed_at=clock_timestamp()
 WHERE season=2026 AND profile='21481' AND team_id='team_1780912000089_ru3hv9';
INSERT INTO private.uci_catalog_decisions(decision,status)
VALUES('Equipo UCI 21530 de 2026 asociado a team_1780912000089_ru3hv9 en sustitución del perfil 21481 (retirado por la UCI el 26/09/2026)','team_link');
