// Antes del primer pintado: horas en la zona del visitante y alturas de los bloques fijos.
(function () {
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
  var cabecera = main.querySelector(':scope > .race-header');
  var pestanas = main.querySelector('.res-tabs-bar');
  var raiz = document.documentElement.style;
  if (cabecera) raiz.setProperty('--results-race-header-h', Math.ceil(cabecera.getBoundingClientRect().height) + 'px');
  if (pestanas) raiz.setProperty('--res-tabs-h', Math.ceil(pestanas.getBoundingClientRect().height) + 'px');
  var rail = document.getElementById('resStagesInner');
  var activa = rail && rail.querySelector('[data-active="true"]');
  if (activa && rail.scrollWidth > rail.clientWidth + 1) rail.scrollLeft = Math.max(0, activa.offsetLeft - (rail.clientWidth - activa.offsetWidth) / 2);
})();
