#!/bin/bash
# Lleva el código del checkout al publicador y lo reinicia, como root. El publicador necesita las
# dependencias de desarrollo (esbuild), que el checkout de los workers no instala.
#   deploy/publicador-vps/actualizar.sh [checkout]
set -euo pipefail
ORIGEN="${1:-/opt/calendario-ciclismo}"
FUENTE=/var/lib/cc-publicador/fuente
# Parado: una generación del sitio base en curso se pisaría con la copia.
systemctl stop cc-publicador.service 2>/dev/null || true
# Pase lo que pase con la copia, el servicio vuelve a arrancar.
trap 'systemctl start --no-block cc-publicador.service' EXIT
rsync -a --delete --exclude node_modules --exclude .git --exclude .env --exclude '.pages-*' --exclude __pycache__ \
  --exclude android-app --exclude ios-app --exclude docs/informes --exclude archive "$ORIGEN"/ "$FUENTE"/
# Con el commit se sabe si el sitio base corresponde a este código. Sin commit, una marca que no se repite.
if [ ! -f "$ORIGEN/.codigo" ]; then
  git -c safe.directory="$ORIGEN" -C "$ORIGEN" rev-parse HEAD > "$FUENTE/.codigo" 2>/dev/null || date +%s > "$FUENTE/.codigo"
fi
chown -R cc-publicador:cc-publicador "$FUENTE"
if ! cmp -s "$FUENTE/package-lock.json" "$FUENTE/node_modules/.package-lock-copia" 2>/dev/null; then
  runuser -u cc-publicador -- sh -c "cd '$FUENTE' && HOME=/var/lib/cc-publicador npm ci --no-audit --no-fund"
  cp "$FUENTE/package-lock.json" "$FUENTE/node_modules/.package-lock-copia"
  chown cc-publicador:cc-publicador "$FUENTE/node_modules/.package-lock-copia"
fi
echo "Actualizado; la primera pasada tarda unos 4 minutos."
