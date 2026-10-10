#!/usr/bin/env python3
"""Bloques regenerables de Pages. La caché nunca contiene fuentes ni config.js."""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

import version_assets
from check_seo_output import check_paths, check_site

ROOT = Path(__file__).resolve().parents[2]
CACHE_ROOT = ROOT / ".pages-generated"
STATE_PATH = ROOT / ".pages-build-state.json"
CONTRACT_VERSION = 2
BLOCKS = {
    "og-races": ("archived_seasons.py",),
    "og-stages": ("archived_seasons.py",),
    "og-results": ("archived_seasons.py", "results_routes.py"),
    "og-extras": ("archived_seasons.py",),
    "og-cx": ("archived_seasons.py", "cx_calendar.py"),
    "sitemap": ("gen_sitemap.py", "archived_seasons.py", "cx_calendar.py", "results_routes.py",
                "gen_asset_canonicals.py"),
    "feeds": ("gen_feeds.py",),
}
# Generadores que completan un bloque tras su generador principal (BLOCKS[b][0]).
# Se regeneran enteros también en la ampliación incremental.
EXTRA_GENERATORS = {"sitemap": ("gen_asset_canonicals.py",)}
ASSET_CANONICALS = "asset-canonicals.json"
OG_FAMILIES = {
    "og-races": ("competicion", "en/race"),
    "og-stages": ("jornada", "en/stage"),
    "og-results": ("resultados", "en/results"),
    "og-extras": ("inscritos", "en/startlist", "orden-salida", "en/start-order",
                  "perfil", "en/profile", "mapa", "en/route-map"),
    "og-cx": ("ciclocross", "en/cyclocross"),
}
OG_DIRS = tuple(directory for directories in OG_FAMILIES.values() for directory in directories)
SOURCE_INDEXES = ("resultados/index.html", "en/results/index.html",
                  "ciclocross/index.html", "en/cyclocross/index.html")
# Bloques que un dispatch incremental amplía o regenera.
STAGE_BLOCKS = ("og-races", "og-stages", "og-extras", "sitemap", "feeds")
STAGE_OG_BLOCKS = ("og-races", "og-stages", "og-extras")
STAGE_DELTA_ROOT = CACHE_ROOT / "_stage-delta"
STAGE_RUN_NAME = "stage-incremental"
TURN_POLL_SECONDS = 20
TURN_LIMIT_SECONDS = 90 * 60


def utc_now():
    return datetime.now(timezone.utc)


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def output(name, value):
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            key = name.replace("-", "_")
            stream.write(f"{key}={str(value).lower() if isinstance(value, bool) else value}\n")


def og_family_source(source, family):
    """Incluye helpers/consultas comunes y solo los tramos que emiten la familia."""
    def part(start, end=None):
        left = source.index(start)
        return source[left:source.index(end, left)] if end else source[left:]

    shared = source[:source.index("# ── COMPETICIONES: páginas ──")]
    shared += part("# ── JORNADAS ──", "# ── JORNADAS: páginas ──")
    sections = {
        "og-races": (("# ── COMPETICIONES: páginas ──", "# ── JORNADAS ──"),
                     ("# EN — competiciones", "# EN — jornadas")),
        "og-stages": (("# ── JORNADAS: páginas ──", "# ── INSCRITOS ──"),
                      ("# EN — jornadas", "# EN — inscritos")),
        "og-results": (("# ── RESULTADOS (UCI in-house) ──", "# ── PERFILES DE ELEVACIÓN ──"),),
        "og-extras": (("# ── INSCRITOS ──", "# ── RESULTADOS (UCI in-house) ──"),
                      ("# ── PERFILES DE ELEVACIÓN ──", "# ── PÁGINAS EN ──"),
                      ("# EN — inscritos", "# CC-CX: páginas independientes")),
        "og-cx": (("# CC-CX: páginas independientes", None),),
    }
    return shared + "".join(part(start, end) for start, end in sections[family])


