#!/usr/bin/env python3
"""
build-i18n-html.py — Genera las páginas EN desde los HTML maestros ES.

Para cada HTML raíz marcado con data-i18n, genera su equivalente EN en en/:
  index.html        → en/index.html
  privacidad.html   → en/privacy/index.html
  404.html          → en/404.html
  suscripcion/      → en/subscription/index.html

Uso:
  python3 tools/build-i18n-html.py
"""

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
EN_JSON = ROOT / "i18n" / "en.json"

# Destino de las páginas generadas. Por defecto el propio repo; --out lo cambia
# (ver main()). Las FUENTES se leen siempre de ROOT, se escriba donde se escriba.
OUT_ROOT = ROOT

with open(EN_JSON, encoding="utf-8") as f:
    EN = json.load(f)

def t(key: str):
    """Resuelve una clave dot-path en el diccionario EN."""
    parts = key.split(".")
    val = EN
    for p in parts:
        if not isinstance(val, dict):
            return None
        val = val.get(p)
    return val if isinstance(val, str) else None

# ── Mapeo HTML fuente → directorio de salida ─────────────────────
# Las redirecciones de URLs antiguas (about.html, mes.html, en/month/…) las
# genera tools/site/redirects.py. en/about/ se edita A MANO, como en/open/.
PAGES = [
    ("index.html",              "en"),
    ("ciclocross.html",         "en/cyclocross"),
    ("privacidad.html",         "en/privacy"),
    ("404.html",                "en/404"),
    ("suscripcion/index.html",  "en/subscription"),
]

# ── Mapeo de hrefs internos ES → EN ──────────────────────────────
# Los destinos llevan el prefijo /en/: la web EN se sirve bajo /en/ del
# dominio principal y las rutas limpias sin prefijo devuelven 404.
HREF_MAP = {
    "/":                      "/en/",
    "/ciclocross/":           "/en/cyclocross/",
    "/ciclocross.html":       "/en/cyclocross/",
    "/index.html":            "/en/",
    "index.html":             "/en/",
    "/calendario/":           "/en/calendar/",
    "/calendario.html":       "/en/calendar/",
    "/mes.html":              "/en/month/",
    "mes.html":               "/en/month/",
    "/temporada.html":        "/en/season/",
    "temporada.html":         "/en/season/",
    "/about/":                "/en/about/",
    "/about.html":            "/en/about/",
    "/abierto/":              "/en/open/",
    "/abierto.html":          "/en/open/",
    "/privacidad.html":       "/en/privacy/",
    "privacidad.html":        "/en/privacy/",
    "/apps/":                 "/en/apps/",
    "/apoyar/":               "/en/support/",
    "/betaandroid.html":      "/en/apps/",
    "betaandroid.html":       "/en/apps/",
    "/suscripcion/":          "/en/subscription/",
    "suscripcion/":           "/en/subscription/",
    "/competicion/":          "/en/race/",
    "/jornada/":              "/en/stage/",
    "/inscritos/":            "/en/startlist/",
    "/perfil/":               "/en/profile/",
}

