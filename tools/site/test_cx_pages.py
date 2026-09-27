"""Verifica los builders con datos locales, sin conexión ni credenciales."""
import ast
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from datetime import date, datetime, timezone
from urllib.parse import quote
import json
import html
import xml.etree.ElementTree as ET

import archived_seasons
from check_seo_output import CATALOG_DIRS, check_site

ROOT = Path(__file__).resolve().parents[2]


def offline_helpers(filename):
    tree = ast.parse((ROOT / filename).read_text())
    constants = {'BASE_URL','BASE_URL_EN','DEFAULT_OG_IMAGE','OG_WORKER_URL',
                 'SITE_HEADER_HTML','SITE_HEADER_HTML_EN','SITE_FOOTER_HTML',
                 'SITE_FOOTER_HTML_EN','PRERENDER_STYLE','PRERENDER_LOADING_HTML',
                 'JORNADA_SCRIPT','APP_STYLESHEET','MESES','DIAS_SEMANA','PAIS_ES'}
    nodes = [n for n in tree.body if isinstance(n,ast.FunctionDef) or
             isinstance(n,ast.Assign) and all(isinstance(t,ast.Name) and t.id in constants for t in n.targets)]
    namespace = {'os':os,'html':html,'json':json,'quote':quote,'datetime':datetime,'timezone':timezone,'dt_date':date,
                 'ROBOTS_INDEX':archived_seasons.ROBOTS_INDEX,'race_robots':archived_seasons.race_robots,
                 'race_is_archived':archived_seasons.race_is_archived}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),filename,'exec'),namespace)
    return namespace


