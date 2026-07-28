-- Impide que una jornada tenga más de un asset de cada tipo.
-- No altera filas existentes: los duplicados ya presentes se revisarán aparte.

create or replace function public.prevent_duplicate_asset_type()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.type is null then
    return new;
  end if;

  -- Serializa inserciones concurrentes de la misma combinación jornada + tipo.
  perform pg_advisory_xact_lock(
    hashtextextended(new."raceDayId" || chr(31) || new.type, 0)
  );

  if exists (
    select 1
    from public.assets
    where "raceDayId" = new."raceDayId"
      and type = new.type
      and id is distinct from new.id
  ) then
    raise exception using
      errcode = 'unique_violation',
      message = 'Ya existe un asset de este tipo en la jornada';
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_duplicate_asset_type() from public;

drop trigger if exists prevent_duplicate_asset_type on public.assets;

create trigger prevent_duplicate_asset_type
before insert or update of "raceDayId", type on public.assets
for each row
execute function public.prevent_duplicate_asset_type();
