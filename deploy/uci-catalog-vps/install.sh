#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'La instalación de las unidades requiere root.' >&2
  exit 1
fi

catalog_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
if ! id cc-uci-catalog >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/cc-uci-catalog --shell /usr/sbin/nologin cc-uci-catalog
fi
if [ "$(id -u cc-uci-catalog)" -eq 0 ]; then
  printf '%s\n' 'El usuario del servicio no puede ser root.' >&2
  exit 1
fi

install -o root -g root -m 0644 "$catalog_root/deploy/uci-catalog-vps/cc-uci-catalog.service" /etc/systemd/system/
install -o root -g root -m 0644 "$catalog_root/deploy/uci-catalog-vps/cc-uci-catalog.timer" /etc/systemd/system/
install -d -o root -g root -m 0755 /etc/cc-uci-catalog
install -o root -g root -m 0644 "$catalog_root/deploy/uci-catalog-vps/supabase-ca.crt" /etc/cc-uci-catalog/supabase-ca.crt
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/cc-uci-catalog.service /etc/systemd/system/cc-uci-catalog.timer
systemctl show cc-uci-catalog.timer -p ActiveState -p UnitFileState
