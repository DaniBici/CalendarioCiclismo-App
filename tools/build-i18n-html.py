#!/usr/bin/env python3
"""
build-i18n-html.py — Genera las páginas EN desde los HTML maestros ES.

Para cada HTML raíz marcado con data-i18n, genera su equivalente EN en en/:
  index.html        → en/index.html
  mes.html          → en/month/index.html
  temporada.html    → en/season/index.html
  about.html        → en/about/index.html
  buscar.html       → en/search/index.html
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
PAGES = [
    ("index.html",              "en"),
    ("mes.html",                "en/month"),
    ("temporada.html",          "en/season"),
    ("about.html",              "en/about"),
    ("buscar.html",             "en/search"),
    ("privacidad.html",         "en/privacy"),
    ("404.html",                "en/404"),
    ("suscripcion/index.html",  "en/subscription"),
    ("betaandroid.html",        "en/beta"),
]

# ── Mapeo de hrefs internos ES → EN ──────────────────────────────
HREF_MAP = {
    "/index.html":            "/",
    "index.html":             "/",
    "/mes.html":              "/month/",
    "mes.html":               "/month/",
    "/temporada.html":        "/season/",
    "temporada.html":         "/season/",
    "/about.html":            "/about/",
    "about.html":             "/about/",
    "/buscar.html":           "/search/",
    "buscar.html":            "/search/",
    "/privacidad.html":       "/privacy/",
    "privacidad.html":        "/privacy/",
    "/betaandroid.html":      "/beta/",
    "betaandroid.html":       "/beta/",
    "/suscripcion/":          "/subscription/",
    "suscripcion/":           "/subscription/",
    "/competicion/":          "/race/",
    "/jornada/":              "/stage/",
    "/inscritos/":            "/startlist/",
    "/perfil/":               "/profile/",
}

# ── Bloques <main> EN para páginas con contenido largo ───────────
# Reemplazan el <main>...</main> del fuente ES íntegro.
MAIN_BLOCKS_EN = {
    "about.html": """\
  <main style="max-width:680px;margin:0 auto;padding:3rem 1.5rem;box-sizing:border-box;text-align:center">
    <h1 style="font-family:var(--font-display);font-weight:700;font-size:2rem;
               text-transform:uppercase;letter-spacing:-0.01em;margin-bottom:2rem">
      About Me
    </h1>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">
      <a href="/" style="font-weight:700;color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Calendario Ciclismo</a> aims to make the essential information about professional cycling competitions instantly understandable and accessible.
    </p>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">
      The project launched in April 2026 and is produced by a single person: <a href="https://danisanchez.info" target="_blank" rel="noopener" id="dani-link" style="font-weight:700;color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px;position:relative">Dani Sánchez<span id="dani-photo" style="display:none;position:fixed;z-index:9999;pointer-events:none;border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.4);width:180px"><img src="https://assets.calendariociclismo.app/about/dani-sanchez.jpg" alt="Dani Sánchez" style="width:100%;display:block"></span></a>, a cycling communications professional with two decades of experience.
    </p>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">
      He was a member of the <strong>communications department</strong> at <a href="https://movistarteam.com" target="_blank" rel="noopener" style="font-weight:700;color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Movistar Team</a> (2011–2024) and <strong>digital editor</strong> for the social media and website of <a href="https://eurosport.es" target="_blank" rel="noopener" style="font-weight:700;color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Eurosport Spain</a> (2024–2026). He currently works as head of Spanish-language web content for the <a href="https://www.giroditalia.it/es" target="_blank" rel="noopener" style="font-weight:700;color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">Giro d'Italia</a> (2025–), as well as a freelance professional and lecturer in digital communication.
    </p>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:2rem">
      You can visit Dani's personal website, with all his other work, at the link below. You can also reach him on <a href="https://x.com/danibvo_" target="_blank" rel="noopener" style="font-weight:700;color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">X (Twitter)</a>, <a href="https://linkedin.com/in/danibvo" target="_blank" rel="noopener" style="font-weight:700;color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">LinkedIn</a> or <a href="mailto:hola@danisanchez.info" style="font-weight:700;color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">email</a>.
    </p>
    <a href="https://danisanchez.info" target="_blank" rel="noopener"
       style="display:inline-flex;align-items:center;justify-content:center;
              font-family:var(--font-display);font-weight:600;
              font-size:0.9rem;letter-spacing:0;text-transform:none;
              padding:0.6rem 1.4rem;background:var(--accent);color:#fff;
              border-radius:var(--radius-pill);text-decoration:none;
              transition:filter var(--transition);margin-top:0.5rem"
       onmouseover="this.style.filter='brightness(1.08)'" onmouseout="this.style.filter=''">
      Dani Sánchez's Website
    </a>
    <section style="margin:2rem auto 0;padding:1.4rem 1.5rem;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius)">
      <p style="font-size:0.95rem;line-height:1.8;margin:0;max-width:100%">
        <strong>Calendario Ciclismo is not a business.</strong> All content is free for everyone and will remain so in the future.
        <br><br>
        Running it involves server, database, repository and domain costs. From version 4.3 the apps contain no advertising and every feature is free. The project is funded through voluntary contributions from its Friends and Dani's personal contribution. More information is available via the button below.
      </p>
      <p style="margin:1.5rem 0 0">
        <a href="/en/open/"
           style="display:inline-flex;align-items:center;justify-content:center;
                  font-family:var(--font-display);font-weight:600;
                  font-size:0.9rem;letter-spacing:0;text-transform:none;
                  padding:0.6rem 1.4rem;background:transparent;color:var(--text);
                  border:1px solid var(--border);border-radius:var(--radius-pill);
                  text-decoration:none;transition:border-color var(--transition),color var(--transition)"
           onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
           onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text)'">
          Transparency
        </a>
      </p>
    </section>
  </main>""",

    "privacidad.html": """\
  <main style="max-width:680px;margin:0 auto;padding:3rem 1.5rem;box-sizing:border-box">
    <h1 style="font-family:var(--font-display);font-weight:700;font-size:2rem;text-transform:uppercase;letter-spacing:-0.01em;margin-bottom:0.5rem;text-align:center">Privacy Policy</h1>
    <p style="text-align:center;font-size:0.85rem;color:var(--text-muted);margin-bottom:2rem"><strong>calendariociclismo.app</strong> &mdash; Last updated: 24 August 2026</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">1. Controller and scope</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">The data controller and service provider is <strong>Daniel Sánchez Badorrey</strong>, independent developer of <strong>Calendario Ciclismo</strong> for iOS and Android and of <a href="https://calendariociclismo.app" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">calendariociclismo.app</a>. Contact: <a href="mailto:hola@danisanchez.info" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">hola@danisanchez.info</a>. This policy applies to the website, the apps and their related services.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">2. Data we process</h2>
    <ul style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem;padding-left:1.5rem">
      <li><strong>Notifications:</strong> APNs or FCM technical token, platform, language, region and country group derived from the time zone, selected categories, and followed races, stages or filters. We do not request GPS or precise location.</li>
      <li><strong>Reports and corrections:</strong> if you submit a race-day form, we process your name, email address, report type and text, the affected race day, IP address, user agent and submission date.</li>
      <li><strong>App analytics:</strong> Firebase Analytics uses a pseudonymous app-instance identifier, device and operating-system data, approximate geography and interactions such as screens, searches, viewed content, and support or purchase actions. We do not use IDFA, GAID or cross-app tracking.</li>
      <li><strong>Web analytics:</strong> Google Analytics 4 processes navigation data and measurement cookies only after you accept.</li>
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
      <li><strong>Web analytics:</strong> visit measurement with consent (Article 6(1)(a) and cookie rules).</li>
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
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">App analytics is <strong>initially enabled</strong> and can be disabled at any time under <strong>Settings &rarr; Privacy &rarr; Usage statistics</strong>. The website does not load Google Analytics until you press <strong>Accept</strong>; rejecting or choosing later does not amount to consent. You can reopen <strong>Cookie settings</strong> from the footer. Notification permission can also be withdrawn in system settings.</p>

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
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">We use essential storage for theme, language, preferences, favourites, form control and your cookie choice. Consent is not required where it is strictly necessary. Google Analytics may create measurement cookies only after acceptance. We do not use advertising cookies or advertising profiles. You can withdraw consent through <strong>Cookie settings</strong> and clear storage in your browser.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">11. Advertising and marketing</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">The apps and website do not display ads, integrate advertising networks, or sell or rent data. An email address submitted with a report is used to handle that report, not for marketing.</p>

    <h2 style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-top:2rem;margin-bottom:0.75rem">12. Changes and contact</h2>
    <p style="font-size:0.95rem;line-height:1.8;margin-bottom:1.25rem">We will update this policy when the service, its providers or the law changes. The date above identifies the current version. For any question, write to <a href="mailto:hola@danisanchez.info" style="color:var(--text);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px">hola@danisanchez.info</a>.</p>
  </main>""",

    "betaandroid.html": """  <main class="beta-page">
    <div class="beta-page__icon" style="color:var(--accent);opacity:0.85">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" fill="currentColor" width="64" height="64" aria-hidden="true"><path d="M420.55 301.93a24 24 0 1 1 24-24 24 24 0 0 1-24 24m-265.1 0a24 24 0 1 1 24-24 24 24 0 0 1-24 24m273.7-144.48 47.94-83a10 10 0 1 0-17.27-10l-48.54 84.07a301.25 301.25 0 0 0-246.56 0L116.18 64.45a10 10 0 1 0-17.27 10l47.94 83C64.53 202.22 8.24 285.55 0 384h576c-8.24-98.45-64.54-181.78-146.85-226.55"/></svg>
    </div>
    <h1 class="beta-page__title">Android on Google Play</h1>
    <p class="beta-page__sub">
      The Calendario Ciclismo app is now publicly available on Google Play.<br>
      Download it for free and enjoy the professional cycling calendar with schedules, TV, routes and notifications.
    </p>

    <a href="https://play.google.com/store/apps/details?id=app.calendariociclismo.android" target="_blank" rel="noopener" class="beta-form__submit" style="display:inline-block;text-decoration:none;margin-bottom:2rem">Download on Google Play</a>

    <p class="beta-note" style="margin-top:2rem">
      We'd like to thank the nearly 200 people who took part in the beta. Your help was essential in getting us here.
    </p>
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