def cache_prefix(block, now=None, root=ROOT):
    now = now or utc_now()
    inputs = {
        "contract": CONTRACT_VERSION,
        "python": list(sys.version_info[:2]),
        "sources": {name: digest(root / "tools/site" / name) for name in BLOCKS[block]},
    }
    if block in OG_FAMILIES:
        source = (root / "tools/site/gen_og_pages.py").read_text(encoding="utf-8")
        inputs["sources"]["gen_og_pages.py"] = hashlib.sha256(
            og_family_source(source, block).encode()).hexdigest()
    if block in OG_FAMILIES or block == "sitemap":
        inputs["en_base_url"] = os.environ.get("EN_BASE_URL", "https://calendariociclismo.app/en")
    fingerprint = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
    return f"pages-generated-v{CONTRACT_VERSION}-{block}-{now:%Y-%m-%d}-{fingerprint}-"


def github_json(path, token):
    request = Request(
        f"https://api.github.com/repos/{path}",
        headers={"Accept": "application/vnd.github+json",
                 "Authorization": f"Bearer {token}",
                 "X-GitHub-Api-Version": "2022-11-28"},
    )
    with urlopen(request, timeout=15) as response:
        return json.loads(response.read())


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def latest_requests(repository, token, run_number=None):
    """Devuelve la última solicitud completa y el último incremental anterior.

    Incluye solicitudes canceladas: la cancelación no satisface el refresco, y
    un incremental cancelado o fallido obliga a regenerar sus bloques."""
    latest = {"full": None, "stage": None}
    for event in ("schedule", "workflow_dispatch"):
        query = urlencode({"branch": "main", "event": event, "per_page": 100})
        runs = github_json(f"{repository}/actions/workflows/build-site.yml/runs?{query}", token)["workflow_runs"]
        for run in runs:
            if run["event"] != event or run["head_branch"] != "main":
                raise ValueError("Solicitud de refresco incompatible")
            if run.get("display_title", "") == STAGE_RUN_NAME:
                if run_number is None or run["run_number"] >= run_number:
                    continue
                kind = "stage"
            else:
                kind = "full"
            requested = parse_time(run["created_at"])
            latest[kind] = max(latest[kind], requested) if latest[kind] else requested
    return tuple(latest[kind].isoformat() if latest[kind] else None for kind in ("full", "stage"))


def earlier_active_runs(runs, own):
    """Ejecuciones de la misma rama iniciadas antes que ésta y aún sin terminar."""
    def order(run):
        return parse_time(run.get("run_started_at") or run["created_at"]), run["id"]

    return [run for run in runs
            if run["id"] != own["id"] and run["status"] != "completed"
            and run["head_branch"] == own["head_branch"] and order(run) < order(own)]


def wait_for_turn(sleep=time.sleep, clock=time.monotonic):
    """Cola FIFO entre ejecuciones: la concurrencia de Actions solo guarda una pendiente."""
    repository = os.environ["GITHUB_REPOSITORY"]
    token = os.environ["GITHUB_TOKEN"]
    own = None
    started = clock()
    failures = 0
    while True:
        try:
            own = own or github_json(f"{repository}/actions/runs/{os.environ['GITHUB_RUN_ID']}", token)
            query = urlencode({"branch": own["head_branch"], "per_page": 100})
            runs = github_json(f"{repository}/actions/workflows/build-site.yml/runs?{query}",
                               token)["workflow_runs"]
            failures = 0
        except Exception as error:
            failures += 1
            if failures >= 5:
                raise
            print(f"Cola Pages no comprobable ({type(error).__name__}); reintento")
            sleep(TURN_POLL_SECONDS)
            continue
        blocking = earlier_active_runs(runs, own)
        if not blocking:
            print(f"Turno Pages: sin ejecuciones anteriores activas tras {clock() - started:.0f} s")
            return
        if clock() - started > TURN_LIMIT_SECONDS:
            raise TimeoutError(f"Ejecuciones anteriores sin terminar: {[run['id'] for run in blocking]}")
        print(f"Turno Pages: esperando a {', '.join(str(run['id']) for run in blocking)}")
        sleep(TURN_POLL_SECONDS)


