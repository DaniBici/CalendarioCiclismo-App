#!/bin/sh
# ci_post_xcodebuild.sh
# Xcode Cloud ejecuta este script tras xcodebuild (incluso si falla).
# En caso de fallo, extrae los errores de compilación y los publica
# como comentario en GitHub para que Claude los detecte y corrija.

REPO_SLUG="danibici/calendario-ciclismo"
COMMIT="${CI_COMMIT:-}"
BRANCH="${CI_BRANCH:-unknown}"
BUILD_NUM="${CI_BUILD_NUMBER:-?}"
PR_NUM="${CI_PULL_REQUEST_NUMBER:-}"
DERIVED_DATA="${CI_DERIVED_DATA_PATH:-}"
EXIT_CODE="${CI_XCODEBUILD_EXIT_CODE:-0}"

# 1. Solo actuar si el build falló
if [ "${EXIT_CODE}" = "0" ]; then
    echo "ci_post_xcodebuild: build OK — nada que reportar."
    exit 0
fi
echo "ci_post_xcodebuild: build fallido (exit ${EXIT_CODE}) — generando reporte..."

# 2. Prerequisitos
if [ -z "${GITHUB_TOKEN}" ]; then
    echo "⚠️  GITHUB_TOKEN no configurado."
    echo "    Añade el secret en App Store Connect → Xcode Cloud → tu workflow → Environment Variables."
    exit 0
fi
if [ -z "${COMMIT}" ]; then
    echo "⚠️  CI_COMMIT no disponible."
    exit 0
fi

# 3. Localizar el .xcresult más reciente en DerivedData
RESULT_PATH=""
if [ -n "${DERIVED_DATA}" ]; then
    RESULT_PATH=$(find "${DERIVED_DATA}/Logs/Build" \
        -name "*.xcresult" -maxdepth 2 2>/dev/null | sort | tail -1 || true)
fi

# 4. Extraer errores del .xcresult con Python (sin dependencia de jq)
PY_PARSER=$(mktemp /tmp/xc_parser.XXXXXX.py)
cat > "${PY_PARSER}" << 'PYEOF'
import json, sys

def shorten(url):
    if url.startswith("file://"):
        url = url[7:]
    for marker in ("/ios-app/", "/CalendarioCiclismo/"):
        if marker in url:
            return "ios-app/" + url.split(marker, 1)[1]
    return url.split("/")[-1] if "/" in url else url

COMPILE_ERRORS = {"buildError", "clangError", "swiftError", "swiftCompilerError"}

try:
    data = json.load(sys.stdin)
    errors = []
    for action in data.get("actions", {}).get("_values", []):
        for issue in action.get("buildResult", {}).get("issues", {}).get("_values", []):
            if issue.get("issueType", {}).get("_value", "") not in COMPILE_ERRORS:
                continue
            msg = issue.get("message", {}).get("_value", "")
            url = issue.get("documentURL", {}).get("_value", "")
            loc = shorten(url) if url else ""
            errors.append(f"- `{loc}` — {msg}" if loc else f"- {msg}")
    print("\n".join(errors[:30]) if errors else "_(Sin errores de compilación en el .xcresult)_")
except Exception as e:
    print(f"_(Error al parsear el .xcresult: {e})_")
PYEOF

ERRORS="_(No se encontró el archivo .xcresult en DerivedData)_"
if [ -n "${RESULT_PATH}" ] && command -v xcrun >/dev/null 2>&1; then
    ERRORS=$(xcrun xcresulttool get --format json --path "${RESULT_PATH}" 2>/dev/null \
        | python3 "${PY_PARSER}" 2>/dev/null \
        || echo "_(Error al procesar el .xcresult)_")
fi
rm -f "${PY_PARSER}"

# 5. Decidir endpoint: comentario en PR (si lo hay) o en el commit
if [ -n "${PR_NUM}" ]; then
    GH_URL="https://api.github.com/repos/${REPO_SLUG}/issues/${PR_NUM}/comments"
else
    GH_URL="https://api.github.com/repos/${REPO_SLUG}/commits/${COMMIT}/comments"
fi

# 6. Escribir el cuerpo del comentario a un archivo temporal
BODY_FILE=$(mktemp /tmp/xc_body.XXXXXX.txt)
cat > "${BODY_FILE}" << BODYEOF
## ❌ Xcode Cloud — Build fallido

**Rama:** \`${BRANCH}\`  |  **Build:** #${BUILD_NUM}  |  **Commit:** \`${COMMIT}\`

### Errores de compilación

${ERRORS}

---
*Reporte automático de \`ci_post_xcodebuild.sh\` — Claude revisará y corregirá estos errores.*
BODYEOF

# 7. Publicar el comentario en GitHub vía Python
PY_POST=$(mktemp /tmp/xc_post.XXXXXX.py)
cat > "${PY_POST}" << 'PYEOF'
import urllib.request, json, sys, os

url   = os.environ["GH_API_URL"]
token = os.environ["GH_TOKEN"]

with open(os.environ["BODY_FILE"]) as f:
    body = f.read()

payload = json.dumps({"body": body}).encode("utf-8")
req = urllib.request.Request(url, data=payload, method="POST")
req.add_header("Authorization", f"token {token}")
req.add_header("Content-Type", "application/json")
req.add_header("Accept", "application/vnd.github+json")
req.add_header("User-Agent", "XcodeCloud-CI-Bot")

try:
    resp = urllib.request.urlopen(req)
    print(f"✅ Comentario publicado en GitHub (HTTP {resp.status})")
except urllib.error.HTTPError as e:
    print(f"❌ GitHub API error: HTTP {e.code} — {e.read().decode()}", file=sys.stderr)
    sys.exit(1)
PYEOF

GH_API_URL="${GH_URL}" GH_TOKEN="${GITHUB_TOKEN}" BODY_FILE="${BODY_FILE}" \
    python3 "${PY_POST}"
STATUS=$?

rm -f "${PY_POST}" "${BODY_FILE}"
exit ${STATUS}
