"""Ventana pública de ciclocross: agosto del primer año a febrero del siguiente."""
from datetime import date


def cx_date_in_season(value, season):
    try:
        civil = date.fromisoformat(value)
        year = int(season[:4])
        return season == f"{year:04d}-{(year + 1) % 100:02d}" and (
            civil.year == year and civil.month >= 8 or
            civil.year == year + 1 and civil.month <= 2
        )
    except (TypeError, ValueError):
        return False


def cx_race_in_season(race):
    season = race.get("seasonKey")
    return cx_date_in_season(race.get("dateKey"), season) and (
        not race.get("endDateKey") or cx_date_in_season(race["endDateKey"], season)
    )


# Clases sin versión en inglés: la categoría nacional española (y los futuros
# calendarios nacionales) está dirigida al público hispanohablante. Espejo de
# cxHiddenClasses (js/services/cx-data.js) y de las apps.
CX_SPANISH_ONLY_CLASSES = {"NAC"}
CX_SPANISH_AUDIENCE_TITLE = "Available in Spanish"
CX_SPANISH_AUDIENCE_TEXT = "This content is intended for Spanish-speaking audiences, mainly in Spain."
CX_SPANISH_AUDIENCE_LINK = "View in Spanish"


def cx_race_has_english(race):
    return race.get("class") not in CX_SPANISH_ONLY_CLASSES


def cx_tournament_has_english(tournament_id, races):
    """Un torneo formado solo por carreras nacionales no tiene versión en inglés."""
    return any(cx_race_has_english(race) for race in races
               if (race.get("cx_tournaments") or {}).get("id") == tournament_id)