def prepare():
    now = utc_now()
    raw_slugs = os.environ.get("STAGE_SLUGS", "").strip()
    stage_slugs = [slug.strip() for slug in raw_slugs.split(",")] if raw_slugs else []
    if raw_slugs and (len(stage_slugs) > 30 or len(set(stage_slugs)) != len(stage_slugs)
                      or any(not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug) for slug in stage_slugs)):
        raise ValueError("STAGE_SLUGS admite hasta 30 slugs únicos en minúsculas separados por comas")
    if stage_slugs and os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch":
        raise ValueError("La generación incremental requiere workflow_dispatch")
    force = not stage_slugs and (os.environ.get("GITHUB_EVENT_NAME") != "push"
                                 or os.environ.get("GITHUB_REF") != "refs/heads/main")
    requested = stage_requested = None
    if not force:
        try:
            run_number = int(os.environ.get("GITHUB_RUN_NUMBER") or 0) or None
            requested, stage_requested = latest_requests(
                os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_TOKEN"], run_number)
        except Exception as error:
            # No se registra el request ni sus headers.
            if stage_slugs:
                print(f"Refresco GitHub no comprobable ({type(error).__name__}); se regeneran los bloques de jornadas")
                stage_requested = now.isoformat()
            else:
                print(f"Refresco GitHub no comprobable ({type(error).__name__}); generación completa")
                force = True
        if stage_slugs:
            requested = None
    state = {"force": force, "requested": requested, "stage_requested": stage_requested,
             "day": now.strftime("%Y-%m-%d"), "stage_slugs": stage_slugs, "blocks": {}}
    for block in BLOCKS:
        prefix = cache_prefix(block, now)
        state["blocks"][block] = {"prefix": prefix}
        output(f"{block}_prefix", prefix)
    STATE_PATH.write_text(json.dumps(state), encoding="utf-8")
    output("force", force)
    mode = f"jornadas {','.join(stage_slugs)}" if stage_slugs else "completo" if force else "selectivo"
    print(f"Plan Pages: {mode}, día UTC {state['day']}, solicitud completa {requested}, "
          f"incremental anterior {stage_requested}")


def inventory(directory):
    if directory.is_symlink():
        raise ValueError("Destino de inventario no permitido")
    files = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ValueError("Un bloque generado contiene un enlace simbólico")
        if path.is_file():
            files[path.relative_to(directory).as_posix()] = [path.stat().st_size, digest(path)]
    return files


def allowed_file(block, name):
    if name in SOURCE_INDEXES or name.startswith("/") or ".." in Path(name).parts:
        return False
    if block == "sitemap":
        return (name in ("sitemap.xml", "atom.xml", ASSET_CANONICALS)
                or re.fullmatch(r"sitemap-[1-9][0-9]*\.xml", name) is not None)
    if block == "feeds":
        return name.endswith(".ics") and name.startswith(("feed/", "en/feed/"))
    return block in OG_FAMILIES and name.endswith("/index.html") and any(
        name.startswith(directory + "/") for directory in OG_FAMILIES[block])


def complete_files(block, files, day):
    if block == "sitemap":
        parts = sorted((name for name in files if name.startswith("sitemap-") and name.endswith(".xml")),
                       key=lambda name: int(name[8:-4]) if re.fullmatch(r"sitemap-[1-9][0-9]*\.xml", name) else 0)
        return (set(files) == {"sitemap.xml", "atom.xml", ASSET_CANONICALS, *parts}
                and parts == [f"sitemap-{index}.xml" for index in range(1, len(parts) + 1)]
                and bool(parts))
    if block == "feeds":
        year = int(day[:4])
        required = {f"{base}/{year}{key}.ics" for base in ("feed", "en/feed")
                    for key in ("", "-pro", "-wt", "-wwt", "-masc", "-fem")}
        return required.issubset(files)
    if block in ("og-races", "og-stages"):
        return all(sum(name.startswith(directory + "/") for name in files) >= 100
                   for directory in OG_FAMILIES[block])
    if block == "og-cx":
        return all(any(name.startswith(directory + "/") for name in files)
                   for directory in OG_FAMILIES[block])
    if block == "og-results":
        return all(any(name.startswith(directory + "/") for name in files)
                   for directory in OG_FAMILIES[block])
    return all(any(name.startswith(directory + "/") for name in files)
               for directory in ("inscritos", "en/startlist", "perfil", "en/profile"))


def reusable(block, archive, metadata, state):
    try:
        if state["force"] or metadata["prefix"] != state["blocks"][block]["prefix"]:
            return False
        started = datetime.fromisoformat(metadata["started"])
        if started.strftime("%Y-%m-%d") != state["day"] or started > utc_now():
            return False
        if state["requested"] and started < datetime.fromisoformat(state["requested"]):
            return False
        # Un bloque anterior al último incremental no contiene sus jornadas si
        # aquel no llegó a guardar su caché (cancelado, fallido o sin guardado).
        extended = datetime.fromisoformat(metadata.get("extended") or metadata["started"])
        if (block in STAGE_BLOCKS and state.get("stage_requested")
                and max(started, extended) < datetime.fromisoformat(state["stage_requested"])):
            return False
        files = metadata["files"]
        if not files or not metadata.get("verified") or not all(allowed_file(block, name) for name in files):
            return False
        if not complete_files(block, files, state["day"]):
            return False
        return archive.is_file() and digest(archive) == metadata["archive_sha256"]
    except (KeyError, ValueError, OSError, TypeError, AttributeError):
        return False


def read_state():
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def read_manifest(block):
    try:
        return json.loads((CACHE_ROOT / block / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def verify_sitemap(payload, files):
    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    index = ElementTree.parse(payload / "sitemap.xml").getroot()
    if index.tag != ns + "sitemapindex":
        raise ValueError("Índice de sitemaps inválido")
    parts = sorted((name for name in files if name.startswith("sitemap-") and name.endswith(".xml")),
                   key=lambda name: int(name[8:-4]))
    urls = [node.findtext(ns + "loc") for node in index.findall(ns + "sitemap")]
    if urls != [f"https://calendariociclismo.app/{name}" for name in parts]:
        raise ValueError("Partes del sitemap no coinciden con el índice")
    total = 0
    locations = set()
    alternates = set()
    for name in parts:
        path = payload / name
        if path.stat().st_size > 50_000_000:
            raise ValueError(f"Sitemap demasiado grande: {name}")
        root = ElementTree.parse(path).getroot()
        if root.tag != ns + "urlset" or not 1 <= len(root) <= 50000:
            raise ValueError(f"Sitemap inválido: {name}")
        for entry in root:
            loc = entry.findtext(ns + "loc")
            if not loc or loc in locations:
                raise ValueError(f"URL duplicada o vacía en sitemap: {loc}")
            locations.add(loc)
            alternates.update(link.get("href") for link in entry.findall("{http://www.w3.org/1999/xhtml}link"))
        total += len(root)
    if total < 100:
        raise ValueError("Sitemap incompleto")
    missing = alternates - locations
    if missing:
        raise ValueError(f"Alternativas sin entrada propia en sitemap: {sorted(missing)[:5]}")
    return total


def verify_asset_canonicals(payload):
    """Mapa ruta de PDF → URL canónica absoluta del sitio, no vacío."""
    mapping = json.loads((payload / ASSET_CANONICALS).read_text(encoding="utf-8"))
    if not isinstance(mapping, dict) or len(mapping) < 100:
        raise ValueError("Mapa de canónicos de assets incompleto")
    for path, canonical in mapping.items():
        if (not path.startswith("/") or not path.lower().endswith(".pdf")
                or not isinstance(canonical, str)
                or not canonical.startswith("https://calendariociclismo.app/")):
            raise ValueError(f"Entrada inválida en {ASSET_CANONICALS}: {path}")
    return len(mapping)


def archive_output(payload, files, archive):
    with tarfile.open(archive, "w") as stream:
        for name in files:
            stream.add(payload / name, arcname=name, recursive=False)
    return digest(archive)


def extract_archive(archive, files, destination=None):
    # El archivo solo contiene ficheros regulares del inventario verificado.
    with tarfile.open(archive, "r") as stream:
        members = stream.getmembers()
    if (len(members) != len(files) or
            any(not member.isfile() or member.name not in files or
                member.size != files[member.name][0] for member in members) or
            {member.name for member in members} != set(files)):
        raise ValueError("Archivo de caché ajeno al inventario")
    subprocess.run(["tar", "-xf", str(archive), "-C", str(destination or ROOT / "_site"),
                    "--no-same-owner", "--no-same-permissions"], check=True)


def move_generated_payload(payload):
    """Mueve directorios generados al sitio sin volver a copiar sus bytes."""
    def merge(source, destination):
        if destination.exists():
            if not source.is_dir() or not destination.is_dir():
                raise ValueError(f"Colisión con fuente del sitio: {destination}")
            for child in source.iterdir():
                merge(child, destination / child.name)
            source.rmdir()
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            source.replace(destination)

    for child in payload.iterdir():
        merge(child, ROOT / "_site" / child.name)
    payload.rmdir()


def asset_version(versions=None):
    """Versión global de JS/CSS del `_site` actual (ver version_assets.py)."""
    versions = {} if versions is None else versions
    if "site" not in versions:
        versions["site"] = version_assets.site_version(ROOT / "_site")
    return versions["site"]


def version_published_assets(base, names, versions=None):
    """Versiona las referencias JS/CSS del HTML y devuelve la versión aplicada."""
    version = asset_version(versions)
    started = time.monotonic()
    changed = version_assets.version_files(base, names, version)
    print(f"  Assets publicados: {changed} HTML, versión {version}, {time.monotonic() - started:.2f} s")
    return version


def assets_current(version, versions=None):
    """La versión guardada con el tar coincide con los JS/CSS del checkout."""
    return isinstance(version, str) and version == asset_version(versions)


def file_names(directory):
    return sorted(path.relative_to(directory).as_posix()
                  for path in directory.rglob("*") if path.is_file())


def archive_append(payload, names, archive):
    with tarfile.open(archive, "a") as stream:
        for name in names:
            stream.add(payload / name, arcname=name, recursive=False)
    return digest(archive)


def generate_all_og(state):
    """Cuando faltan todas las familias, consulta la BD una vez y reparte outputs."""
    staging = CACHE_ROOT / "_og-full"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    started = utc_now().isoformat()
    subprocess.run([sys.executable, str(ROOT / "tools/site/gen_og_pages.py")],
                   cwd=staging, check=True)
    versions = {}
    for block, directories in OG_FAMILIES.items():
        directory = CACHE_ROOT / block
        if directory.exists():
            shutil.rmtree(directory)
        payload = directory / "output"
        payload.mkdir(parents=True)
        for relative in directories:
            source = staging / relative
            if source.exists():
                destination = payload / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source), str(destination))
        names = file_names(payload)
        if not names or not all(allowed_file(block, name) for name in names) or not complete_files(block, names, state["day"]):
            raise ValueError(f"Familia OG incompleta: {block}")
        # El tar guarda el HTML ya versionado y la versión de assets aplicada.
        version = version_published_assets(payload, names, versions)
        files = inventory(payload)
        archive = directory / "output.tar"
        metadata = {"prefix": state["blocks"][block]["prefix"], "started": started,
                    "files": files, "verified": False, "asset_version": version,
                    "archive_sha256": archive_output(payload, files, archive)}
        (directory / "manifest.json").write_text(json.dumps(metadata, sort_keys=True), encoding="utf-8")
        state["blocks"][block]["prefilled"] = True
    unexpected = inventory(staging)
    shutil.rmtree(staging)
    if unexpected:
        raise ValueError(f"Outputs OG sin familia: {list(unexpected)[:5]}")
    STATE_PATH.write_text(json.dumps(state), encoding="utf-8")


def generate_stage_deltas(state, blocks):
    """Genera las jornadas nuevas de varias familias en una sola ejecución.

    El generador limita sus lecturas a las carreras de las jornadas pedidas."""
    staging = CACHE_ROOT / "_stage-staging"
    for path in (staging, *(STAGE_DELTA_ROOT / block for block in blocks)):
        if path.is_symlink():
            raise ValueError("Destino incremental no permitido")
        if path.exists():
            shutil.rmtree(path)
    staging.mkdir(parents=True)
    started = time.monotonic()
    try:
        subprocess.run([sys.executable, str(ROOT / "tools/site/gen_og_pages.py"),
                        "--family", ",".join(block[3:] for block in blocks),
                        "--stage-slugs", ",".join(state["stage_slugs"])],
                       cwd=staging, check=True)
        for block in blocks:
            delta = STAGE_DELTA_ROOT / block
            delta.mkdir(parents=True)
            for relative in OG_FAMILIES[block]:
                source = staging / relative
                if source.exists():
                    destination = delta / relative
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(source), str(destination))
            state["blocks"][block]["stage_delta"] = True
        unexpected = file_names(staging)
        if unexpected:
            raise ValueError(f"Salida incremental sin familia: {unexpected[:5]}")
    finally:
        shutil.rmtree(staging)
    STATE_PATH.write_text(json.dumps(state), encoding="utf-8")
    print(f"  Generación incremental {', '.join(blocks)}: {time.monotonic() - started:.2f} s")