# ── Bloques <main> EN para páginas con contenido largo ───────────
# Reemplazan el <main>...</main> del fuente ES íntegro.
MAIN_BLOCKS_EN = {
    "privacidad.html": """\
  <main class="cc-public-document" style="">
    <h1 style="font-family:var(--font-display);font-weight:700;font-size:2rem;text-transform:uppercase;letter-spacing:-0.01em;margin-bottom:0.5rem;text-align:center">Privacy Policy</h1>
    <p style="text-align:center;font-size:0.85rem;color:var(--text-muted);margin-bottom:2rem"><strong>calendariociclismo.app</strong> - Last updated: 24 August 2026</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">1. Controller and scope</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">The data controller and service provider is <strong>Daniel Sánchez Badorrey</strong>, independent developer of <strong>Calendario Ciclismo</strong> for iOS and Android and of <a href="https://calendariociclismo.app" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">calendariociclismo.app</a>. Contact: <a href="mailto:hola@danisanchez.info" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">hola@danisanchez.info</a>. This policy applies to the website, the apps and their related services.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">2. Data we process</h2>
    <ul style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem;padding-left:1.5rem">
      <li><strong>Notifications:</strong> APNs or FCM technical token, platform, language, region and country group derived from the time zone, selected categories, and followed races, stages or filters. We do not request GPS or precise location.</li>
      <li><strong>Reports and corrections:</strong> if you submit a race-day form, we process your name, email address, report type and text, the affected race day, IP address, user agent and submission date.</li>
      <li><strong>App analytics:</strong> Firebase Analytics uses a pseudonymous app-instance identifier, device and operating-system data, approximate geography and interactions such as screens, searches, viewed content, and support or purchase actions. We do not use IDFA, GAID or cross-app tracking.</li>
      <li><strong>Web analytics:</strong> Google Analytics 4 processes navigation data and measurement cookies after the cookie notice is accepted; the notice auto-accepts 10 seconds after it is shown unless you reject it first.</li>
      <li><strong>Purchases:</strong> Apple or Google handles payment. The app receives the technical confirmation, product and status required to recognise Amigo, contributions or historical Premium; we do not receive card or billing-address details. If app analytics is enabled, the product and purchase action may be recorded, but not banking details.</li>
      <li><strong>Local and technical data:</strong> preferences, favourites, caches, purchase state and privacy choices are stored on the device or browser. Hosting providers may generate technical logs, such as IP, date, requested resource and user agent, for security and operation.</li>
    </ul>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">We do not require a user account and we do not sell personal data.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">3. Purposes and legal bases</h2>
    <ul style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem;padding-left:1.5rem">
      <li><strong>Provide and protect the service:</strong> operation, security, abuse prevention and diagnostics, based on performance of the requested service and legitimate interests (Articles 6(1)(b) and 6(1)(f) GDPR).</li>
      <li><strong>Push notifications:</strong> send the notifications you select, with your consent (Article 6(1)(a)).</li>
      <li><strong>Reports and corrections:</strong> receive, verify and respond to information you voluntarily submit, based on the legitimate interest in keeping the calendar accurate and handling the request (Article 6(1)(f)).</li>
      <li><strong>App analytics:</strong> understand use and improve stability and design, based on legitimate interests (Article 6(1)(f)), with an immediate right to object under <strong>Settings &rarr; Privacy &rarr; Usage statistics</strong>.</li>
      <li><strong>Web analytics:</strong> visit measurement in line with the cookie notice (Article 6(1)(a) and cookie rules).</li>
      <li><strong>Voluntary purchases:</strong> process and recognise the requested purchase (Article 6(1)(b)).</li>
    </ul>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">4. Recipients, processors and transfers</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">We use <strong>Supabase</strong> (EU-hosted database), <strong>Google Firebase</strong> (Analytics and FCM), <strong>Google Analytics</strong>, <strong>Apple</strong> (APNs and App Store), <strong>Google Play</strong> and <strong>Resend</strong> (email delivery for reports). The website and its resources may be served through GitHub Pages, Cloudflare, Hetzner and Cloudflare R2. When you open maps, links or embedded streams, the relevant external provider may receive the request and its technical data.</p>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">Some providers are outside the European Economic Area or may process data from third countries. In those cases, GDPR mechanisms such as adequacy decisions or standard contractual clauses apply according to the provider's configuration and terms. See <a href="https://supabase.com/privacy" target="_blank" rel="noopener" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Supabase</a>, <a href="https://policies.google.com/privacy" target="_blank" rel="noopener" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Google</a>, <a href="https://www.apple.com/legal/privacy/" target="_blank" rel="noopener" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Apple</a> and <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Resend</a>.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">5. Retention</h2>
    <ul style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem;padding-left:1.5rem">
      <li><strong>Reports and corrections:</strong> up to 12 months; Supabase runs an automatic daily cleanup.</li>
      <li><strong>Notifications:</strong> while enabled. After disabling them, the inactive record may remain for up to 30 days before cleanup. <strong>Delete my data</strong> immediately deletes the server-side notification record.</li>
      <li><strong>Analytics:</strong> collection stops when you disable it or withdraw consent. GA4 user- and event-level data is retained for up to 14 months under the configured setting; standard aggregated reports may be retained for longer.</li>
      <li><strong>Local data:</strong> until you clear the app or browser data or uninstall. Information required for legal obligations or claims may be retained for the applicable periods.</li>
    </ul>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">6. Your privacy controls</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">App analytics is <strong>initially enabled</strong> and can be disabled at any time under <strong>Settings &rarr; Privacy &rarr; Usage statistics</strong>. The website loads Google Analytics when the cookie notice is accepted; the notice auto-accepts 10 seconds after it is shown unless you press <strong>Reject</strong> first. You can reopen <strong>Cookie settings</strong> from the footer. Notification permission can also be withdrawn in system settings.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">7. Your rights</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:0.5rem">You may request access, rectification, erasure, restriction, objection and portability where applicable, and withdraw consent without affecting earlier processing. Write to <a href="mailto:hola@danisanchez.info" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">hola@danisanchez.info</a>. We may request reasonable verification details to locate a specific report.</p>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem"><strong>Delete my data</strong> in the app deletes the server-side notification record; for submitted reports or other data, use the email above. You may also complain to the <a href="https://www.aepd.es" target="_blank" rel="noopener" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Spanish Data Protection Agency</a> or your local supervisory authority.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">8. Security and children</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">We apply access controls, encryption in transit, security rules and data minimisation. No system is infallible. The service is not specifically directed at children and does not knowingly request children's data; contact us if you identify such a submission.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">9. Amigo, contributions and historical Premium</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">Calendario Ciclismo is free, complete and ad-free. Amigo grants a cosmetic icon while the subscription is active; one-off contributions only display a thank-you. Premium is no longer sold and is not automatically converted into Amigo. Indicative prices are €2.99/month, €17.99/year and contributions of €2.99, €5.99 and €11.99; the price and currency shown by the store before confirmation always prevail.</p>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem"><strong>Renewal and cancellation.</strong> Amigo renews automatically under the terms shown by the App Store or Google Play until cancelled. On iOS, manage it in <a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Apple Subscriptions</a>; on Android, in Google Play &rarr; Payments & subscriptions &rarr; Subscriptions. Cancellation prevents future renewals and access continues until the end of the paid period.</p>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem"><strong>Refunds and withdrawal.</strong> iOS purchase requests are submitted to <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Apple</a>; Android requests through <a href="https://support.google.com/googleplay/workflow/9813244" target="_blank" rel="noopener" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Google Play</a> or developer channels where applicable. Store terms and mandatory consumer rights apply, including withdrawal rights where legally applicable.</p>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem"><strong>Founder.</strong> A previous Premium purchase may be recognised as Founder. On iOS, Restore Purchases can detect historical transactions. On Android, an already-expired Premium subscription may not be recoverable after clearing data or reinstalling if Google Play does not return that historical purchase and no local copy exists; contact us so we can review the case.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">10. Cookies and browser storage</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">We use essential storage for theme, language, preferences, favourites, form control and your cookie choice. Consent is not required where it is strictly necessary. Google Analytics may create measurement cookies after the cookie notice is accepted, automatically after 10 seconds unless rejected first. We do not use advertising cookies or advertising profiles. You can withdraw consent through <strong>Cookie settings</strong> and clear storage in your browser.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">11. Advertising and marketing</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">The apps and website do not display ads, integrate advertising networks, or sell or rent data. An email address submitted with a report is used to handle that report, not for marketing.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">12. Changes and contact</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">We will update this policy when the service, its providers or the law changes. The date above identifies the current version. For any question, write to <a href="mailto:hola@danisanchez.info" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">hola@danisanchez.info</a>.</p>
  </main>""",
}

