#!/bin/bash
# Lleva a la web el código nuevo de main, como root, desde cc-publicador-codigo.timer. Sustituye al build de
# Pages por push. No mueve el checkout de los workers: solo lee su origin/main.
#   deploy/publicador-vps/desplegar-codigo.sh [checkout]
set -euo pipefail
CHECKOUT="${1:-/opt/calendario-ciclismo}"
FUENTE=/var/lib/cc-publicador/fuente
repo() { runuser -u cc-results -- git -C "$CHECKOUT" "$@"; }

# Servicio retirado a propósito o primera pasada en curso: nada que hacer en esta vuelta.
systemctl is-enabled -q cc-publicador.service || exit 0
[ "$(systemctl show -p SubState --value cc-publicador.service)" != start ] || exit 0

# Referencia propia: no bloquea origin/main a quien actualice el checkout a mano.
repo fetch -q --no-write-fetch-head origin +refs/heads/main:refs/cc-publicador/main
NUEVO=$(repo rev-parse refs/cc-publicador/main)
ANTERIOR=$(cat "$FUENTE/.codigo" 2>/dev/null || true)
[ "$NUEVO" != "$ANTERIOR" ] || exit 0

# Commits sin nada de la web: se anotan sin reiniciar.
if repo cat-file -e "$ANTERIOR^{commit}" 2>/dev/null; then
  CAMBIOS=$(repo diff --name-only "$ANTERIOR" "$NUEVO" | grep -vE '^(android-app|ios-app|supabase|workers|archive|\.github|\.agents|\.claude)/|^docs/|^(AGENTS|CLAUDE)\.md$' || true)
  if [ -z "$CAMBIOS" ] && ! repo diff --name-only "$ANTERIOR" "$NUEVO" | grep -qx 'docs/cc-cx-points-schemes.json'; then
    printf '%s\n' "$NUEVO" > "$FUENTE/.codigo"
    exit 0
  fi
fi

COPIA=$(mktemp -d /var/tmp/cc-codigo.XXXXXX)
trap 'rm -rf "$COPIA"' EXIT
repo archive "$NUEVO" | tar -x -C "$COPIA"
printf '%s\n' "$NUEVO" > "$COPIA/.codigo"
"$COPIA/deploy/publicador-vps/actualizar.sh" "$COPIA"
echo "Desplegado $NUEVO"