def extend_og_family(block, archive, metadata, state):
    """Añade jornadas nuevas a una familia verificada sin renderizar las antiguas."""
    directory = CACHE_ROOT / block
    payload = directory / "output"
    delta = STAGE_DELTA_ROOT / block
    # Un slug ya presente (reintento) se regenera y sustituye su página.
    if payload.exists():
        raise ValueError("Destino incremental ocupado")
    if not state["blocks"][block].get("stage_delta") or not delta.is_dir():
        generate_stage_deltas(state, [block])
    try:
        names = file_names(delta)
        if not names or not all(allowed_file(block, name) for name in names):
            raise ValueError(f"Salida incremental vacía o no permitida: {block}")
        if block == "og-stages" and any(
                f"jornada/{slug}/index.html" not in names for slug in state["stage_slugs"]):
            raise ValueError("Falta una jornada solicitada en el resultado incremental")
        # Si la versión del tar sigue vigente solo se versionan las páginas nuevas.
        versions = {}
        base_current = assets_current(metadata.get("asset_version"), versions)
        version = version_published_assets(delta, names, versions)
        additions = inventory(delta)
        payload.mkdir(parents=True)
        extract_archive(archive, metadata["files"], payload)
        for name in additions:
            destination = payload / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            (delta / name).replace(destination)
    finally:
        shutil.rmtree(delta)
    replaced = set(additions) & set(metadata["files"])
    if base_current:
        files = {**metadata["files"], **additions}
    else:
        version_published_assets(payload, sorted(set(metadata["files"]) - replaced), versions)
        files = inventory(payload)
    if not complete_files(block, files, state["day"]):
        raise ValueError(f"Familia incremental incompleta: {block}")
    # Sin sustituciones ni reescritura de versiones basta con añadir miembros.
    archive_sha256 = (archive_append(payload, sorted(additions), archive) if base_current and not replaced
                      else archive_output(payload, files, archive))
    # "started" conserva la generación base para las solicitudes completas;
    # "extended" acredita las jornadas añadidas. El SEO previo sigue válido
    # para las páginas no tocadas; verify solo revisa las añadidas.
    updated = {"prefix": state["blocks"][block]["prefix"], "started": metadata["started"],
               "extended": utc_now().isoformat(), "files": files, "verified": False,
               "asset_version": version, "archive_sha256": archive_sha256,
               "stage_added": sorted(additions), "stage_new": sorted(set(additions) - replaced)}
    if metadata.get("seo"):
        updated["seo"] = metadata["seo"]
    (directory / "manifest.json").write_text(json.dumps(updated, sort_keys=True), encoding="utf-8")
    print(f"  {block}: {len(additions)} páginas nuevas o actualizadas")
    return updated


