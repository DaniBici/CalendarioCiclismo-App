#!/usr/bin/env python3
"""Copia assets R2 a claves canónicas sin borrar los objetos históricos."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import sys

import boto3
from botocore.exceptions import ClientError

R2_ENDPOINT = "https://8b895b68a864881061ff29adabdabe55.r2.cloudflarestorage.com"
R2_BUCKET = "calendario-ciclismo-assets"
LEGACY_ASSET_RE = re.compile(r"(?:roadbook|timetable|profile|perfil|map|mapa|ports|puertos|startorder)", re.I)


def env_value(name):
    if os.environ.get(name):
        return os.environ[name]
    for line in Path(".env").read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"Falta {name} en el entorno o .env")


def object_info(client, key):
    try:
        return client.head_object(Bucket=R2_BUCKET, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise


def same_object(left, right):
    if left["ContentLength"] != right["ContentLength"]:
        return False
    if left["ETag"] == right["ETag"]:
        return True
    # R2 recalcula el ETag al hacer CopyObject de un multipart upload: el
    # origen termina en ``-N`` y el destino, de una sola parte, no. La copia
    # es server-side y atómica; tamaño y Content-Type verifican que se preservó
    # el objeto cuando el ETag no es comparable entre ambos formatos.
    return "-" in left["ETag"].rstrip('"') and left.get("ContentType") == right.get("ContentType")


def validate(entry):
    missing = [name for name in ("id", "source_key", "target_key") if not entry.get(name)]
    if missing:
        raise ValueError(f"Entrada sin {', '.join(missing)}: {entry!r}")
    for field in ("source_key", "target_key"):
        key = entry[field]
        if key.startswith("/") or ".." in key.split("/") or not key.strip():
            raise ValueError(f"Clave R2 no permitida ({field}): {key!r}")
    if not entry["target_key"].startswith("races/"):
        raise ValueError(f"El destino no es una clave canónica: {entry['target_key']!r}")


def versioned_key(key, version):
    stem, dot, ext = key.rpartition(".")
    if not dot:
        raise ValueError(f"Destino sin extensión: {key!r}")
    return f"{stem}-{version}.{ext}"


def migrate_entry(client, entry, apply):
    """Copia una entrada y devuelve su estado; segura para ejecución paralela."""
    source, target = entry["source_key"], entry["target_key"]
    src = object_info(client, source)
    if not src:
        return {"status": "missing", "id": entry["id"], "source_key": source, "target_key": target}
    dest = object_info(client, target)
    if dest:
        if same_object(src, dest):
            return {"status": "existing", "id": entry["id"], "source_key": source, "target_key": target}
        for revision in range(2, 1000):
            candidate = versioned_key(target, revision)
            candidate_info = object_info(client, candidate)
            if not candidate_info or same_object(src, candidate_info):
                target, dest = candidate, candidate_info
                if candidate_info:
                    return {"status": "existing", "id": entry["id"], "source_key": source, "target_key": target}
                break
        else:
            raise RuntimeError(f"No hay revisión libre para: {target}")
    if not dest:
        if apply:
            client.copy_object(Bucket=R2_BUCKET, Key=target, CopySource={"Bucket": R2_BUCKET, "Key": source})
            copied_info = object_info(client, target)
            if not copied_info or not same_object(src, copied_info):
                raise RuntimeError(
                    f"Verificación fallida: {source} → {target}; "
                    f"origen={src['ContentLength']}/{src['ETag']}, "
                    f"destino={None if not copied_info else str(copied_info['ContentLength']) + '/' + copied_info['ETag']}"
                )
        return {"status": "copied", "id": entry["id"], "source_key": source, "target_key": target}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", help="JSON con el plan de copia, o - para stdin")
    parser.add_argument("--apply", action="store_true", help="Ejecuta las copias; por defecto solo valida")
    parser.add_argument("--delete-sources", action="store_true", help="Borra las claves de origen tras verificar su copia")
    parser.add_argument("--result-file", type=Path, help="Guarda el resultado JSON en un fichero")
    parser.add_argument("--workers", type=int, default=16, help="Copias R2 simultáneas (predeterminado: 16)")
    parser.add_argument("--prune-unreferenced", type=Path, help="Fichero de claves R2 aún referenciadas; elimina solo documentos legacy no referenciados")
    args = parser.parse_args()
    client = boto3.client("s3", endpoint_url=R2_ENDPOINT,
        aws_access_key_id=env_value("R2_ACCESS_KEY"), aws_secret_access_key=env_value("R2_SECRET_KEY"), region_name="auto")
    if args.prune_unreferenced:
        active = set(args.prune_unreferenced.read_text().splitlines())
        continuation = None
        stale = []
        while True:
            response = client.list_objects_v2(Bucket=R2_BUCKET, ContinuationToken=continuation) if continuation else client.list_objects_v2(Bucket=R2_BUCKET)
            for obj in response.get("Contents", []):
                key = obj["Key"]
                # Solo documentos de jornada: ni logos, ni push, ni muestras PDF,
                # ni otros ficheros ajenos a la tabla assets.
                if key not in active and LEGACY_ASSET_RE.search(key):
                    stale.append(key)
            if not response.get("IsTruncated"):
                break
            continuation = response["NextContinuationToken"]
        if args.apply:
            with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
                list(pool.map(lambda key: client.delete_object(Bucket=R2_BUCKET, Key=key), stale))
        print(json.dumps({"action": "borrados" if args.apply else "a_borrar", "count": len(stale), "sample": stale[:20]}))
        return

    entries = json.loads(sys.stdin.read() if args.manifest == "-" else Path(args.manifest).read_text())
    if not isinstance(entries, list) or not entries:
        raise ValueError("El manifiesto debe ser un array JSON no vacío")

    seen_targets = set()
    for entry in entries:
        validate(entry)
        if entry["target_key"] in seen_targets:
            raise ValueError(f"Destino duplicado en manifiesto: {entry['target_key']}")
        seen_targets.add(entry["target_key"])
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        processed = list(pool.map(lambda entry: migrate_entry(client, entry, args.apply), entries))
    missing_entries = [entry for entry in processed if entry["status"] == "missing"]
    for entry in missing_entries:
        print(f"MISSING {entry['id']} {entry['source_key']}")
    copied = sum(entry["status"] == "copied" for entry in processed)
    existing = sum(entry["status"] == "existing" for entry in processed)
    missing = len(missing_entries)
    resolved_entries = [{key: value for key, value in entry.items() if key != "status"} for entry in processed if entry["status"] != "missing"]

    if args.delete_sources and not missing:
        for entry in resolved_entries:
            if entry["source_key"] == entry["target_key"]:
                continue
            target_info = object_info(client, entry["target_key"])
            if not target_info:
                raise RuntimeError(f"No se borra el origen: falta destino {entry['target_key']}")
            if args.apply:
                client.delete_object(Bucket=R2_BUCKET, Key=entry["source_key"])

    result = {
        "action": "borrados" if args.delete_sources else ("copiados" if args.apply else "planificados"),
        "copied": copied, "existing": existing, "missing": missing, "entries": resolved_entries,
    }
    if args.result_file:
        args.result_file.write_text(json.dumps(result))
    print(json.dumps({key: value for key, value in result.items() if key != "entries"}))
    if missing:
        sys.exit(2)


if __name__ == "__main__":
    main()
