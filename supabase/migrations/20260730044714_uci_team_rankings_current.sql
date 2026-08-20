-- ═══════════════════════════════════════════════════════════════════
--  RÁNKING UCI DE EQUIPOS — INSTANTÁNEA ACTUAL
--
--  Una sola tabla sobrescribible para web, iOS y Android. No conserva
--  históricos: el sincronizador sustituye cada género cuando DataRide
--  publica el ránking semanal. `teamId` enlaza la fila oficial de la UCI
--  con el catálogo canónico de equipos; los nombres de fuente se guardan
--  también para auditar emparejamientos.
-- ═══════════════════════════════════════════════════════════════════

create table public.uci_team_rankings (
  gender text not null,
  rank smallint not null,
  "previousRank" smallint,
  "uciTeamId" bigint not null,
  "teamId" text references public.teams(id) on delete set null,
  "teamCategory" text,
  "sourceName" text not null,
  "displayName" text not null,
  "teamCode" text,
  "countryCode" text,
  points numeric(12,2) not null,
  "rankingDate" date not null,
  "rankingId" integer not null,
  "momentId" integer not null,
  "disciplineSeasonId" integer not null,
  "sourceUrl" text not null,
  "syncedAt" timestamptz not null default now(),

  constraint uci_team_rankings_pkey primary key (gender, rank),
  constraint uci_team_rankings_gender_check
    check (gender in ('male', 'female')),
  constraint uci_team_rankings_rank_check
    check (rank > 0),
  constraint uci_team_rankings_previous_rank_check
    check ("previousRank" is null or "previousRank" > 0),
  constraint uci_team_rankings_team_category_check
    check (
      "teamCategory" is null
      or "teamCategory" in (
        'WT', 'PT', 'CT', 'CLUBM', 'NTM',
        'WWT', 'PRW', 'CTW', 'CLUBW', 'NTW'
      )
    ),
  constraint uci_team_rankings_points_check
    check (points >= 0),
  constraint uci_team_rankings_gender_uci_team_key
    unique (gender, "uciTeamId")
);

create index uci_team_rankings_team_id_idx
  on public.uci_team_rankings ("teamId")
  where "teamId" is not null;

comment on table public.uci_team_rankings is
  'Instantánea sobrescribible del ránking UCI de equipos de DataRide. Una fila por género y posición; sin histórico.';

comment on column public.uci_team_rankings."teamId" is
  'Equipo canónico asociado en public.teams; NULL solo si DataRide publica un equipo todavía no catalogado.';

comment on column public.uci_team_rankings."teamCategory" is
  'Categoría UCI de team_seasons para la temporada del ránking; determina las bandas de invitación.';

alter table public.uci_team_rankings enable row level security;

create policy "El ránking UCI es de lectura pública"
  on public.uci_team_rankings
  for select
  to anon, authenticated
  using (true);

-- Los privilegios automáticos de public están revocados en este proyecto:
-- exposición explícita, de solo lectura, para los clientes.
grant select on table public.uci_team_rankings to anon, authenticated;
grant select, insert, update, delete on table public.uci_team_rankings to service_role;