def extend_generated_block(block, archive, metadata, state):
    """Actualiza sitemap/Atom o feeds cacheados solo con las carreras de las jornadas."""
    directory = CACHE_ROOT / block
    payload = directory / "output"
    if payload.exists():
        raise ValueError("Destino incremental ocupado")
    payload.mkdir(parents=True)
    extract_archive(archive, metadata["files"], payload)
    subprocess.run([sys.executable, str(ROOT / "tools/site" / BLOCKS[block][0]),
                    "--stage-slugs", ",".join(state["stage_slugs"])], cwd=payload, check=True)
    for extra in EXTRA_GENERATORS.get(block, ()):
        subprocess.run([sys.executable, str(ROOT / "tools/site" / extra)], cwd=payload, check=True)
    files = inventory(payload)
    if (not files or not all(allowed_file(block, name) for name in files)
            or not complete_files(block, files, state["day"])):
        raise ValueError(f"Salida incremental vacía o no permitida: {block}")
    updated = {"prefix": state["blocks"][block]["prefix"], "started": metadata["started"],
               "extended": utc_now().isoformat(), "files": files, "verified": False,
               "archive_sha256": archive_output(payload, files, archive)}
    (directory / "manifest.json").write_text(json.dumps(updated, sort_keys=True), encoding="utf-8")
    return updated


