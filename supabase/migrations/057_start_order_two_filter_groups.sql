-- 057: Dos grupos de filtro en orden de salida (TT Specialists y GC)
-- Renombra startOrderFavDorsals → startOrderTtDorsals y añade startOrderGcDorsals.
ALTER TABLE race_days RENAME COLUMN "startOrderFavDorsals" TO "startOrderTtDorsals";
ALTER TABLE race_days ADD COLUMN "startOrderGcDorsals" INTEGER[] DEFAULT NULL;
