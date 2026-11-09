# Mapas y zonas de la web. Se incluye a nivel http.
# Mercado de fichajes: cada equipo y cada división tienen su documento completo.
map "$arg_team|$arg_equipo" $mercado_equipo {
  default "";
  "~^([a-z0-9-]{1,100})\|" $1;
  "~^\|([a-z0-9-]{1,100})$" $1;
}
# Hoy de carretera: un documento por día de la ventana publicada.
map $arg_date $hoy_fecha {
  default "";
  "~^\d{4}-\d{2}-\d{2}$" $arg_date;
}
# Sin fecha, el documento de hoy; con una fecha sin documento, la página que lee datos.
map $arg_date $hoy_sin_fecha_es {
  "" /f/hoy-es/hoy/index.html;
  default /sin-documento;
}
map $arg_date $hoy_sin_fecha_en {
  "" /f/hoy-en/hoy/index.html;
  default /sin-documento;
}
# La portada con una fecha sin documento: directamente la página que lee datos.
map $arg_date $portada_es {
  "" /index.html;
  default /index-ruta.html;
}
map $arg_date $portada_en {
  "" /en/index.html;
  default /en/index-ruta.html;
}
map $arg_div $mercado_division {
  default "";
  "~^(PT|WWT|PRW)$" _$1;
}

# Límites por visitante: la web deja de tener CDN delante.
limit_req_zone $binary_remote_addr zone=cc_datos:10m rate=60r/s;
limit_req_zone $binary_remote_addr zone=cc_funciones:10m rate=5r/s;
limit_conn_zone $binary_remote_addr zone=cc_conexiones:10m;
limit_req_status 429;
limit_conn_status 429;