def run_block(block):
    started = time.monotonic()
    state = read_state()
    directory = CACHE_ROOT / block
    payload = directory / "output"
    archive = directory / "output.tar"
    manifest = directory / "manifest.json"
    metadata = read_manifest(block)
    reused = reusable(block, archive, metadata, state)
    stage_update = bool(state.get("stage_slugs")) and block in STAGE_BLOCKS
    if block == "og-races" and not reused and not state["blocks"][block].get("prefilled"):
        missing_all = all(not reusable(other, CACHE_ROOT / other / "output.tar",
                                       read_manifest(other), state)
                          for other in OG_FAMILIES)
        if missing_all:
            generate_all_og(state)
            metadata = json.loads(manifest.read_text(encoding="utf-8"))
    if stage_update and reused and block in OG_FAMILIES:
        if not state["blocks"][block].get("stage_delta"):
            # La primera familia ampliable genera también las siguientes.
            pending = [other for other in STAGE_OG_BLOCKS[STAGE_OG_BLOCKS.index(block):]
                       if other == block or reusable(other, CACHE_ROOT / other / "output.tar",
                                                     read_manifest(other), state)]
            generate_stage_deltas(state, pending)
        metadata = extend_og_family(block, archive, metadata, state)
    elif stage_update and reused:
        metadata = extend_generated_block(block, archive, metadata, state)
    elif not reused and not state["blocks"][block].get("prefilled"):
        # Ruta interna explícita, nunca el checkout ni fuentes manuales.
        if directory.is_symlink():
            raise ValueError("Destino de bloque no permitido")
        if directory.exists():
            shutil.rmtree(directory)
        payload.mkdir(parents=True)
        generation_started = utc_now().isoformat()
        generator = "gen_og_pages.py" if block in OG_FAMILIES else BLOCKS[block][0]
        command = [sys.executable, str(ROOT / "tools/site" / generator)]
        if block in OG_FAMILIES:
            command += ["--family", block[3:]]
        subprocess.run(command, cwd=payload, check=True)
        for extra in EXTRA_GENERATORS.get(block, ()):
            subprocess.run([sys.executable, str(ROOT / "tools/site" / extra)], cwd=payload, check=True)
        names = file_names(payload)
        if (not names or not all(allowed_file(block, name) for name in names)
                or not complete_files(block, names, state["day"])):
            raise ValueError(f"Salida vacía o no permitida: {block}")
        metadata = {"prefix": state["blocks"][block]["prefix"], "started": generation_started,
                    "verified": False}
        if block in OG_FAMILIES:
            metadata["asset_version"] = version_published_assets(payload, names)
        metadata["files"] = inventory(payload)
        metadata["archive_sha256"] = archive_output(payload, metadata["files"], archive)
        manifest.write_text(json.dumps(metadata, sort_keys=True), encoding="utf-8")
    state["blocks"][block]["regenerated"] = not reused or stage_update
    STATE_PATH.write_text(json.dumps(state), encoding="utf-8")
    # En frío se renombran los directorios ya generados; en caliente se extrae
    # el tar restaurado. El tar contiene el HTML versionado con la versión de
    # assets del manifiesto. Si algún JS/CSS cambió, version_assets.py
    # reescribe la familia en _site al final de la composición.
    extract_started = time.monotonic()
    if payload.is_dir():
        move_generated_payload(payload)
        operation = "Movido"
    else:
        extract_archive(archive, metadata["files"])
        operation = "Extraído"
    print(f"  {operation} {block}: {time.monotonic() - extract_started:.2f} s")
    if block in OG_FAMILIES and operation == "Extraído":
        if assets_current(metadata.get("asset_version")):
            print(f"  Assets vigentes: versión {metadata['asset_version']}, sin reescritura")
        else:
            print("  Assets desactualizados: se versionan al componer _site")
    status = "ampliado" if stage_update and reused else "reutilizado" if reused else "regenerado"
    print(f"Bloque {block}: {status}, {len(metadata['files'])} ficheros, {time.monotonic() - started:.2f} s")


