// Antes del primer pintado: horas en la zona del visitante, vídeos de su región y alturas
// de los bloques fijos. construir.mjs sustituye el marcador por la detección de región de
// js/shared.js.
(function () {
  /*__GRUPOS__*/
  var en = document.documentElement.lang === 'en';
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  var anio = new Date().getFullYear();
  var comoBuild = en ? !new Date(anio, 0, 1).getTimezoneOffset() && !new Date(anio, 6, 1).getTimezoneOffset() : tz === 'Europe/Madrid';
  var main = document.getElementById('resultsContent');
  if (!comoBuild) {
    var locale = en ? 'en-GB' : 'es-ES';
    main.querySelectorAll('.res-stage-data time[datetime]').forEach(function (el) {
      var d = new Date(el.getAttribute('datetime'));
      if (!isNaN(d)) el.textContent = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    });
    main.querySelectorAll('.res-publication-line time[datetime]').forEach(function (el) {
      var d = new Date(el.getAttribute('datetime'));
      if (!isNaN(d)) el.textContent = d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    });
  }
  // Vídeos de la jornada: fuera las filas de un grupo regional que el visitante no ve
  // (regla de filterBroadcastsByRegion) y la sección si no queda ninguna.
  // Si la fila abierta queda oculta, abre la primera visible insertable, sin arrancarla
  // (applyVideoRegion de js/stage/videos-panel.js).
  var region = _detectUserGroup();
  main.querySelectorAll('.res-videos').forEach(function (seccion) {
    var vistas = 0, abierta = null, primera = null;
    seccion.querySelectorAll('.video-list > .video-fold, .video-list > .video-row').forEach(function (fila) {
      var pais = fila.dataset.country;
      fila.hidden = !!pais && !(pais === 'EUROPA' ? region.isEuropean && region.group !== 'UK_IE' : pais === region.group);
      if (!fila.hidden) vistas++;
      if (fila.tagName !== 'DETAILS') return;
      if (fila.hidden && fila.open) { fila.querySelector('.video-fold__body').innerHTML = ''; fila.open = false; }
      if (!fila.hidden && fila.open) abierta = fila;
      if (!fila.hidden && !primera) primera = fila;
    });
    seccion.hidden = vistas === 0;
    if (primera && !abierta) {
      var marco = document.createElement('iframe');
      marco.className = 'video-frame';
      marco.src = primera.dataset.src;
      marco.title = primera.dataset.title || '';
      marco.loading = 'lazy';
      marco.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      marco.referrerPolicy = 'strict-origin-when-cross-origin';
      marco.allowFullscreen = true;
      primera.querySelector('.video-fold__body').appendChild(marco);
      primera.open = true;
    }
  });
  var cabecera = main.querySelector(':scope > .race-header');
  var pestanas = main.querySelector('.res-tabs-bar');
  var raiz = document.documentElement.style;
  if (cabecera) raiz.setProperty('--results-race-header-h', Math.ceil(cabecera.getBoundingClientRect().height) + 'px');
  if (pestanas) raiz.setProperty('--res-tabs-h', Math.ceil(pestanas.getBoundingClientRect().height) + 'px');
  var rail = document.getElementById('resStagesInner');
  var activa = rail && rail.querySelector('[data-active="true"]');
  if (activa && rail.scrollWidth > rail.clientWidth + 1) rail.scrollLeft = Math.max(0, activa.offsetLeft - (rail.clientWidth - activa.offsetWidth) / 2);
})();