def apply_translations(html: str) -> str:
    """Sustituye data-i18n markers por el texto EN correspondiente."""

    # 1) data-i18n-attr="ATTR" data-i18n="key" → sustituye el valor del atributo ATTR
    def replace_attr(m):
        full_tag = m.group(0)
        attr = m.group(1)
        key  = m.group(2)
        val  = t(key)
        if val is None:
            return full_tag
        return re.sub(rf'{attr}="[^"]*"', f'{attr}="{val}"', full_tag, count=1)

    html = re.sub(
        r'<[^>]+data-i18n-attr="(\w+)"[^>]*data-i18n="([^"]+)"[^>]*>',
        replace_attr,
        html,
    )

    # 2) data-i18n="key" → sustituye el texto entre el tag y su cierre inmediato
    #    Soporta elementos con contenido textual simple (no anidados)
    def replace_text(m):
        open_tag  = m.group(1)   # tag de apertura completo
        key       = m.group(2)
        close_tag = m.group(3)   # tag de cierre, ej </a>
        val = t(key)
        if val is None:
            return m.group(0)
        return f'{open_tag}{val}{close_tag}'

    # Captura <TAG ... data-i18n="key" ...>TEXTO</TAG>  (texto sin '<')
    html = re.sub(
        r'(<[^>]+\bdata-i18n="([^"]+)"[^>]*>)[^<]*(</\w+>)',
        replace_text,
        html,
    )

    return html

