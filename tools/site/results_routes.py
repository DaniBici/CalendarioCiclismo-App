"""Identidad y rutas de resultados para etapas con dobles sectores."""

SUFFIXES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def sector_suffixes(race_days):
    """Devuelve ``raceDayId -> A/B/...`` sin mezclar carreras distintas."""
    groups = {}
    for day in race_days or []:
        if day.get("stageNumber") is None or day.get("isRestDay"):
            continue
        key = (day.get("raceId") or "", day.get("dateKey") or "", day.get("stageNumber"))
        groups.setdefault(key, []).append(day)

    suffix_by_day = {}
    for group in groups.values():
        if len(group) < 2:
            continue
        group.sort(key=lambda day: (
            day.get("neutralStartTimeUtc") or "~",
            str(day.get("id") or ""),
        ))
        for index, day in enumerate(group):
            if day.get("id"):
                suffix_by_day[day["id"]] = SUFFIXES[index] if index < len(SUFFIXES) else ""
    return suffix_by_day


def result_entry_key(race_format, stage_number, race_day_id, suffix_by_day):
    """Clave ``(stageNumber, suffix)``; ``(None, '')`` para final/un día."""
    if race_format == "one_day" or stage_number is None:
        return (None, "")
    return (stage_number, suffix_by_day.get(race_day_id, "") if race_day_id else "")


def without_ambiguous_plain_entries(entries):
    """Retira ``1`` si existen claves sectorizadas ``1A``/``1B`` para ese número."""
    scoped_numbers = {number for number, suffix in entries if number is not None and suffix}
    return {
        entry for entry in entries
        if not (entry[0] in scoped_numbers and entry[1] == "")
    }


def result_entry_sort_key(entry):
    number, suffix = entry
    return (number is None, number if number is not None else 0, suffix or "")


def result_segment(stage_number, suffix="", is_en=False):
    if stage_number == 0:
        return "prologue" if is_en else "prologo"
    if stage_number is None:
        return ""
    prefix = "stage" if is_en else "etapa"
    return f"{prefix}-{stage_number}{(suffix or '').lower()}"


def result_stage_label(stage_number, suffix="", is_en=False):
    if stage_number == 0:
        return "Prologue" if is_en else "Prólogo"
    if stage_number is None:
        return "Final classification" if is_en else "Clasificación final"
    prefix = "Stage" if is_en else "Etapa"
    return f"{prefix} {stage_number}{suffix or ''}"
