// ════════════════════════════════════════════════════════════════════
// Diálogos propios (confirm / alert) — sin popups nativos del navegador
// ────────────────────────────────────────────────────────────────────
// Sustituyen window.confirm/alert (incómodos, sobre todo en móvil) por un
// overlay con el lenguaje del panel: HOJA INFERIOR en móvil (<=600px),
// diálogo centrado pequeño en desktop. Esc / click-scrim = cancelar.
//
//   await confirmDialog('¿Borrar?')            → Promise<boolean>
//   await confirmDialog('¿Borrar?', {           // opciones
//       title, confirmText, cancelText, danger:true })
//   await alertDialog('Hecho')                  → Promise<void>
//   await alertDialog('Error: …', { title, confirmText })
//   await promptDialog('Nueva fecha:', {        → Promise<string|null>
//       title, confirmText, cancelText, placeholder, value, inputType })
//
// El mensaje respeta saltos de línea (\n) — se renderiza con white-space.
// ════════════════════════════════════════════════════════════════════

let _host = null;

function _ensureHost() {
  if (_host) return _host;
  _host = document.createElement('div');
  _host.className = 'cc-dialog-root';
  _host.innerHTML = `
    <div class="cc-dialog__scrim"></div>
    <div class="cc-dialog" role="dialog" aria-modal="true" aria-labelledby="ccDialogTitle">
      <h2 class="cc-dialog__title" id="ccDialogTitle"></h2>
      <div class="cc-dialog__msg"></div>
      <input type="text" class="cc-dialog__input" style="display:none">
      <div class="cc-dialog__actions">
        <button class="btn btn--ghost cc-dialog__cancel"></button>
        <button class="btn btn--primary cc-dialog__ok"></button>
      </div>
    </div>`;
  document.body.appendChild(_host);
  return _host;
}

// Núcleo: abre el diálogo y resuelve con true (ok) / false (cancelar).
// mode: 'confirm' muestra ambos botones; 'alert' solo el de aceptar.
function _open(mode, message, opts = {}) {
  return new Promise((resolve) => {
    const host = _ensureHost();
    const dialog = host.querySelector('.cc-dialog');
    const titleEl = host.querySelector('.cc-dialog__title');
    const msgEl = host.querySelector('.cc-dialog__msg');
    const inputEl = host.querySelector('.cc-dialog__input');
    const okBtn = host.querySelector('.cc-dialog__ok');
    const cancelBtn = host.querySelector('.cc-dialog__cancel');
    const scrim = host.querySelector('.cc-dialog__scrim');

    const isPrompt = mode === 'prompt';
    const showCancel = mode === 'confirm' || isPrompt;

    const title = opts.title || (mode === 'alert' ? 'Aviso' : 'Confirmar');
    titleEl.textContent = title;
    titleEl.style.display = title ? '' : 'none';
    msgEl.textContent = message || '';

    // Campo de texto solo en modo prompt
    if (isPrompt) {
      inputEl.type = opts.inputType || 'text';
      inputEl.placeholder = opts.placeholder || '';
      inputEl.value = opts.value || '';
      inputEl.style.display = '';
    } else {
      inputEl.style.display = 'none';
    }

    okBtn.textContent = opts.confirmText || (mode === 'alert' ? 'Entendido' : 'Aceptar');
    okBtn.classList.toggle('btn--danger', !!opts.danger);
    okBtn.classList.toggle('btn--primary', !opts.danger);
    cancelBtn.textContent = opts.cancelText || 'Cancelar';
    cancelBtn.style.display = showCancel ? '' : 'none';

    const prevFocus = document.activeElement;

    const close = (result) => {
      host.classList.remove('is-open');
      document.removeEventListener('keydown', onKey, true);
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      scrim.removeEventListener('click', onCancel);
      // Restaurar foco tras la transición
      setTimeout(() => {
        if (prevFocus && typeof prevFocus.focus === 'function') {
          prevFocus.focus({ preventScroll: true });
        }
      }, 0);
      resolve(result);
    };
    // En prompt: OK resuelve con el valor del campo; Cancel/Esc/scrim → null.
    const onOk = () => close(isPrompt ? inputEl.value : true);
    const onCancel = () => close(isPrompt ? null : false);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
      else if (e.key === 'Enter') { e.stopPropagation(); onOk(); }
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    scrim.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey, true);

    host.classList.add('is-open');
    requestAnimationFrame(() => {
      (isPrompt ? inputEl : okBtn).focus({ preventScroll: true });
      if (isPrompt) inputEl.select();
    });
  });
}

/** Confirmación → Promise<boolean> (true = aceptar). */
export function confirmDialog(message, opts = {}) {
  return _open('confirm', message, opts);
}

/** Aviso → Promise<void> (se resuelve al cerrar). */
export function alertDialog(message, opts = {}) {
  return _open('alert', message, opts).then(() => undefined);
}

/** Entrada de texto → Promise<string|null> (null = cancelar). */
export function promptDialog(message, opts = {}) {
  return _open('prompt', message, opts);
}
