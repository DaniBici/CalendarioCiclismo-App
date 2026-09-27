-- La tabla de backup solo requiere lectura y nuevas inserciones por el rol de servicio.
REVOKE ALL ON TABLE private.repair_results_only_rider_catalog_20260830_backup FROM service_role;
GRANT SELECT, INSERT ON TABLE private.repair_results_only_rider_catalog_20260830_backup TO service_role;
