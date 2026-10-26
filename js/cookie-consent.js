// ─────────────────────────────────────────────────────────────────
//  Aviso de analítica: consentimiento previo, sin temporizador.
//  - Panel inferior no modal hasta que se elige; sin elección no hay
//    medición (js/analytics.js no carga Google).
//  - «Aceptar analítica» y «Rechazar analítica», mismo estilo y tamaño.
//  - La elección caduca a los 180 días y se vuelve a preguntar.
//  - «Gestión de cookies» en el pie reabre el mismo panel.
//  API: window.ccConsent.get() → 'accepted' | 'rejected' | null,
//  .expiresAt() → caducidad en ms de la elección guardada, .saved() → si la
//  elección vigente está guardada, y el evento 'cc-consent' en window con la
//  elección vigente en detail.
// ─────────────────────────────────────────────────────────────────

(function () {
  var KEY = 'cc-cookie-consent'; // {v, choice, decidedAt, expiresAt}
  var TTL = 180 * 24 * 60 * 60 * 1000;

  var _isEN = (
    (typeof CONFIG !== 'undefined' && CONFIG.enDomain && window.location.hostname === CONFIG.enDomain) ||
    window.location.pathname.startsWith('/en/') ||
    window.location.pathname === '/en'
  );
  var T = _isEN ? {
    title: 'Optional analytics',
    text: 'Google Analytics measures visits with cookies only if you accept. Rejecting does not limit anything on the website. You can change your choice in Cookie settings, at the bottom of every page.',
    more: 'More information',
    privacy: '/en/privacy/#cookies',
    accept: 'Accept analytics',
    reject: 'Reject analytics',
    manage: 'Cookie settings',
    current: { accepted: 'Current choice: analytics accepted.', rejected: 'Current choice: analytics rejected.' },
    unsaved: 'Your choice could not be saved. Analytics remains disabled.'
  } : {
    title: 'Analítica opcional',
    text: 'Solo si aceptas, Google Analytics mide las visitas con cookies. Rechazar no limita nada de la web. Puedes cambiar la elección en Gestión de cookies, al pie de cada página.',
    more: 'Más información',
    privacy: '/privacidad.html#cookies',
    accept: 'Aceptar analítica',
    reject: 'Rechazar analítica',
    manage: 'Gestión de cookies',
    current: { accepted: 'Elección actual: analítica aceptada.', rejected: 'Elección actual: analítica rechazada.' },
    unsaved: 'No se ha podido guardar la elección. La analítica sigue desactivada.'
  };

  // Registro guardado y vigente, o null. Los valores del aviso anterior
  // ('accepted' / 'rejected' en texto plano) no son válidos: la aceptación
  // podía venir del cierre automático a los 10 s y se vuelve a preguntar.
  function readStored() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var c = null;
      try { c = JSON.parse(raw); } catch (e) { /* formato anterior */ }
      var now = Date.now();
      if (!c || c.v !== 1 || (c.choice !== 'accepted' && c.choice !== 'rejected') ||
          !(c.decidedAt <= now) || !(c.expiresAt > now)) {
        localStorage.removeItem(KEY);
        return null;
      }
      return c;
    } catch (e) { return null; }
  }

  function save(choice) {
    try {
      var now = Date.now();
      var raw = JSON.stringify({ v: 1, choice: choice, decidedAt: now, expiresAt: now + TTL });
      localStorage.setItem(KEY, raw);
      return localStorage.getItem(KEY) === raw;
    } catch (e) { return false; }
  }

  try { sessionStorage.removeItem('cc-cookie-later'); } catch (e) { /* retirado */ }

  // Si no se puede guardar la elección, la página queda como rechazada.
  var override = null;
  var record = readStored();

  function get() { return override || (record && record.choice) || null; }

  function publish() {
    window.dispatchEvent(new CustomEvent('cc-consent', { detail: get() }));
  }

  window.ccConsent = {
    get: get,
    expiresAt: function () { return record ? record.expiresAt : null; },
    saved: function () { return !override; }
  };

  var panel = null, status = null, manageButton = null;

  function setOpen(open) {
    if (!panel) return;
    panel.hidden = !open;
    if (manageButton) manageButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function choose(choice) {
    var saved = save(choice);
    if (saved) {
      override = null;
      record = readStored();
      status.textContent = '';
      setOpen(false);
    } else {
      // Sin almacenamiento, la analítica no arranca; un rechazo se aplica
      // igualmente a la página abierta.
      override = 'rejected';
      status.textContent = T.unsaved;
      setOpen(true);
    }
    publish();
  }

  // Otra pestaña, la caché de ida y vuelta o la caducidad cambian la
  // elección vigente: se reconcilian panel y medición.
  function reconcile() {
    var before = get();
    record = readStored();
    if (override && record) override = null;
    if (get() === before) return;
    if (panel && !get()) { status.textContent = ''; setOpen(true); }
    if (panel && get()) setOpen(false);
    publish();
  }
  window.addEventListener('storage', function (e) {
    if (e.key === KEY || e.key === null) reconcile();
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) reconcile(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') reconcile();
  });

  document.addEventListener('DOMContentLoaded', function () {
    // Región con título: se alcanza por landmarks y no bloquea la página.
    // Va al principio del documento para que el teclado la encuentre antes
    // que el contenido, aunque se pinte abajo.
    panel = document.createElement('section');
    panel.id = 'cookiePanel';
    panel.className = 'cookie-panel';
    panel.setAttribute('aria-labelledby', 'cookiePanelTitle');
    panel.hidden = true;
    panel.innerHTML =
      '<h2 class="cookie-panel__title" id="cookiePanelTitle" tabindex="-1">' + T.title + '</h2>' +
      '<p class="cookie-panel__text">' + T.text + ' <a href="' + T.privacy + '">' + T.more + '</a>.</p>' +
      '<p class="cookie-panel__status" role="status" aria-live="polite"></p>' +
      '<div class="cookie-panel__buttons">' +
        '<button type="button" class="cookie-panel__btn" data-choice="accepted">' + T.accept + '</button>' +
        '<button type="button" class="cookie-panel__btn" data-choice="rejected">' + T.reject + '</button>' +
      '</div>';
    document.body.insertBefore(panel, document.body.firstChild);
    status = panel.querySelector('.cookie-panel__status');

    panel.querySelectorAll('[data-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () { choose(btn.getAttribute('data-choice')); });
    });
    // Reabierto desde el pie con una elección vigente, Escape lo cierra sin
    // cambiarla. Sin elección, el panel solo se cierra eligiendo.
    panel.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !get()) return;
      setOpen(false);
      if (manageButton) manageButton.focus();
    });

    var footer = document.querySelector('.site-footer');
    if (footer) {
      var actions = footer.querySelector('.site-footer__actions');
      if (!actions) {
        actions = document.createElement('p');
        actions.className = 'site-footer__actions';
        footer.appendChild(actions);
      }
      manageButton = document.createElement('button');
      manageButton.className = 'footer-link footer-link--icon footer-link--cookies';
      manageButton.id = 'cookieManageLink';
      manageButton.type = 'button';
      manageButton.setAttribute('aria-controls', 'cookiePanel');
      manageButton.setAttribute('aria-expanded', 'false');
      manageButton.innerHTML =
        '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="3"/>' +
          '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
        '</svg><span>' + T.manage + '</span>';
      manageButton.addEventListener('click', function () {
        var choice = get();
        status.textContent = choice ? T.current[choice] : '';
        setOpen(true);
        panel.querySelector('.cookie-panel__title').focus();
      });
      actions.appendChild(manageButton);
    }

    if (!get()) setOpen(true);
  });
})();
