#!/bin/sh
# Lleva las fuentes al checkout de la instancia de prueba y genera allí el sitio base.
# Sin credenciales de producción: lee por la API con la clave pública.
#   tools/publicacion/vps/desplegar-base.sh
set -e
VPS=root@116.203.47.20
DIR=/var/tmp/cc-prototipo
git ls-files -z --cached --others --exclude-standard | tar --null -T - --exclude='android-app/*' --exclude='ios-app/*' --exclude='docs/informes/*' --exclude='archive/*' -czf - | ssh -o BatchMode=yes "$VPS" "mkdir -p $DIR/fuente && tar -xzf - -C $DIR/fuente 2>/dev/null"
scp -q tools/publicacion/vps/nginx.conf deploy/publicador-vps/nginx-mapas.inc deploy/publicador-vps/nginx-sitio.inc "$VPS:$DIR/"
ssh -o BatchMode=yes "$VPS" "chown -R cc-results:cc-results $DIR && cd $DIR/fuente && runuser -u cc-results -- sh -c 'export npm_config_cache=$DIR/tmp/npm HOME=$DIR/tmp; [ -d node_modules/esbuild ] || npm ci --ignore-scripts=false --no-audit --no-fund >/dev/null; nice -n 10 bash tools/publicacion/vps/base.sh $DIR/fuente $DIR/base' 2>&1 | grep -E '^\[|::error|Error|Traceback' | cut -c1-200; mkdir -p $DIR/cache-datos; chown cc-results:cc-results $DIR/cache-datos; runuser -u cc-results -- nginx -t -e $DIR/error.log -p $DIR/ -c nginx.conf 2>&1 | tail -1; [ -f $DIR/nginx.pid ] && runuser -u cc-results -- kill -HUP \$(cat $DIR/nginx.pid)"
