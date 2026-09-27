-- Los mapas CX se visualizan como imágenes en web y apps.
-- Las guías técnicas y los documentos de carretera conservan sus formatos.
ALTER TABLE public.assets
    ADD CONSTRAINT assets_cx_map_image_format
    CHECK (
        "cxRaceId" IS NULL
        OR type IS DISTINCT FROM 'map'
        OR url ~* '\.(jpe?g|png)([?#].*)?$'
    );