def validate_catalog_seo(block, metadata, validator):
    """Valida SportsEvent de una familia y registra el resultado en el manifiesto."""
    site = ROOT / "_site"
    previous = metadata.get("seo") or {}
    if "stage_added" in metadata and previous.get("validator") == validator:
        # Ampliación incremental: la base ya se validó con este validador;
        # solo se revisan las páginas añadidas o sustituidas.
        new = set(metadata["stage_new"])
        _, new_events, errors = check_paths(site, [site / name for name in sorted(new)])
        _, _, replaced_errors = check_paths(
            site, [site / name for name in metadata["stage_added"] if name not in new])
        errors += replaced_errors
        html_count, event_count = len(metadata["files"]), previous["events"] + new_events
    else:
        html_count, event_count, errors = check_paths(
            site, [site / name for name in metadata["files"]])
    minimum_events = 100 if block in ("og-races", "og-stages") else 1
    if errors or event_count < minimum_events:
        raise ValueError(f"SEO generado inválido: {errors[:10]}, {event_count} eventos")
    metadata["seo"] = {"validator": validator, "html": html_count, "events": event_count}
    return html_count, event_count


def verify():
    state = read_state()
    validator = digest(ROOT / "tools/site/check_seo_output.py")
    started = time.monotonic()
    for block in BLOCKS:
        directory = CACHE_ROOT / block
        manifest = directory / "manifest.json"
        metadata = json.loads(manifest.read_text(encoding="utf-8"))
        changed = state["blocks"][block]["regenerated"]
        if block in OG_FAMILIES:
            # Conserva el alcance SEO previo: catálogos con SportsEvent.
            # Resultados y auxiliares solo contienen BreadcrumbList.
            if block in ("og-races", "og-stages", "og-cx") and (
                    changed or metadata.get("seo", {}).get("validator") != validator):
                html_count, event_count = validate_catalog_seo(block, metadata, validator)
                changed = True
                print(f"SEO {block}: {html_count} HTML, {event_count} SportsEvent")
            elif block in ("og-results", "og-extras"):
                metadata["seo"] = {"validator": validator, "html": len(metadata["files"]), "events": 0}
            else:
                print(f"SEO {block} reutilizado: {metadata['seo']['html']} HTML")
        elif block == "sitemap":
            verify_sitemap(ROOT / "_site", metadata["files"])
            verify_asset_canonicals(ROOT / "_site")
            ElementTree.parse(ROOT / "_site" / "atom.xml")
        else:
            current = int(state["day"][:4])
            for base in ("feed", "en/feed"):
                for key in ("", "-pro", "-wt", "-wwt", "-masc", "-fem"):
                    if not (ROOT / "_site" / base / f"{current}{key}.ics").is_file():
                        raise ValueError("Falta un feed del año actual")
                for annual in (ROOT / "_site" / base).glob("*.ics"):
                    if int(annual.name.split("-")[0].split(".")[0]) < current:
                        raise ValueError("iCal histórico no permitido")
            for name in metadata["files"]:
                content = (ROOT / "_site" / name).read_bytes()
                if not content.startswith(b"BEGIN:VCALENDAR") or not content.endswith(b"END:VCALENDAR"):
                    raise ValueError(f"iCal inválido: {name}")
        metadata["verified"] = True
        metadata.pop("stage_added", None)
        metadata.pop("stage_new", None)
        manifest.write_text(json.dumps(metadata, sort_keys=True), encoding="utf-8")
        output(f"save_{block}", changed)
    # Los índices fuente actuales nunca pertenecen a la caché OG.
    site = ROOT / "_site"
    _, _, errors = check_paths(site, [site / name for name in SOURCE_INDEXES])
    if errors:
        raise ValueError(f"SEO de índices actuales inválido: {errors}")
    print(f"Validación Pages: {time.monotonic() - started:.2f} s")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("wait", "prepare", "run", "verify"))
    parser.add_argument("block", nargs="?", choices=BLOCKS)
    arguments = parser.parse_args()
    if arguments.command == "wait":
        wait_for_turn()
    elif arguments.command == "prepare":
        prepare()
    elif arguments.command == "verify":
        verify()
    elif not arguments.block:
        parser.error("run requiere un bloque")
    else:
        run_block(arguments.block)


if __name__ == "__main__":
    main()
