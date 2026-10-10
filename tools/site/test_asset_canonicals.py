"""Correspondencia PDF de assets → página canónica, con filas locales."""
import unittest

import gen_asset_canonicals as canonicals

BASE = "https://calendariociclismo.app"
HOST = "https://assets.calendariociclismo.app"


def race(race_id, slug, year=2026, race_format="stage_race"):
    return {"id": race_id, "slug": slug, "year": year, "raceFormat": race_format}


def day(day_id, race_id, slug, number=1, **extra):
    return {"id": day_id, "raceId": race_id, "slug": slug, "stageNumber": number,
            "dateKey": "2026-09-20", "startLocation": "A", "finishLocation": "B", **extra}


def asset(kind, day_id, path, **extra):
    return {"type": kind, "raceDayId": day_id, "url": f"{HOST}{path}", **extra}


class AssetCanonicalsTest(unittest.TestCase):
    def build(self, assets, races, days, profile_ids=(), cx_races=()):
        return canonicals.build_map(assets, races, days, profile_ids, cx_races)[0]

    def test_type_to_page_with_and_without_dedicated_page(self):
        races = [race("r1", "vuelta"), race("r2", "clasica", race_format="one_day")]
        days = [day("d1", "r1", "vuelta-2026-etapa-1", routeGpxUrl="https://x/a.gpx"),
                day("d2", "r1", "vuelta-2026-etapa-2", 2),
                day("d3", "r1", "vuelta-2026-etapa-3", 3, profileNotViewable=True),
                day("d4", "r2", "clasica-2026", None)]
        assets = [asset("map", "d1", "/races/vuelta/2026/stage-1/map.pdf"),
                  asset("map", "d2", "/races/vuelta/2026/stage-2/map.pdf"),
                  asset("profile", "d1", "/races/vuelta/2026/stage-1/profile.pdf"),
                  asset("ports", "d2", "/races/vuelta/2026/stage-2/ports.pdf"),
                  asset("profile", "d3", "/races/vuelta/2026/stage-3/profile.pdf"),
                  asset("roadbook", "d2", "/races/vuelta/2026/stage-2/roadbook.pdf"),
                  asset("technicalGuide", "d1", "/races/vuelta/2026/technicalGuide.pdf"),
                  asset("technicalGuide", "d4", "/races/clasica/2026/technicalGuide.pdf")]
        mapping = self.build(assets, races, days, profile_ids=["d1", "d3"])
        self.assertEqual(mapping, {
            "/races/vuelta/2026/stage-1/map.pdf": f"{BASE}/mapa/vuelta-2026-etapa-1/",
            "/races/vuelta/2026/stage-2/map.pdf": f"{BASE}/jornada/vuelta-2026-etapa-2/",
            "/races/vuelta/2026/stage-1/profile.pdf": f"{BASE}/perfil/vuelta-2026-etapa-1/",
            "/races/vuelta/2026/stage-2/ports.pdf": f"{BASE}/jornada/vuelta-2026-etapa-2/",
            "/races/vuelta/2026/stage-3/profile.pdf": f"{BASE}/jornada/vuelta-2026-etapa-3/",
            "/races/vuelta/2026/stage-2/roadbook.pdf": f"{BASE}/jornada/vuelta-2026-etapa-2/",
            "/races/vuelta/2026/technicalGuide.pdf": f"{BASE}/competicion/vuelta/",
            "/races/clasica/2026/technicalGuide.pdf": f"{BASE}/jornada/clasica-2026/"})

    def test_archived_unpublished_foreign_and_non_pdf_assets_are_omitted(self):
        races = [race("r1", "vuelta"), race("r0", "vuelta-2025", year=2025)]
        days = [day("d1", "r1", "vuelta-2026-etapa-1"), day("d0", "r0", "vuelta-2025-etapa-1")]
        assets = [asset("roadbook", "d0", "/races/vuelta/2025/stage-1/roadbook.pdf"),
                  asset("roadbook", "sin-publicar", "/races/vuelta/2026/stage-9/roadbook.pdf"),
                  asset("roadbook", "d1", "/races/vuelta/2026/stage-1/roadbook.jpg"),
                  {"type": "roadbook", "raceDayId": "d1", "url": "https://otro.example/roadbook.pdf"},
                  asset("map", "d1", "/races/vuelta/2026/stage-1/map.pdf?v=2")]
        self.assertEqual(self.build(assets, races, days),
                         {"/races/vuelta/2026/stage-1/map.pdf": f"{BASE}/jornada/vuelta-2026-etapa-1/"})

    def test_alias_days_use_master_slug_and_shared_files_with_two_targets_are_dropped(self):
        races = [race("r1", "vuelta"), race("r2", "otra")]
        days = [day("d1", "r1", "vuelta-2026-etapa-1"), day("d2", "r1", "vuelta-etapa-1-alias-largo"),
                day("d3", "r2", "otra-2026-etapa-1")]
        assets = [asset("roadbook", "d2", "/races/vuelta/2026/stage-1/roadbook.pdf"),
                  asset("roadbook", "d1", "/races/vuelta/2026/stage-1/roadbook.pdf"),
                  asset("roadbook", "d1", "/compartido.pdf"),
                  asset("roadbook", "d3", "/compartido.pdf")]
        self.assertEqual(self.build(assets, races, days),
                         {"/races/vuelta/2026/stage-1/roadbook.pdf": f"{BASE}/jornada/vuelta-2026-etapa-1/"})

    def test_cyclocross_only_technical_guides_of_current_season_pages(self):
        cx = [{"id": "c1", "slug": "cx-uno-2026"}]
        assets = [{"type": "technicalGuide", "cxRaceId": "c1", "url": f"{HOST}/cx/cx-uno-2026/2026/technicalGuide.pdf"},
                  {"type": "technicalGuide", "cxRaceId": "antigua", "url": f"{HOST}/cx/antigua/2025/technicalGuide.pdf"},
                  {"type": "map", "cxRaceId": "c1", "url": f"{HOST}/cx/cx-uno-2026/2026/map.pdf"}]
        self.assertEqual(self.build(assets, [], [], cx_races=cx),
                         {"/cx/cx-uno-2026/2026/technicalGuide.pdf": f"{BASE}/ciclocross/cx-uno-2026/"})

    def test_path_key_matches_encode_uri_component_of_the_request(self):
        self.assertEqual(canonicals.asset_path(f"{HOST}/races/a b/ñ/map.PDF"), "/races/a%20b/%C3%B1/map.PDF")
        self.assertEqual(canonicals.asset_path(f"{HOST}/races/a%20b/map.pdf"), "/races/a%20b/map.pdf")
        self.assertEqual(canonicals.asset_path(f"{HOST}/races/it's_(1)/map.pdf"), "/races/it's_(1)/map.pdf")
        self.assertIsNone(canonicals.asset_path("http://assets.calendariociclismo.app/map.pdf"))


if __name__ == "__main__":
    unittest.main()
