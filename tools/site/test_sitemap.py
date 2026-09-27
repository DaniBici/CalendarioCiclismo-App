"""Comprueba el sitemap real con filas locales, sin consultar la base de datos."""
import os
from datetime import date
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from xml.etree import ElementTree as ET

import gen_sitemap


class SitemapTest(unittest.TestCase):
    def test_bilingual_catalog_and_sector_results_have_entries(self):
        day = {'id': 'day-a', 'raceId': 'race-1', 'slug': 'vuelta-etapa-1a',
               'slugEn': 'tour-stage-1a', 'stageNumber': 1, 'dateKey': '2026-09-24',
               'neutralStartTimeUtc': '2026-09-24T08:00:00Z', 'updatedAt': '2026-09-24',
               'elevationProfile': {'points': [[0, 0], [1, 1]]}, 'routeGpxUrl': 'https://example.com/a.gpx'}
        day_b = {**day, 'id': 'day-b', 'slug': 'vuelta-etapa-1b', 'slugEn': 'tour-stage-1b',
                 'neutralStartTimeUtc': '2026-09-24T14:00:00Z'}
        race = {'id': 'race-1', 'slug': 'vuelta', 'slugEn': 'tour', 'name': 'Vuelta',
                'nameEn': 'Tour', 'year': 2026, 'raceFormat': 'stage_race',
                'startDate': '2026-09-24', 'endDate': '2026-09-25'}
        archived = {**race, 'id': 'race-2025', 'slug': 'vuelta-2025', 'slugEn': 'tour-2025',
                    'year': 2025, 'startDate': '2024-10-25', 'endDate': '2024-10-26'}
        archived_day = {**day, 'id': 'day-2025', 'raceId': 'race-2025', 'slug': 'vuelta-2025-etapa-1',
                        'slugEn': 'tour-2025-stage-1', 'dateKey': '2024-10-25'}

        def rows(path):
            if path.startswith('races?'): return [race, archived]
            if path.startswith('race_days?') and 'startOrderImportedAt' in path:
                return [{**archived_day, 'startOrderImportedAt': '2024-10-24'}]
            if path.startswith('race_days?'): return [day, day_b, archived_day]
            if path.startswith('startlist_teams?'): return [{'raceId': 'race-2025'}]
            if path.startswith('race_uci_stages?'):
                return [{'raceId': 'race-1', 'raceDayId': 'day-a', 'stageNumber': 1},
                        {'raceId': 'race-1', 'raceDayId': 'day-b', 'stageNumber': 1},
                        {'raceId': 'race-2025', 'raceDayId': 'day-2025', 'stageNumber': 1}]
            return []

        with TemporaryDirectory() as directory, patch.object(gen_sitemap, 'supabase_get', rows), \
                patch.object(gen_sitemap, 'today', '2026-09-24'), \
                patch.object(gen_sitemap, 'today_d', date(2026, 9, 24)), \
                patch.object(gen_sitemap, 'cx_race_in_season', lambda _: True):
            old = os.getcwd()
            try:
                os.chdir(directory)
                gen_sitemap.generate_full()
                ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9',
                      'x': 'http://www.w3.org/1999/xhtml'}
                index = ET.parse('sitemap.xml').getroot()
                self.assertEqual(index.tag, '{http://www.sitemaps.org/schemas/sitemap/0.9}sitemapindex')
                urlset = ET.parse('sitemap-1.xml').getroot()
                by_loc = {node.findtext('s:loc', namespaces=ns): node for node in urlset}
                for suffix in ('1a', '1b'):
                    self.assertIn(f'https://calendariociclismo.app/resultados/vuelta/etapa-{suffix}/', by_loc)
                    self.assertIn(f'https://calendariociclismo.app/en/results/tour/stage-{suffix}/', by_loc)
                es = by_loc['https://calendariociclismo.app/jornada/vuelta-etapa-1a/']
                en = by_loc['https://calendariociclismo.app/en/stage/tour-stage-1a/']
                self.assertEqual([link.attrib['href'] for link in es.findall('x:link', ns)],
                                 [link.attrib['href'] for link in en.findall('x:link', ns)])
                self.assertEqual([loc for loc in by_loc if '2025' in loc], [])
            finally:
                os.chdir(old)


if __name__ == '__main__':
    unittest.main()
