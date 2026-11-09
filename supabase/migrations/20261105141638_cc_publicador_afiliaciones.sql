-- La publicación por página genera cada equipo del mercado de fichajes con su plantilla:
-- lectura de las afiliaciones, ya públicas para la clave anónima (política
-- public_read_rider_team_affiliations).
GRANT SELECT ON TABLE public.rider_team_affiliations TO cc_publicador;
