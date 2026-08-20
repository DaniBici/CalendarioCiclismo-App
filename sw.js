// ── Service Worker — TOMBSTONE ───────────────────────────────────
// El push web se retiró el 2026-07-17: las notificaciones viven solo en las
// apps iOS/Android. Este SW ya no hace nada — se limita a desregistrarse.
//
// NO se borra el fichero a propósito. Los service workers ya instalados en
// los navegadores de los usuarios SOBREVIVEN al borrado: el navegador
// reintenta buscarlo periódicamente y, si diera 404, el desregistro no es ni
// inmediato ni fiable en todos los navegadores. Sirviendo este SW vacío, el
// update check lo instala y él mismo se retira, de forma limpia y activa.
//
// Antes registraba los handlers `push` y `notificationclick` (lo instalaba
// js/push-web.js, ya borrado) y mapeaba los deep links de las apps a URLs web.
//
// Se puede borrar de verdad cuando haya pasado tiempo de sobra para dar por
// desregistrados a los navegadores que lo tuvieran (meses, no semanas). Sin
// prisa: no pesa nada y no hace nada.

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    self.registration.unregister().then(function () {
      // Recargar las pestañas abiertas para que suelten el SW ya desregistrado.
      return self.clients.matchAll({ type: 'window' });
    }).then(function (list) {
      for (var i = 0; i < list.length; i++) list[i].navigate(list[i].url);
    })
  );
});
