-- Repara el desfase UTC (-1 día) del nacimiento en fichas CX importadas de rankings UCI.
-- Manifiesto: 22/22 contra DataRide, 381/389 vs catálogo de carretera, verificación
-- independiente (dewielersite 22-02-1989). Autorización: Dani 2026-09-13.
-- Backup dirigido en private.cx_repair_dob_offbyone_backup (1757 filas).
create table if not exists private.cx_repair_dob_offbyone_backup (
  repaired_at timestamptz not null default now(),
  table_name text not null,
  rider_id text not null,
  old_birth_date date,
  new_birth_date date,
  source text not null
);
revoke all on table private.cx_repair_dob_offbyone_backup from public;

with picked as (
  select id, "birthDate" as old_d, "birthDate" + 1 as new_d, source
  from public.cx_riders_men where source like 'uci_rankings_%' and "birthDate" is not null
), backed as (
  insert into private.cx_repair_dob_offbyone_backup(table_name, rider_id, old_birth_date, new_birth_date, source)
  select 'cx_riders_men', id, old_d, new_d, source from picked
  returning rider_id
)
update public.cx_riders_men r set "birthDate" = p.new_d
from picked p join backed b on b.rider_id = p.id
where r.id = p.id;

with picked as (
  select id, "birthDate" as old_d, "birthDate" + 1 as new_d, source
  from public.cx_riders_women where source like 'uci_rankings_%' and "birthDate" is not null
), backed as (
  insert into private.cx_repair_dob_offbyone_backup(table_name, rider_id, old_birth_date, new_birth_date, source)
  select 'cx_riders_women', id, old_d, new_d, source from picked
  returning rider_id
)
update public.cx_riders_women r set "birthDate" = p.new_d
from picked p join backed b on b.rider_id = p.id
where r.id = p.id;
