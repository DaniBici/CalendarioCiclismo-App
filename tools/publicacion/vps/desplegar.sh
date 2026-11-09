#!/bin/sh
# Actualiza la instancia de prueba del VPS con el código y los datos de este Mac: no usa
# credenciales de producción en el VPS ni toca el nginx ni los servicios de producción.
#   tools/publicacion/vps/desplegar.sh <directorio de trabajo>
set -e
T="$1"
VPS=root@116.203.47.20
DIR=/var/tmp/cc-prototipo
rm -rf "$T/arbol-vps" "$T"/publicada-*.html
CC_GZ=1 node --no-warnings tools/publicacion/publicacion.mjs activos --trabajo "$T" --arbol "$T/arbol-vps"
ssh -o BatchMode=yes "$VPS" "rm -rf $DIR/repo && mkdir -p $DIR/repo $DIR/trabajo/datos"
git ls-files -z --cached --others --exclude-standard js tools/publicacion tools/site scripts/db i18n | tar --null -T - -czf - | ssh -o BatchMode=yes "$VPS" "tar -xzf - -C $DIR/repo"
rsync -a "$T/arbol-vps/" "$VPS:$DIR/arbol/"
rsync -a "$T/datos/" --include='jornadas.json' --include='inscritos.json' --include='portada.json' --include='feed.json' --include='temporada.json' --exclude='*' "$VPS:$DIR/trabajo/datos/"
rsync -a "$T/activos.json" "$VPS:$DIR/trabajo/"
scp -q tools/publicacion/vps/nginx.conf deploy/publicador-vps/nginx-mapas.inc deploy/publicador-vps/nginx-sitio.inc "$VPS:$DIR/"
ssh -o BatchMode=yes "$VPS" "cd $DIR && chown -R cc-results:cc-results $DIR && runuser -u cc-results -- env CC_GZ=1 CC_ACTIVOS=$DIR/trabajo/activos.json nice -n 10 node --no-warnings repo/tools/publicacion/publicacion.mjs familia --trabajo trabajo 2>&1 | grep -E 'paginas|totalMs|erroresTotal' | tr -d '\n'; echo; ( [ -f nginx.pid ] && runuser -u cc-results -- kill -HUP \$(cat nginx.pid) ) || runuser -u cc-results -- nginx -e $DIR/error.log -p $DIR/ -c nginx.conf 2>&1 | grep -v worker_connections || true"
