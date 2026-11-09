# Rutas de la web. Se incluye dentro del server; este define `root` y $sitio_base (sitio base).
# Por visitante, con margen: en móvil muchos comparten IP y cada petición HTTP/2 cuenta.
limit_conn cc_conexiones 256;
# proxy_pass con variable resuelve en cada petición: sin resolver, los datos dan 502. Los mismos que assets.
resolver 1.1.1.1 8.8.8.8 valid=300s ipv6=off;
resolver_timeout 5s;
absolute_redirect off;
charset utf-8;
charset_types text/css application/javascript application/json text/plain text/markdown;
# Tipos que el mime.types de Ubuntu no trae y Pages sí servía: sin ellos, los módulos .mjs del panel no cargan.
include /etc/nginx/mime.types;
types {
  application/javascript mjs;
  text/markdown md;
  font/ttf ttf;
}
index index.html;
gzip_static on;
gzip on;
gzip_vary on;
gzip_comp_level 4;
gzip_min_length 1024;
gzip_types text/css application/javascript application/json image/svg+xml application/xml text/plain text/calendar application/atom+xml;
etag on;
set $supabase bcecwlkynpgovnzhbpah.supabase.co;

# Nombres con hash: nunca cambian.
location ^~ /a/ {
  add_header Cache-Control "public, max-age=31536000, immutable" always;
  add_header Access-Control-Allow-Origin "*" always;
}

# Lecturas públicas: copia de pocos segundos y, ante un fallo, la última buena.
location ^~ /rest/v1/ {
  limit_req zone=cc_datos burst=120 nodelay;
  proxy_pass https://$supabase;
  proxy_set_header Host $supabase;
  proxy_ssl_server_name on;
  proxy_ssl_name $supabase;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_cache datos;
  proxy_cache_methods GET HEAD;
  proxy_cache_key "$request_uri|$http_range|$http_accept|$http_prefer|$http_range_unit";
  proxy_cache_valid 200 206 3s;
  # PostgREST repite la URL en Content-Location: una lista larga de ids no cabe en los 4 KB por defecto.
  proxy_buffer_size 64k;
  proxy_buffers 8 64k;
  proxy_busy_buffers_size 128k;
  proxy_cache_lock on;
  proxy_cache_use_stale updating error timeout http_500 http_502 http_503 http_504;
  proxy_ignore_headers Cache-Control Expires Set-Cookie;
  proxy_cache_bypass $http_authorization;
  proxy_no_cache $http_authorization;
  add_header X-Cache $upstream_cache_status always;
}

# Funciones públicas (aviso de errata de una jornada), sin copia.
location ^~ /functions/v1/ {
  limit_req zone=cc_funciones burst=10 nodelay;
  proxy_pass https://$supabase;
  proxy_set_header Host $supabase;
  proxy_ssl_server_name on;
  proxy_ssl_name $supabase;
  client_max_body_size 64k;
}

location = / {
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  try_files /f/hoy-es/$hoy_fecha/index.html $portada_es @base;
}
location = /en/ {
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  try_files /f/hoy-en/$hoy_fecha/index.html $portada_en @base;
}
location = /index-ruta.html {
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  try_files /f/hoy-es/$hoy_fecha/index.html $hoy_sin_fecha_es /index-ruta.html @base;
}
location = /en/index-ruta.html {
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  try_files /f/hoy-en/$hoy_fecha/index.html $hoy_sin_fecha_en /en/index-ruta.html @base;
}
location ~ "^/campeonatos-nacionales-\d{4}\.html$" {
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  try_files /f/campeonatos-es/index.html @base;
}
location = /fichajes/ {
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  try_files /f/mercado-es/$mercado_equipo/index.html /f/mercado-es/$mercado_division/index.html /fichajes/index.html @base;
}
location = /en/transfers/ {
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  try_files /f/mercado-en/$mercado_equipo/index.html /f/mercado-en/$mercado_division/index.html /en/transfers/index.html @base;
}

# Feeds y sitemap, con los tipos de Pages: nginx sirve .ics como binario y algunas apps de calendario lo rechazan.
location ~ \.ics$ {
  root $sitio_base;
  types { text/calendar ics; }
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
}
location ~ \.xml$ {
  root $sitio_base;
  types { application/xml xml; }
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
}

# Ruta sin barra final ni extensión, como en Pages: <ruta>.html si existe y, si es un directorio,
# redirección con barra (la hace el propio nginx al servir un directorio sin try_files).
location ~ "^/[^.]*[^/]$" {
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  try_files $uri $uri.html @sin_barra;
}
location @sin_barra {
  root $sitio_base;
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  try_files $uri $uri.html @directorio;
}
location @directorio {
  root $sitio_base;
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  error_page 404 /404.html;
}

# Todo lo publicado se revalida: una página nueva se ve en la siguiente petición.
location / {
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  try_files $uri $uri.html $uri/index.html @base;
}

# Sitio base: páginas sin versión publicada, feeds, sitemap y activos versionados.
location @base {
  root $sitio_base;
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
  try_files $uri $uri.html $uri/index.html =404;
  error_page 404 /404.html;
}

# Apps: enlaces universales con el tipo que exigen.
location = /.well-known/apple-app-site-association {
  root $sitio_base;
  default_type application/json;
  add_header Cache-Control "no-cache" always;
  add_header Access-Control-Allow-Origin "*" always;
}
