-- 097: Eliminar índices DUPLICADOS idénticos en riders_men / riders_women.
--
-- idx_riders_men_lastname  ==  idx_riders_men_lastname_lower   (ambos btree lower("lastName"))
-- idx_riders_women_lastname == idx_riders_women_lastname_lower (idem)
--
-- Dos índices idénticos = doble coste de escritura y de planificación sin beneficio
-- (advisor 0009 duplicate_index). Se conserva en cada par el que tenía scans según
-- pg_stat_user_indexes y se elimina el que estaba a 0 (el resultante sirve igual a
-- todas las consultas por ser idéntico).

drop index if exists public.idx_riders_men_lastname_lower;  -- queda idx_riders_men_lastname
drop index if exists public.idx_riders_women_lastname;       -- queda idx_riders_women_lastname_lower