# ── Cabecera SEO EN por página ───────────────────────────────────
# Las páginas /en/ llevan cabecera en inglés y conservan el robots del maestro
# (decisión de Dani, 2026-09-30). og:title/twitter:title toman `title` y
# og:description toma `description` si no se indican; twitter:description toma
# og:description.
# `jsonld` son sustituciones literales dentro del JSON-LD del maestro.
HOME_DESC_EN = "All professional cycling races with schedule, route, profile and how to watch on TV and streaming."
PAGE_SEO_EN = {
    "index.html": {
        "title": "Pro Cycling Races Today: Schedule, TV and Streaming - Calendario Ciclismo App",
        "description": HOME_DESC_EN,
        "keywords": "cycling calendar, cycling on TV, cycling streaming, Tour de France, Giro d'Italia, "
                    "Vuelta a España, Paris-Roubaix, Tour of Flanders, Calendario Ciclismo, Dani Sánchez",
        "jsonld": [("Todas las carreras ciclistas profesionales, con horario, recorrido, perfil y cómo ver por TV y online streaming.",
                    HOME_DESC_EN)],
    },
    "ciclocross.html": {
        "description": "UCI cyclocross calendar 2026-27: schedules by category, startlists, results and standings "
                       "of the World Cup, Superprestige, X2O and Copa de España.",
    },
    "privacidad.html": {
        "title": "Privacy Policy - Calendario Ciclismo App",
        "description": "Privacy policy of Calendario Ciclismo: processing of personal data, user rights and use of cookies.",
        "twitter_description": "Privacy policy of Calendario Ciclismo: processing of personal data and user rights.",
        "keywords": "privacy policy, privacy, data protection, GDPR, calendario ciclismo",
    },
    "404.html": {
        "title": "Page not found - Calendario Ciclismo App",
    },
    "suscripcion/index.html": {
        "title": "Subscribe to the calendar - Calendario Ciclismo",
        "description": "Subscribe to the professional cycling calendar in your calendar app. Choose WorldTour, Pro, "
                       "men, women or all categories. Works with iPhone, iPad, Mac, Android and Google Calendar.",
        "og_description": "Add every professional cycling race to your calendar app. WorldTour, Pro, men, women or all categories.",
        "twitter_description": "Add every professional cycling race to your calendar app.",
    },
}
def _set_meta(html: str, attr: str, name: str, value: str) -> str:
    return re.sub(rf'(<meta {attr}="{re.escape(name)}"[^>]*?\bcontent=")[^"]*(")',
                  lambda m: f"{m.group(1)}{value}{m.group(2)}", html)

def patch_seo_meta(html: str, src_rel: str) -> str:
    """Cabecera SEO en inglés para la página EN."""
    seo = PAGE_SEO_EN.get(src_rel, {})
    title = seo.get("title")
    description = seo.get("description")
    og_description = seo.get("og_description") or description
    if title:
        html = re.sub(r"<title([^>]*)>[^<]*</title>", lambda m: f"<title{m.group(1)}>{title}</title>", html, count=1)
    for attr, name, value in (
        ("name", "description", description),
        ("name", "keywords", seo.get("keywords")),
        ("property", "og:title", seo.get("og_title") or title),
        ("property", "og:description", og_description),
        ("name", "twitter:title", seo.get("twitter_title") or title),
        ("name", "twitter:description", seo.get("twitter_description") or og_description),
    ):
        if value:
            html = _set_meta(html, attr, name, value)
    for old, new in seo.get("jsonld", []):
        html = html.replace(old, new)
    return html

