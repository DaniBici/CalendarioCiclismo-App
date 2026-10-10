#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'La instalación de las unidades requiere root.' >&2
  exit 1
fi

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

# El mapa debe existir antes de recargar nginx con el fragmento `include`.
if [ ! -e /etc/nginx/cc-assets-canonicals.map ]; then
  printf '%s\n' '# vacío; lo rellena sync-map.mjs' > /etc/nginx/cc-assets-canonicals.map
fi

install -o root -g root -m 0644 "$root/deploy/assets-canonical-vps/cc-assets-canonical.service" /etc/systemd/system/
install -o root -g root -m 0644 "$root/deploy/assets-canonical-vps/cc-assets-canonical.timer" /etc/systemd/system/
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/cc-assets-canonical.service /etc/systemd/system/cc-assets-canonical.timer
systemctl show cc-assets-canonical.timer -p ActiveState -p UnitFileState
