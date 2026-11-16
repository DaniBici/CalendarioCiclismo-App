// Script en línea tras <main>, antes del primer pintado: resuelve lo que depende
// del visitante (zona y región) sobre el HTML ya recibido. Se minifica junto con
// la detección de región de js/shared.js (construir.mjs sustituye el marcador).
(function () {
  /*__GRUPOS__*/
  var doc = document;
  var main = doc.querySelector('main');
  var en = doc.documentElement.lang === 'en';
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  var grupo = _detectUserGroup();
  var clave = grupo.group || (grupo.isEuropean ? '_EU' : '_X');
  var año = new Date().getFullYear();
  // Mismo criterio que visitorTimeZoneLabel(): EN en una zona sin desplazamiento
  // en todo el año conserva la hora GMT escrita.
  var comoBuild = en
    ? !new Date(año, 0, 1).getTimezoneOffset() && !new Date(año, 6, 1).getTimezoneOffset()
    : tz === 'Europe/Madrid';
  var formatos = {};
  function hora(zona, d) {
    var f = formatos[zona] || (formatos[zona] = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: zona }));
    return f.format(d);
  }
  var fecha = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz || undefined });
  function horas(raiz) {
    if (comoBuild) return;
    var dias = main.dataset.dias.split(',');
    var clave = main.dataset.dateKey;
    raiz.querySelectorAll('time[datetime]').forEach(function (el) {
      var d = new Date(el.getAttribute('datetime'));
      if (isNaN(d)) return;
      var local = hora(tz, d);
      var madrid = hora('Europe/Madrid', d);
      var dia = fecha.format(d);
      var abreviatura = dia === clave ? null : dias[new Date(dia + 'T12:00:00Z').getUTCDay()];
      var lugar = el.closest('.route-block__place');
      var celda = el.closest('.tv-entry__time');
      el.textContent = celda && abreviatura ? local + ' (' + abreviatura + ')' : local;
      if (lugar) {
        var previo = lugar.querySelector('.route-block__day');
        if (previo) previo.remove();
        if (abreviatura) {
          var nodo = doc.createElement('div');
          nodo.className = 'route-block__day';
          nodo.textContent = '(' + abreviatura + ')';
          lugar.appendChild(nodo);
        }
        if (local !== madrid && !en) lugar.dataset.tooltip = (lugar.dataset.tooltip || '').split(' · Madrid')[0] + ' · Madrid: ' + madrid;
      }
      if (celda && local !== madrid) {
        celda.classList.add('tv-entry__time--tz');
        celda.dataset.tooltip = 'Madrid: ' + madrid;
      }
    });
    if (!en) {
      var titulo = raiz.querySelector('.route-grid__block:last-child .route-grid__title[data-tooltip]');
      if (titulo) titulo.dataset.tooltip = main.dataset.tzTexto;
    }
  }
  // Panel de TV de la región. Sin panel en el HTML: en la mampostería de la
  // jornada con vídeos, en la columna principal (Revive al final; la TV, tras
  // el perfil); si no, Revive tras la Información y la TV tras el perfil.
  function panel(raiz) {
    var plantilla = raiz.querySelector('template[data-tv~="' + clave + '"]');
    if (!plantilla) return;
    var actual = raiz.querySelector('.tv-panel');
    var nuevo = plantilla.content.cloneNode(true);
    if (actual) { actual.replaceWith(nuevo); return; }
    var seccion = nuevo.firstElementChild;
    if (!seccion) return;
    var revive = seccion.classList.contains('tv-panel--revive');
    var principal = raiz.querySelector('.stage-profile-layout--videos > .stage-main');
    if (principal) {
      var perfilPanel = principal.querySelector('.stage-profile-panel');
      if (revive) principal.appendChild(nuevo);
      else if (perfilPanel) perfilPanel.after(nuevo);
      else principal.prepend(nuevo);
      return;
    }
    var info = revive && raiz.querySelector('.stage-text-panel');
    if (info) { info.after(nuevo); return; }
    var perfil = raiz.querySelector('[data-integrated-profile]');
    if (perfil) perfil.after(nuevo);
  }
  // Panel Vídeos de la región, en la columna lateral de la mampostería.
  function videos(raiz) {
    var plantilla = raiz.querySelector('template[data-videos~="' + clave + '"]');
    if (!plantilla) return;
    var actual = raiz.querySelector('.video-panel');
    var nuevo = plantilla.content.cloneNode(true);
    if (actual) { actual.replaceWith(nuevo); return; }
    var lateral = raiz.querySelector('.stage-profile-layout--videos > .stage-side');
    if (lateral && nuevo.firstElementChild) lateral.insertBefore(nuevo, lateral.querySelector('.stage-side__actions'));
  }
  function anchoTv(raiz) {
    raiz.querySelectorAll('.tv-panel').forEach(function (p) {
      var filas = [].filter.call(p.querySelectorAll('.tv-panel__list>.tv-entry,.tv-panel__list>.info-row'), function (el) { return el.style.display !== 'none'; });
      p.classList.toggle('tv-panel--single', filas.length <= 1);
    });
  }
  window.ccVisitante = function (raiz) { panel(raiz); videos(raiz); horas(raiz); anchoTv(raiz); };
  window.ccVisitante(doc);
  var hueco = doc.querySelector('.stage-side__actions');
  var barra = doc.getElementById('icalBar');
  if (hueco && barra && matchMedia('(min-width: 761px)').matches) hueco.append(barra);
})();
