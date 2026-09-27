"""Temporadas de carretera archivadas: páginas publicadas con noindex y fuera del sitemap."""

ARCHIVED_SEASONS = range(2020, 2026)
ROBOTS_INDEX = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
ROBOTS_NOINDEX = "noindex, follow"


def race_is_archived(race):
    """`races.year` es la temporada UCI; algunas carreras empiezan el año civil anterior."""
    try:
        return int((race or {}).get("year")) in ARCHIVED_SEASONS
    except (TypeError, ValueError):
        return False


def race_robots(race):
    return ROBOTS_NOINDEX if race_is_archived(race) else ROBOTS_INDEX