def patch_seo_meta(html: str) -> str:
    """Conserva el SEO castellano del HTML maestro.

    Decisión de producto: las URL /en/ traducen la interfaz, pero title,
    description, OG, Twitter y JSON-LD se sirven en castellano. Nunca usar el
    diccionario EN para reescribir estos campos: el artifact de Pages se
    regenera en cada despliegue y esa sustitución reintroduciría SEO inglés.
    """
    return html

# ── Sustituciones de texto JS inline por página ──────────────────
PAGE_JS_EN = {
    "betaandroid.html": [
        (">Privacidad<", ">Privacy<"),
    ],
}

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
    base_en = "https://calendariociclismo.app/en"
    en_url  = base_en + ("/" if en_path == "en" else f"/{en_path.removeprefix('en/')}/")

    # Canonical → EN URL
    html = re.sub(
        r'<link rel="canonical" href="[^"]*"',
        f'<link rel="canonical" href="{en_url}"',
        html,
    )
    # Reemplazar hreflang existentes (con o sin / de cierre)
    html = re.sub(r'<link rel="alternate" hreflang="[^"]*" href="[^"]*"\s*/?>', '', html)

    # Insertar hreflangs correctos justo tras la canonical
    hreflangs = (
        f'\n  <link rel="alternate" hreflang="en" href="{en_url}"/>'
        f'\n  <link rel="alternate" hreflang="es" href="{base_es}/"/>'
        f'\n  <link rel="alternate" hreflang="x-default" href="{base_es}/"/>'
    )
    html = html.replace(
        f'<link rel="canonical" href="{en_url}">',
        f'<link rel="canonical" href="{en_url}">{hreflangs}',
    )

    # og:url
    html = re.sub(r'og:url" content="[^"]*"', f'og:url" content="{en_url}"', html)

    return html

def patch_hrefs(html: str) -> str:
    """Reescribe hrefs internos de ES a EN y ajusta textos de navegación."""
    for es_href, en_href in HREF_MAP.items():
        html = html.replace(f'href="{es_href}"', f'href="{en_href}"')
        html = html.replace(f"href='{es_href}'", f"href='{en_href}'")
    # Textos hardcodeados del footer y nav que no tienen data-i18n.
    # La marca "Calendario Ciclismo" NO se traduce: las apps usan ese mismo
    # nombre en su locale EN (values-en/strings.xml app_name), así que la web
    # EN servida en /en/ lo mantiene por coherencia.
    html = html.replace('href="/privacy/">Privacidad<', 'href="/privacy/">Privacy<')
    # El JSON-LD es SEO: se conserva en castellano como el resto del <head>.
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
    html = patch_seo_meta(html)
    html = patch_main_block(html, src_rel)
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
    print(f"build-i18n-html.py — generando páginas EN en {OUT_ROOT}…")
    for src, out in PAGES:
        build_page(src, out)
    print("Listo.")

if __name__ == "__main__":
    main()
