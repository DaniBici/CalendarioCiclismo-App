#!/bin/bash
# Instala el publicador en el VPS, como root, desde un checkout actualizado. Idempotente. No habilita
# el server de nginx ni toca la biblioteca: el corte es un paso aparte (docs/runbooks/publicador-vps.md).
#   deploy/publicador-vps/install.sh [checkout]
set -euo pipefail
ORIGEN="${1:-/opt/calendario-ciclismo}"
RAIZ=/var/lib/cc-publicador
id cc-publicador >/dev/null 2>&1 || useradd --system --home-dir "$RAIZ" --shell /usr/sbin/nologin cc-publicador
install -d -o cc-publicador -g cc-publicador -m 755 "$RAIZ" "$RAIZ/fuente" "$RAIZ/trabajo" "$RAIZ/arbol" "$RAIZ/base"
# La credencial de solo lectura: la lee systemd al arrancar, no hace falta dar acceso a ningún usuario.
ENV=/etc/calendario-ciclismo/publicador.env
test -f "$ENV" || { echo "Falta $ENV: docs/runbooks/rol-agentes.md" >&2; exit 1; }
chown root:root "$ENV"
chmod 600 "$ENV"
install -d -m 755 /etc/nginx/cc-publicador
install -m 644 "$ORIGEN"/deploy/publicador-vps/nginx-mapas.inc "$ORIGEN"/deploy/publicador-vps/nginx-sitio.inc /etc/nginx/cc-publicador/
install -m 644 "$ORIGEN"/deploy/publicador-vps/nginx-web.conf /etc/nginx/sites-available/calendariociclismo-web
install -d -o www-data -g www-data -m 700 /var/cache/nginx/cc-datos
install -m 644 "$ORIGEN"/deploy/publicador-vps/cc-publicador.service /etc/systemd/system/cc-publicador.service
install -m 644 "$ORIGEN"/deploy/publicador-vps/cc-publicador-codigo.service "$ORIGEN"/deploy/publicador-vps/cc-publicador-codigo.timer /etc/systemd/system/
systemctl daemon-reload
"$ORIGEN"/deploy/publicador-vps/actualizar.sh "$ORIGEN"
systemctl enable cc-publicador.service
systemctl enable --now cc-publicador-codigo.timer
echo "Instalado. Estado: systemctl status cc-publicador; registro: $RAIZ/trabajo/servicio.jsonl"
