-- Índices de soporte para las claves foráneas del catálogo histórico.
create index if not exists historical_participation_decisions_batch_idx
  on private.historical_participation_decisions ("batchId");

create index if not exists historical_participation_decisions_team_idx
  on private.historical_participation_decisions ("teamId");

create index if not exists historical_team_roster_observations_batch_idx
  on private.historical_team_roster_observations ("batchId");

create index if not exists historical_team_roster_observations_team_idx
  on private.historical_team_roster_observations ("teamId");

create index if not exists uci_catalog_team_links_team_id_idx
  on private.uci_catalog_team_links (team_id);