class CxPagesTest(unittest.TestCase):
    def test_incremental_stage_filters_rows_and_parent_races(self):
        builder = offline_helpers('tools/site/gen_og_pages.py')
        builder['OG_FAMILIES'] = {'stages'}
        builder['SELECTED_STAGE_SLUGS'] = {'new-stage'}
        builder['SELECTED_RACE_IDS'] = {'race-new'}
        days = [{'raceId': 'race-new', 'slug': 'new-stage'},
                {'raceId': 'race-old', 'slug': 'old-stage'}]
        self.assertEqual(list(builder['emit_rows'](days, 'stages')), days[:1])
        builder['OG_FAMILIES'] = {'races'}
        races = [{'id': 'race-new', 'slug': 'new-race'},
                 {'id': 'race-old', 'slug': 'old-race'}]
        self.assertEqual(list(builder['emit_rows'](races, 'races')), races[:1])
        self.assertEqual(list(builder['emit_rows'](days, 'stages')), [])

    def test_sitemap_bilingual_entries_are_reciprocal(self):
        builder = offline_helpers('tools/site/gen_sitemap.py')
        es = 'https://calendariociclismo.app/jornada/ejemplo/'
        en = 'https://calendariociclismo.app/en/stage/example/'
        entries = []
        builder['add_bilingual'](entries, es, en, '2026-09-24', 'daily', '0.8')
        xml = ET.fromstring('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
                            'xmlns:xhtml="http://www.w3.org/1999/xhtml">'
                            + ''.join(entries) + '</urlset>')
        ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9',
              'x': 'http://www.w3.org/1999/xhtml'}
        self.assertEqual([node.findtext('s:loc', namespaces=ns) for node in xml], [es, en])
        for node in xml:
            self.assertEqual({link.attrib['hreflang']: link.attrib['href']
                              for link in node.findall('x:link', ns)},
                             {'es': es, 'en': en, 'x-default': es})

    def setUp(self):
        self.race = {'id':'cx-fixture','name':'Mundial & CX','nameEn':'Worlds & CX',
                     'slug':'mundial-cx','slugEn':'worlds-cx','seasonKey':'2026-27',
                     'dateKey':'2027-01-29','endDateKey':'2027-01-31','class':'CM',
                     'countryCode':'BE','venue':'Ostende','websiteUrl':'https://www.uci.org/',
                     'createdAt':'2026-09-12T12:00:00+02:00','updatedAt':'2026-09-12T13:00:00Z',
                     'cx_race_categories':[{'category':'WE','dateKey':'2027-01-30'},
                                           {'category':'ME','dateKey':'2027-01-31'}]}

    def test_bilingual_pages_have_canonical_sport_and_actual_dates(self):
        builder = offline_helpers('tools/site/gen_og_pages.py')
        with tempfile.TemporaryDirectory() as temp:
            cwd = os.getcwd()
            try:
                os.chdir(temp)
                builder['generate_cx_pages']([self.race])
                for directory in CATALOG_DIRS:
                    Path(directory).mkdir(parents=True,exist_ok=True)
                count,events,errors = check_site(Path(temp))
                self.assertEqual((count,events,errors),(6,2,[]))
                es = Path('ciclocross/mundial-cx/index.html').read_text()
                en = Path('en/cyclocross/worlds-cx/index.html').read_text()
                self.assertIn('hreflang="en" href="https://calendariociclismo.app/en/cyclocross/worlds-cx/"',es)
                self.assertIn('hreflang="es" href="https://calendariociclismo.app/ciclocross/mundial-cx/"',en)
                self.assertIn('"sport":"Cyclo-cross"',es.replace(' ',''))
                self.assertIn('"startDate":"2027-01-29"',es.replace(' ',''))
                self.assertIn('href="#WE">WE</a> · 2027-01-30',es)
                self.assertNotIn('href="#WU"',es)
                self.assertIn('Worlds &amp; CX',en)
                self.assertIn('data-cx-race-id="cx-fixture"',es)
                for suffix_es,suffix_en,page in [('inscritos','startlist','startlist'),('resultados','results','results')]:
                    page_es=Path(f'ciclocross/mundial-cx/{suffix_es}/index.html').read_text()
                    page_en=Path(f'en/cyclocross/worlds-cx/{suffix_en}/index.html').read_text()
                    self.assertIn(f'data-cx-page="{page}"',page_es)
                    self.assertIn(f'rel="canonical" href="https://calendariociclismo.app/ciclocross/mundial-cx/{suffix_es}/"',page_es)
                    self.assertIn(f'hreflang="en" href="https://calendariociclismo.app/en/cyclocross/worlds-cx/{suffix_en}/"',page_es)
                    self.assertIn(f'hreflang="es" href="https://calendariociclismo.app/ciclocross/mundial-cx/{suffix_es}/"',page_en)
            finally:
                os.chdir(cwd)

    def test_national_race_english_pages_show_notice_without_index_or_hreflang(self):
        builder = offline_helpers('tools/site/gen_og_pages.py')
        national = {**self.race,'class':'NAC','slug':'cx-local','slugEn':'local-cx'}
        with tempfile.TemporaryDirectory() as temp:
            cwd = os.getcwd()
            try:
                os.chdir(temp)
                builder['generate_cx_pages']([national])
                es = Path('ciclocross/cx-local/index.html').read_text()
                en = Path('en/cyclocross/local-cx/index.html').read_text()
                self.assertNotIn('hreflang="en"',es)
                self.assertIn('Available in Spanish',en)
                self.assertIn('content="noindex, follow"',en)
                self.assertNotIn('SportsEvent',en)
                self.assertIn('href="https://calendariociclismo.app/ciclocross/cx-local/"',en)
                results_en = Path('en/cyclocross/local-cx/results/index.html').read_text()
                self.assertIn('Available in Spanish',results_en)
            finally:
                os.chdir(cwd)
        sitemap = offline_helpers('tools/site/gen_sitemap.py')
        sitemap['today'] = '2026-09-27'
        sitemap['today_d'] = date(2026,9,27)
        entries = ''.join(sitemap['cx_entries']([national]))
        self.assertIn('/ciclocross/cx-local/',entries)
        self.assertNotIn('/en/cyclocross/local-cx/',entries)

    def test_tournament_pages_share_agenda_with_bilingual_canonicals_and_only_own_races(self):
        tournament={'id':'t','name':'Circuito & CX','nameEn':'CX & Series','slug':'circuito-cx','seasonKey':'2026-27','logoUrl':'https://example.org/logo.svg'}
        own={**self.race,'cx_tournaments':tournament}
        other={**self.race,'id':'other','slug':'otra-prueba','slugEn':'other-race','name':'Otra prueba','cx_tournaments':None}
        builder=offline_helpers('tools/site/gen_og_pages.py')
        with tempfile.TemporaryDirectory() as temp:
            cwd=os.getcwd()
            try:
                os.chdir(temp);builder['generate_cx_pages']([own,other])
                es=Path('ciclocross/torneos/circuito-cx/index.html').read_text()
                en=Path('en/cyclocross/series/circuito-cx/index.html').read_text()
                self.assertIn('id="cxAgendaContent"',es)
                self.assertIn('data-cx-tournament-id="t"',es)
                self.assertNotIn('data-cx-country=',es)
                self.assertIn('data-cx-logo="https://example.org/logo.svg"',es)
                self.assertIn('/js/ciclocross.js',es)
                self.assertIn('/css/ciclocross.css',es)
                self.assertIn('href="https://calendariociclismo.app/ciclocross/mundial-cx/"',es)
                self.assertIn('class="cx-tournament-list"',es)
                self.assertNotIn('cx-month-title',es)
                self.assertLess(es.index('data-date="2027-01-30"'),es.index('href="https://calendariociclismo.app/ciclocross/mundial-cx/"'))
                race_page = Path('ciclocross/mundial-cx/index.html').read_text()
                self.assertIn('<h1>Mundial &amp; CX</h1><p>CM · Circuito &amp; CX · Ostende</p><p>Viernes, 29 de enero de 2027 – domingo, 31 de enero de 2027</p>',race_page)
                self.assertIn('Pertenece a Circuito &amp; CX 2026-27.',race_page)
                self.assertIn('"name":"Categoría UCI CM"',race_page)
                self.assertIn('"name":"Circuito & CX 2026-27"',race_page)
                self.assertIn('class="crumbs"',race_page)
                self.assertNotIn('Otra prueba',es)
                self.assertIn('hreflang="en" href="https://calendariociclismo.app/en/cyclocross/series/circuito-cx/"',es)
                self.assertIn('hreflang="es" href="https://calendariociclismo.app/ciclocross/torneos/circuito-cx/"',en)
                self.assertIn('CX &amp; Series',en)
                description='El Circuito & CX abarca 1 prueba del 29 de enero al 31 de enero. Consulta fechas, horarios, resultados y cómo ver por TV y online streaming.'
                for source in [es,en]:
                    for attribute in ['name="description"','property="og:description"','name="twitter:description"']:
                        self.assertIn(f'<meta {attribute} content="{html.escape(description,quote=True)}">',source)
                builder['generate_cx_pages']([own,{**own,'id':'international','slug':'otra','countryCode':'ES'}])
                self.assertNotIn('data-cx-country=',Path('ciclocross/torneos/circuito-cx/index.html').read_text())
            finally:os.chdir(cwd)

    def test_tournament_seo_counts_unique_races_and_cross_year_dates_without_year(self):
        description=offline_helpers('tools/site/gen_og_pages.py')['cx_tournament_description']
        tournament={'id':'t','name':'Copa del Mundo UCI','seasonKey':'2026-27'}
        first={'id':'first','cx_tournaments':tournament,'dateKey':'2026-11-27'}
        last={'id':'last','cx_tournaments':tournament,'dateKey':'2027-01-24'}
        rows=[last,first,first,{**first,'id':'other','cx_tournaments':{'id':'other'}},
              {**first,'id':'old','dateKey':'2025-11-27'},
              {**last,'id':'outside','dateKey':'2027-03-01'}]
        ending='Consulta fechas, horarios, resultados y cómo ver por TV y online streaming.'
        self.assertEqual(description(tournament,rows),
                         f'La Copa del Mundo UCI abarca 2 pruebas del 27 de noviembre al 24 de enero. {ending}')
        for name,subject in [('Superprestige','El Superprestige'),('Copa de España','La Copa de España'),
                             ('Coupe de France','La Coupe de France'),('Swiss Cyclocross Cup','La Swiss Cyclocross Cup'),
                             ('Taça de Portugal','La Taça de Portugal'),('La Copa local','La Copa local')]:
            self.assertEqual(description({**tournament,'name':name},rows),
                             f'{subject} abarca 2 pruebas del 27 de noviembre al 24 de enero. {ending}')
        self.assertEqual(description(tournament,[]),f'La Copa del Mundo UCI abarca 0 pruebas. {ending}')

    def test_fallback_slug_and_missing_location_preserve_page_without_partial_event(self):
        race = {**self.race,'slugEn':None,'venue':None,'isCancelled':True}
        builder = offline_helpers('tools/site/gen_og_pages.py')
        with tempfile.TemporaryDirectory() as temp:
            cwd = os.getcwd()
            try:
                os.chdir(temp)
                builder['generate_cx_pages']([race])
                source = Path('en/cyclocross/mundial-cx/index.html').read_text()
                self.assertIn('cxRaceContent',source)
                self.assertNotIn('"@type": "SportsEvent"',source)
            finally:
                os.chdir(cwd)

    def test_corrected_race_descriptions_cover_class_weekday_and_multiday_in_both_languages(self):
        builder = offline_helpers('tools/site/gen_og_pages.py')
        with tempfile.TemporaryDirectory() as temp:
            cwd = os.getcwd()
            try:
                os.chdir(temp)
                for end, expected_date in [
                    ('2027-01-31', 'viernes 29 de enero de 2027 – domingo 31 de enero de 2027'),
                    ('2027-01-29', 'viernes 29 de enero de 2027'),
                    (None, 'viernes 29 de enero de 2027'),
                ]:
                    builder['generate_cx_pages']([{**self.race,'endDateKey':end}])
                    description = f'Mundial & CX ({expected_date}) es una prueba de ciclocross de categoría UCI CM en Ostende (Bélgica). Consulta el programa, los dorsales y resultados, cómo ver la carrera por TV y online streaming y vídeos de las carreras.'
                    for directory, suffixes in [
                        ('ciclocross/mundial-cx', ['', '/inscritos', '/resultados']),
                        ('en/cyclocross/worlds-cx', ['', '/startlist', '/results']),
                    ]:
                        for suffix in suffixes:
                            source = Path(f'{directory}{suffix}/index.html').read_text()
                            for attribute in ['name="description"', 'property="og:description"', 'name="twitter:description"']:
                                self.assertIn(f'<meta {attribute} content="{html.escape(description,quote=True)}">',source)
                            self.assertNotIn('name="keywords"',source)
                            self.assertIn('/js/cx-race.js',source)
            finally:
                os.chdir(cwd)

    def test_feed_respects_window_and_preserves_cancellation_and_timestamp_zone(self):
        builder = offline_helpers('tools/site/gen_sitemap.py')
        race = {**self.race,'isCancelled':True}
        items = builder['cx_feed_entries']([race],date(2027,1,30),date(2027,2,10),'2026-09-12T14:00:00Z')
        self.assertEqual(len(items),1)
        feed = ET.fromstring('<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">'+items[0]+'</feed>')
        ns = {'a':'http://www.w3.org/2005/Atom'}
        self.assertEqual(feed.find('a:entry/a:title',ns).text,'[Cancelada] Mundial & CX · 2026-27')
        self.assertEqual(feed.find('a:entry/a:published',ns).text,'2026-09-12T10:00:00Z')
        self.assertIn('dorsales',feed.find('a:entry/a:summary',ns).text)
        self.assertNotIn('inscritos',feed.find('a:entry/a:summary',ns).text)
        self.assertIn('y vídeos de las carreras.',feed.find('a:entry/a:summary',ns).text)
        self.assertIn('Ciclocross',[c.attrib['term'] for c in feed.findall('a:entry/a:category',ns)])
        self.assertEqual(builder['cx_feed_entries']([race],date(2027,2,1),date(2027,2,10),'2026-09-12T14:00:00Z'),[])

    def test_all_sections_share_header_assets_navigation_and_spanish_seo(self):
        builder = offline_helpers('tools/site/gen_og_pages.py')
        with tempfile.TemporaryDirectory() as temp:
            cwd = os.getcwd()
            try:
                os.chdir(temp)
                builder['generate_cx_pages']([self.race])
                for directory,suffixes in [('ciclocross/mundial-cx',['','/inscritos','/resultados']),
                                           ('en/cyclocross/worlds-cx',['','/startlist','/results'])]:
                    for suffix in suffixes:
                        source = Path(f'{directory}{suffix}/index.html').read_text()
                        self.assertEqual(source.count('<h1>'),1)
                        self.assertIn('<div class="static-prerender">',source)
                        self.assertNotIn('<div class="static-prerender static-prerender--visible">',source)
                        self.assertNotIn('cx-race-summary',source)
                        self.assertNotIn('>Inscritos<',source)
                        self.assertEqual(source.count('href="https://www.uci.org/"'),1)
                        self.assertIn('<h1>Worlds &amp; CX</h1>' if directory.startswith('en/') else '<h1>Mundial &amp; CX</h1>',source)
                        for section in ['programme','startlist','results','tv']:
                            self.assertIn(f'data-cx-section-link="{section}"',source)
                        self.assertIn('cx-race-docs"><div class="asset-links"><a class="asset-btn" href="https://www.uci.org/"',source)
                        self.assertIn('?view=programme',source)
                        self.assertIn('?view=tv',source)
                        self.assertNotIn('data-cx-section-link="videos"',source)
                        prefix = 'Dorsales · ' if suffix in ['/inscritos','/startlist'] else 'Resultados · ' if suffix else ''
                        self.assertIn(f'<title>{prefix}Mundial &amp; CX — Calendario Ciclismo App</title>',source)
                        self.assertIn('name="last-modified" content="2026-09-12"',source)
                builder['generate_cx_pages']([{**self.race,'cx_videos':[{'id':'clip','url':'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}]}])
                source = Path('ciclocross/mundial-cx/index.html').read_text()
                self.assertIn('data-cx-section-link="videos"',source)
            finally:
                os.chdir(cwd)

    def test_national_class_and_missing_optional_fields_do_not_invent_uci_class_or_tournament(self):
        builder = offline_helpers('tools/site/gen_og_pages.py')
        title,description = builder['cx_race_seo']({**self.race,'class':'NAC','venue':None,'countryCode':None,'cx_tournaments':None})
        self.assertIn('de categoría nacional.',description)
        self.assertNotIn('UCI NAC',title+description)
        self.assertNotIn('Pertenece',description)
        self.assertNotIn('None',description)

    def test_country_without_venue_and_no_automatic_year_or_duplicate_series_season(self):
        builder = offline_helpers('tools/site/gen_og_pages.py')
        title,description = builder['cx_race_seo']({**self.race,'name':'Carrera CX 2026','venue':None,
            'countryCode':'ca','cx_tournaments':{'name':'Circuito CX 2026-27'}},'startlist')
        self.assertEqual(title,'Dorsales · Carrera CX 2026 — Calendario Ciclismo App')
        self.assertIn('en Canadá.',description)
        self.assertNotIn('viernes,',description)
        self.assertNotIn('Inscritos',title+description)
        self.assertEqual(description.count('2026-27'),1)

    def test_agenda_english_metadata_and_language_links(self):
        spec = importlib.util.spec_from_file_location('cx_i18n_builder',ROOT/'tools/build-i18n-html.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            module.OUT_ROOT = Path(temp)
            module.build_page('ciclocross.html','en/cyclocross')
            source = (Path(temp)/'en/cyclocross/index.html').read_text()
            self.assertIn('<html lang="en">',source)
            description = 'Calendario de ciclocross UCI 2026-27: horarios por categoría, dorsales, resultados y clasificaciones de la Copa del Mundo, Superprestige, X2O y Copa de España.'
            for attribute in ['name="description"', 'property="og:description"', 'name="twitter:description"']:
                self.assertIn(f'<meta {attribute} content="{description}">',source)
            self.assertNotIn('name="keywords"',source)
            self.assertIn('hreflang="es" href="https://calendariociclismo.app/ciclocross/"',source)
            self.assertIn('rel="canonical" href="https://calendariociclismo.app/en/cyclocross/"',source)

    def test_inactive_months_have_no_page_or_feed_even_with_old_data(self):
        pages = offline_helpers('tools/site/gen_og_pages.py')
        feed = offline_helpers('tools/site/gen_sitemap.py')
        rows = [{**self.race,'dateKey':f'2027-{month:02d}-01','endDateKey':None} for month in range(3,8)]
        with tempfile.TemporaryDirectory() as temp:
            cwd = os.getcwd()
            try:
                os.chdir(temp)
                self.assertEqual(pages['generate_cx_pages'](rows),0)
                self.assertFalse(Path('ciclocross').exists())
                self.assertEqual(feed['cx_feed_entries'](rows,date(2027,3,1),date(2027,7,31),'2026-09-12T14:00:00Z'),[])
            finally:
                os.chdir(cwd)


if __name__=='__main__':
    unittest.main()
