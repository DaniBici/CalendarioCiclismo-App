// Script en línea tras la agenda, antes del primer pintado: día, región y zona del visitante sobre
// el HTML ya recibido. Se minifica con la detección de región de js/shared.js (construir.mjs).
(function () {
  /*__GRUPOS__*/
  var doc = document;
  var main = doc.getElementById('raceList');
  var dia = main.dataset.dia;
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  var fecha = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz || undefined });
  var hoy = fecha.format(new Date());
  var pedida = new URLSearchParams(location.search).get('date');
  // Sin fecha, el día del visitante: otro documento si no es el del servidor.
  if (!pedida && hoy !== main.dataset.hoy) {
    location.replace(location.pathname + '?date=' + hoy);
    return;
  }
  // Una fecha sin documento (fuera de la ventana): la página que lee datos.
  if (pedida && pedida !== main.dataset.sirve) {
    location.replace((doc.documentElement.lang === 'en' ? '/en' : '') + '/index-ruta.html?date=' + pedida);
    return;
  }
  // Un día sin carreras trae el siguiente con carreras: la URL lo refleja, como en el navegador.
  if (pedida ? pedida !== dia : dia !== hoy) history.replaceState(null, '', location.pathname + '?date=' + dia);
  doc.querySelectorAll('.date-pill').forEach(function (p) { p.classList.toggle('is-today', p.dataset.dk === hoy); });
  var boton = doc.querySelector('.date-today-btn');
  if (boton) boton.classList.toggle('date-today-btn--visible', dia !== hoy);

  var grupo = _detectUserGroup();
  var clave = grupo.group || (grupo.isEuropean ? '_EU' : '_X');
  doc.querySelectorAll('.race-card__tv,.race-card__revive').forEach(function (hueco) {
    var plantilla = hueco.querySelector('template[data-tv~="' + clave + '"]');
    if (plantilla) hueco.replaceChildren(plantilla.content.cloneNode(true));
    else hueco.querySelectorAll('template').forEach(function (t) { t.remove(); });
  });

  var en = doc.documentElement.lang === 'en';
  var abreviaturas = main.dataset.dias.split(',');
  var formatos = {};
  function hora(zona, d) {
    var f = formatos[zona] || (formatos[zona] = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: zona }));
    return f.format(d);
  }
  doc.querySelectorAll('.race-card[data-hora-utc]').forEach(function (tarjeta) {
    var bloque = tarjeta.querySelector('.race-card__schedule');
    var d = new Date(tarjeta.dataset.horaUtc);
    if (!bloque || isNaN(d)) return;
    var local = hora(tz, d);
    var madrid = hora('Europe/Madrid', d);
    bloque.querySelector('strong').textContent = local;
    if (local !== madrid) bloque.title = (en ? 'Madrid time' : 'Hora Madrid') + ' · ' + madrid;
    else bloque.removeAttribute('title');
    var previo = bloque.querySelector('.race-card__schedule-day');
    if (previo) previo.remove();
    var suyo = fecha.format(d);
    if (suyo !== tarjeta.dataset.dia) {
      var nodo = doc.createElement('span');
      nodo.className = 'race-card__schedule-day';
      nodo.textContent = '(' + abreviaturas[new Date(suyo + 'T12:00:00Z').getUTCDay()] + ')';
      bloque.appendChild(nodo);
    }
  });

  // Con un filtro fijado la lista es otra: espera al JS, que llega enseguida (cliente/isla-hoy.js).
  try {
    if (['pro', 'uwt', 'wwt', 'male', 'female'].indexOf(localStorage.getItem('cc_default_filter')) >= 0) main.style.visibility = 'hidden';
  } catch (e) { /* Sin almacenamiento no hay filtro fijado. */ }

  var pastillas = doc.querySelector('.date-bar__pills');
  var activa = pastillas && pastillas.querySelector('.date-pill.active');
  if (activa) {
    var a = pastillas.getBoundingClientRect();
    var b = activa.getBoundingClientRect();
    pastillas.scrollLeft += (b.left - a.left) - (a.width / 2) + (b.width / 2);
  }
})();