# ── Texto pre-renderizado EN (bloque .static-prerender) ──────────
# Sustituye el contenido del primer bloque .static-prerender del maestro.
PRERENDER_EN = {
    "index.html": """
      <h1>Calendario Ciclismo: every professional race with TV and streaming</h1>
      <p>Calendario Ciclismo is the complete guide to men's and women's professional cycling. Each day lists the races under way with start and finish times, route, stage profile, startlist and every TV channel and streaming platform where they can be followed live, with specific coverage for Spain.</p>
      <p>It covers the three Grand Tours (Tour de France, Giro d'Italia and Vuelta a España), the five Monuments (Milan-San Remo, Tour of Flanders, Paris-Roubaix, Liège-Bastogne-Liège and Il Lombardia), every UCI WorldTour and UCI Women's WorldTour event, the UCI ProSeries and the classics of the continental calendar, as well as national, world and European championships.</p>
      <h2>Main sections</h2>
      <ul>
        <li><a href="/en/">Today</a>: today's races with schedules and where to watch them.</li>
        <li><a href="/en/calendar/?view=month">Monthly calendar</a>: every race of the month.</li>
        <li><a href="/en/calendar/?view=season">Season calendar</a>: every race of the year, filterable by category and country.</li>
        <li><a href="/en/subscription/">Calendar subscription</a>: iCal feeds for Apple, Google and Outlook.</li>
        <li><a href="/en/about/">About</a>: the project, created and edited by Dani Sánchez.</li>
      </ul>
      <h2>Major professional cycling events</h2>
      <ul>
        <li>Tour de France, Giro d'Italia, Vuelta a España.</li>
        <li>Tour de France Femmes, Giro d'Italia Women, La Vuelta Femenina.</li>
        <li>Monuments: Milan-San Remo, Tour of Flanders, Paris-Roubaix, Liège-Bastogne-Liège, Il Lombardia.</li>
        <li>Strade Bianche, Amstel Gold Race, La Flèche Wallonne, Gent-Wevelgem, E3 Saxo Classic, Paris-Roubaix Femmes.</li>
        <li>Paris-Nice, Tirreno-Adriatico, Itzulia Basque Country, Critérium du Dauphiné, Volta a Catalunya.</li>
        <li>UCI Road World and European Championships, road race and time trial.</li>
      </ul>""",
}

def patch_prerender(html: str, src_rel: str) -> str:
    en = PRERENDER_EN.get(src_rel)
    if not en:
        return html
    return re.sub(r'(<div class="static-prerender[^"]*">).*?(\n    </div>)',
                  lambda m: m.group(1) + en + m.group(2), html, count=1, flags=re.DOTALL)

# ── Sustituciones de texto JS inline por página ──────────────────
PAGE_JS_EN = {}

def patch_js_strings(html: str, src_rel: str) -> str:
    """Sustituye strings JS hardcodeados en el HTML de páginas específicas."""
    for old, new in PAGE_JS_EN.get(src_rel, []):
        html = html.replace(old, new)
    return html

def patch_main_block(html: str, src_rel: str) -> str:
    """Reemplaza <main>…</main> con la versión EN si existe en MAIN_BLOCKS_EN."""
    en_main = MAIN_BLOCKS_EN.get(src_rel)
    if not en_main:
        return html
    return re.sub(r'<main\b[^>]*>.*?</main>', en_main, html, count=1, flags=re.DOTALL)

def patch_lang(html: str) -> str:
    return re.sub(r'lang="es"', 'lang="en"', html)

def patch_locale(html: str) -> str:
    html = html.replace('og:locale" content="es_ES"', 'og:locale" content="en_GB"')
    html = html.replace("es-ES", "en-GB")
    return html

def patch_canonical(html: str, en_path: str) -> str:
    """Ajusta canonical y hreflang para páginas EN."""
    base_es = "https://calendariociclismo.app"
    source_canonical = re.search(r'<link rel="canonical" href="([^"]+)"', html)
    es_url = (source_canonical.group(1) if source_canonical and
              source_canonical.group(1).startswith(base_es + "/")
              else base_es + "/")
    base_en = "https://calendariociclismo.app/en"
    en_url  = base_en + ("/" if en_path == "en" else f"/{en_path.removeprefix('en/')}/")

    # Canonical → EN URL
    html = re.sub(
        r'<link rel="canonical" href="[^"]*"',
        f'<link rel="canonical" href="{en_url}"',
        html,
    )
    # Reemplazar hreflang existentes (con o sin / de cierre)
    html = re.sub(r'(?:\n[ \t]*)?<link rel="alternate" hreflang="[^"]*" href="[^"]*"\s*/?>', '', html)

    # Insertar hreflangs correctos justo tras la canonical
    hreflangs = (
        f'\n  <link rel="alternate" hreflang="en" href="{en_url}"/>'
        f'\n  <link rel="alternate" hreflang="es" href="{es_url}"/>'
        f'\n  <link rel="alternate" hreflang="x-default" href="{es_url}"/>'
    )
    html = html.replace(
        f'<link rel="canonical" href="{en_url}">',
        f'<link rel="canonical" href="{en_url}">{hreflangs}',
    )

    # og:url
    html = re.sub(r'og:url" content="[^"]*"', f'og:url" content="{en_url}"', html)

    return html

CALENDAR_VIEW_EN = {"mes": "month", "temporada": "season"}

