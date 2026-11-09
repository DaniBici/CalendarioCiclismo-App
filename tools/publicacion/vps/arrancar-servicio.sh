#!/bin/sh
# Lleva este checkout a la copia de pruebas del VPS y reinstala desde ella el servicio cc-publicador,
# sin pasar por /opt ni por GitHub. La instancia de nginx de prueba (8443 y 8444) lee lo que publica.
# Sin efecto en la web ni en los workers.
#   tools/publicacion/vps/arrancar-servicio.sh
set -e
VPS=root@116.203.47.20
DIR=/var/tmp/cc-prototipo
git ls-files -z --cached --others --exclude-standard | COPYFILE_DISABLE=1 tar --null -T - --exclude='android-app/*' --exclude='ios-app/*' --exclude='docs/informes/*' --exclude='archive/*' -czf - 2>/dev/null | ssh -o BatchMode=yes "$VPS" "mkdir -p $DIR/fuente && tar -xzf - -C $DIR/fuente 2>/dev/null"
scp -q tools/publicacion/vps/nginx.conf deploy/publicador-vps/nginx-mapas.inc deploy/publicador-vps/nginx-sitio.inc "$VPS:$DIR/"
ssh -o BatchMode=yes "$VPS" "chown cc-results:cc-results $DIR/nginx.conf $DIR/nginx-mapas.inc $DIR/nginx-sitio.inc; chmod +x $DIR/fuente/deploy/publicador-vps/*.sh; $DIR/fuente/deploy/publicador-vps/install.sh $DIR/fuente; cd $DIR; runuser -u cc-results -- nginx -t -q -e error.log -p . -c nginx.conf || { echo 'nginx.conf no es válido: no se recarga'; exit 1; }; kill -HUP \$(cat nginx.pid)"
