-- Validar la extensión del archivo antes de los parámetros de la URL.
ALTER TABLE public.assets
    DROP CONSTRAINT assets_cx_map_image_format,
    ADD CONSTRAINT assets_cx_map_image_format
    CHECK (
        "cxRaceId" IS NULL
        OR type IS DISTINCT FROM 'map'
        OR url ~* '^[^?#]+\.(jpe?g|png)([?#].*)?$'
    );