def en_query(en_href: str, query: str) -> str:
    """Traduce la query de /en/calendar/: ?vista=mes|temporada&mes=AAAA-MM
    pasa a ?view=month|season&month=AAAA-MM (js/calendario-query.js)."""
    if en_href != "/en/calendar/":
        return query
    def param(m):
        key, value = m.group(2), m.group(3)
        if key == "vista":
            key, value = "view", CALENDAR_VIEW_EN.get(value, value)
        elif key == "mes":
            key = "month"
        return f"{m.group(1)}{key}={value}"
    return re.sub(r"([?&]|&amp;)(vista|mes)=([^&#]*)", param, query)

def patch_hrefs(html: str) -> str:
    """Reescribe hrefs internos de ES a EN y ajusta textos de navegación."""
    for es_href, en_href in HREF_MAP.items():
        html = html.replace(f'href="{es_href}"', f'href="{en_href}"')
        html = html.replace(f"href='{es_href}'", f"href='{en_href}'")
        # Variante con query (?vista=…, ?date=…): /calendario/?vista=mes
        html = re.sub(
            rf'href="{re.escape(es_href)}(\?[^"]*)"',
            lambda m: f'href="{en_href}{en_query(en_href, m.group(1))}"',
            html,
        )
        html = re.sub(
            rf"href='{re.escape(es_href)}(\?[^']*)'",
            lambda m: f"href='{en_href}{en_query(en_href, m.group(1))}'",
            html,
        )
    # Textos hardcodeados del footer y nav que no tienen data-i18n.
    # La marca "Calendario Ciclismo" NO se traduce: las apps usan ese mismo
    # nombre en su locale EN (values-en/strings.xml app_name), así que la web
    # EN servida en /en/ lo mantiene por coherencia.
    html = html.replace('href="/en/privacy/">Privacidad<', 'href="/en/privacy/">Privacy<')
    html = html.replace('Ideado y editado por', 'Created and edited by')
    html = html.replace("aria-label=\"Menú\"", 'aria-label="Menu"')
    html = html.replace('aria-label="Ordenar carreras"', 'aria-label="Sort races"')
    html = html.replace("title=\"Buscar\"", 'title="Search"')
    html = html.replace('title="Cambiar tema"', 'title="Change theme"')
    html = html.replace('>Mes<', '>Month<')
    html = html.replace('>Sobre<', '>About<')
    return html

def patch_asset_paths(html: str) -> str:
    """Convierte rutas relativas de assets a absolutas para páginas en /en/*.
    css/app.css → /css/app.css, js/foo.js → /js/foo.js, etc.
    """
    # <link rel="stylesheet" href="css/...">
    html = re.sub(r'href="(css/[^"]+)"', r'href="/\1"', html)
    # <script src="js/...">
    html = re.sub(r'src="(js/[^"]+)"', r'src="/\1"', html)
    # favicon y otros assets en href sin protocolo
    html = re.sub(r'href="(favicon[^"]+)"', r'href="/\1"', html)
    html = re.sub(r'href="(apple-touch[^"]+)"', r'href="/\1"', html)
    return html

def build_page(src_rel: str, out_dir: str) -> None:
    src = ROOT / src_rel
    if not src.exists():
        print(f"  SKIP {src_rel} (not found)")
        return

    # 404 → en/404.html (no en/404/index.html)
    if out_dir == "en/404":
        out = OUT_ROOT / "en" / "404.html"
    else:
        out = OUT_ROOT / out_dir / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)

    html = src.read_text(encoding="utf-8")
    html = patch_lang(html)
    html = patch_locale(html)
    html = patch_seo_meta(html, src_rel)
    html = patch_main_block(html, src_rel)
    html = patch_prerender(html, src_rel)
    html = patch_js_strings(html, src_rel)
    html = apply_translations(html)
    html = patch_hrefs(html)
    html = patch_asset_paths(html)
    html = patch_canonical(html, out_dir)

    out.write_text(html, encoding="utf-8")
    print(f"  OK  {src_rel} → {out_dir}/index.html")

def main():
    global OUT_ROOT
    # --out <dir>: escribe las páginas EN fuera del repo (lo usa build-site.yml
    # para componer _site sin ensuciar el árbol de trabajo). Sin el flag el
    # comportamiento es el de siempre: escribir en en/ dentro del repo.
    if "--out" in sys.argv:
        OUT_ROOT = Path(sys.argv[sys.argv.index("--out") + 1]).resolve()
        OUT_ROOT.mkdir(parents=True, exist_ok=True)
    print(f"build-i18n-html.py - generando páginas EN en {OUT_ROOT}…")
    for src, out in PAGES:
        build_page(src, out)
    print("Listo.")

if __name__ == "__main__":
    main()
