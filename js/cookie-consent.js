// ─────────────────────────────────────────────────────────────────
//  Cookie Consent Banner + Modal de gestión
//  - Banner en primera visita: auto-cierre en 10s (acepta).
//  - Rueda ⚙ "Elegiré más tarde": cierra sin guardar elección.
//  - Botón "Gestión de cookies" en el footer → modal para cambiar.
// ─────────────────────────────────────────────────────────────────

(function () {
  var KEY = 'cc-cookie-consent'; // 'accepted' | 'rejected'
  var SESSION_KEY = 'cc-cookie-later'; // sesión: "elegiré más tarde"
  var stored = localStorage.getItem(KEY);
  var deferred = sessionStorage.getItem(SESSION_KEY);

  if (stored) {
    window.__cookieConsent = stored;
  } else {
    window.__cookieConsent = 'pending';
  }

  // ── SVGs ────────────────────────────────────────────────────────
  var clockSVG = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="10"/>' +
    '<polyline points="12 6 12 12 16 14"/>' +
    '</svg>';

  var gearSVG = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
    '</svg>';

  // ── Texto compartido (sin mención al temporizador) ─────────────
  var _isEN = (
    (typeof CONFIG !== 'undefined' && CONFIG.enDomain && window.location.hostname === CONFIG.enDomain) ||
    window.location.pathname.startsWith('/en/') ||
    window.location.pathname === '/en'
  );
  var MODAL_TEXT = _isEN
    ? 'We use essential cookies and visit measurement cookies. If you’d rather not be tracked, click Reject.'
    : 'Utilizamos cookies esenciales y de medici\u00f3n de visitas. Si quieres que no te rastreemos, dale a Rechazar.';

  var BANNER_TEXT = _isEN
    ? MODAL_TEXT + ' This notice will auto-close in 10 seconds.'
    : MODAL_TEXT + ' Este aviso se autoocultar\u00e1 en 10 segundos.';

  document.addEventListener('DOMContentLoaded', function () {

    // ════════════════════════════════════════════════════════════
    //  1. BANNER (solo si no hay elección guardada)
    // ════════════════════════════════════════════════════════════
    if (!stored && !deferred) {
      // <aside role="region">: sin landmark el aviso queda fuera de la
      // navegación por regiones y se lo salta quien navegue así.
      var banner = document.createElement('aside');
      banner.id = 'cookieBanner';
      banner.className = 'cookie-banner';
      banner.setAttribute('role', 'region');
      banner.setAttribute('aria-label', _isEN ? 'Cookie notice' : 'Aviso de cookies');
      banner.innerHTML =
        '<div class="cookie-banner__inner">' +
          '<p class="cookie-banner__text">' + BANNER_TEXT + '</p>' +
          '<div class="cookie-banner__buttons">' +
            '<button class="cookie-banner__btn cookie-banner__btn--reject" id="cookieReject">' + (_isEN ? 'Reject' : 'Rechazar') + '</button>' +
            '<button class="cookie-banner__btn cookie-banner__btn--accept" id="cookieAccept">' + (_isEN ? 'Accept' : 'Aceptar') + '</button>' +
            '<button class="cookie-banner__btn cookie-banner__btn--later" id="cookieLater" aria-label="' +
              (_isEN ? 'Decide later' : 'Elegiré más tarde') + '">' + clockSVG + '</button>' +
          '</div>' +
        '</div>';

      document.body.insertBefore(banner, document.body.firstChild);

      // Forzar reflow y mostrar
      banner.offsetHeight; // eslint-disable-line no-unused-expressions
      banner.classList.add('cookie-banner--visible');

      var timer = null;

      function closeBanner(consent) {
        if (timer) clearTimeout(timer);
        if (consent) {
          localStorage.setItem(KEY, consent);
          window.__cookieConsent = consent;
        }
        // Si no hay consent ("later"), no guardamos nada

        banner.classList.remove('cookie-banner--visible');
        banner.addEventListener('transitionend', function () {
          banner.remove();
        });

        if (consent === 'accepted' && typeof window.__loadAnalytics === 'function') {
          window.__loadAnalytics();
        }
      }

      document.getElementById('cookieAccept').addEventListener('click', function () {
        closeBanner('accepted');
      });

      document.getElementById('cookieReject').addEventListener('click', function () {
        closeBanner('rejected');
      });

      var laterBtn = document.getElementById('cookieLater');
      laterBtn.addEventListener('click', function () {
        sessionStorage.setItem(SESSION_KEY, '1');
        closeBanner(null); // cierra sin guardar en localStorage
      });

      // Tooltip que sigue al ratón (solo desktop)
      var tip = document.createElement('div');
      tip.className = 'cookie-tooltip';
      tip.textContent = _isEN ? 'I\u2019ll choose later' : 'Elegir\u00e9 m\u00e1s tarde';
      document.body.appendChild(tip);

      laterBtn.addEventListener('mouseenter', function () {
        tip.classList.add('cookie-tooltip--visible');
      });
      laterBtn.addEventListener('mouseleave', function () {
        tip.classList.remove('cookie-tooltip--visible');
      });
      laterBtn.addEventListener('mousemove', function (e) {
        tip.style.left = e.clientX + 'px';
        tip.style.top = (e.clientY + 18) + 'px';
      });

      // Auto-cierre en 10 segundos → equivale a aceptar
      timer = setTimeout(function () {
        closeBanner('accepted');
      }, 10000);
    }

    // ════════════════════════════════════════════════════════════
    //  2. BOTÓN "Gestión de cookies" en el footer
    // ════════════════════════════════════════════════════════════
    var footer = document.querySelector('.site-footer');
    if (footer) {
      var actions = footer.querySelector('.site-footer__actions');
      if (!actions) {
        actions = document.createElement('p');
        actions.className = 'site-footer__actions';
        footer.appendChild(actions);
      }
      var manageButton = document.createElement('button');
      manageButton.className = 'footer-link footer-link--icon footer-link--cookies';
      manageButton.id = 'cookieManageLink';
      manageButton.type = 'button';
      manageButton.setAttribute('aria-haspopup', 'dialog');
      manageButton.innerHTML = gearSVG + '<span>' + (_isEN ? 'Cookie settings' : 'Gesti\u00f3n de cookies') + '</span>';
      actions.appendChild(manageButton);
    }

    // ════════════════════════════════════════════════════════════
    //  3. MODAL de gestión de cookies
    // ════════════════════════════════════════════════════════════
    var modal = document.createElement('div');
    modal.id = 'cookieModal';
    modal.className = 'cookie-modal';
    modal.innerHTML =
      '<div class="cookie-modal__overlay" id="cookieModalOverlay"></div>' +
      '<div class="cookie-modal__box">' +
        '<button class="cookie-modal__close" id="cookieModalClose" aria-label="' + (_isEN ? 'Close' : 'Cerrar') + '">' +
          '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
          '</svg>' +
        '</button>' +
        '<h2 class="cookie-modal__title">' + (_isEN ? 'Cookie settings' : 'Gesti\u00f3n de cookies') + '</h2>' +
        '<p class="cookie-modal__text">' + MODAL_TEXT + '</p>' +
        '<div class="cookie-modal__buttons">' +
          '<button class="cookie-banner__btn cookie-banner__btn--reject" id="cookieModalReject">' + (_isEN ? 'Reject' : 'Rechazar') + '</button>' +
          '<button class="cookie-banner__btn cookie-banner__btn--accept" id="cookieModalAccept">' + (_isEN ? 'Accept' : 'Aceptar') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    function openModal() {
      modal.classList.add('cookie-modal--open');
    }

    function closeModal() {
      modal.classList.remove('cookie-modal--open');
    }

    function handleModalChoice(consent) {
      localStorage.setItem(KEY, consent);
      window.__cookieConsent = consent;
      closeModal();

      if (consent === 'accepted' && typeof window.__loadAnalytics === 'function') {
        window.__loadAnalytics();
      }
      // Si rechaza y GA ya estaba cargado, desactivar para futuras cargas
      if (consent === 'rejected' && window['ga-disable-' + (typeof CONFIG !== 'undefined' && CONFIG.gaId)]) {
        window['ga-disable-' + CONFIG.gaId] = true;
      }
    }

    document.getElementById('cookieManageLink').addEventListener('click', function () {
      openModal();
    });

    document.getElementById('cookieModalClose').addEventListener('click', closeModal);
    document.getElementById('cookieModalOverlay').addEventListener('click', closeModal);
    document.getElementById('cookieModalAccept').addEventListener('click', function () {
      handleModalChoice('accepted');
    });
    document.getElementById('cookieModalReject').addEventListener('click', function () {
      handleModalChoice('rejected');
    });
  });
})();
