// ─────────────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────────────

import { supabase } from './shared.js';

// Marcar que el módulo está activo
document.getElementById('loginBtn').dataset.moduleLoaded = '1';

// Si ya hay sesión activa, redirigir directamente al panel
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session?.user) {
    const returnUrl = sessionStorage.getItem('devReturnUrl');
    if (returnUrl) {
      sessionStorage.removeItem('devReturnUrl');
      window.location.href = returnUrl;
    } else {
      window.location.href = CONFIG.basePath + '/panel/app.html';
    }
  }
});

const loginForm = document.getElementById('loginForm');
const loginBtn  = document.getElementById('loginBtn');
const errorDiv  = document.getElementById('loginError');

function showError(msg) {
  errorDiv.textContent = msg;
  errorDiv.style.display = 'block';
}

async function doLogin() {
  // FormData lee los valores reales del formulario, incluidos los
  // autocompletados por iOS/Chrome que no siempre sincronizan .value
  const fd       = new FormData(loginForm);
  const email    = (fd.get('email') || '').trim();
  const password = fd.get('password') || '';

  if (!email || !password) {
    showError('Introduce email y contraseña.');
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = 'Entrando…';
  errorDiv.style.display = 'none';

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Entrar';
    const msg = error.message || '';
    if (/invalid.*credentials|wrong.*password|user.*not.*found/i.test(msg) || error.status === 400) {
      showError('Email o contraseña incorrectos.');
    } else if (/too.*many.*requests|rate.*limit/i.test(msg) || error.status === 429) {
      showError('Demasiados intentos. Espera unos minutos.');
    } else {
      showError('Error: ' + msg);
    }
  }
  // En caso de éxito, Supabase dispara onAuthStateChange y la redirección
  // la hace el listener de getSession/onAuthStateChange de arriba.
  // Pero para mayor fiabilidad, redirigimos aquí también.
  if (!error) {
    const returnUrl = sessionStorage.getItem('devReturnUrl');
    if (returnUrl) {
      sessionStorage.removeItem('devReturnUrl');
      window.location.href = returnUrl;
    } else {
      window.location.href = CONFIG.basePath + '/panel/app.html';
    }
  }
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  // Micro-delay para que iOS asiente valores autocompletados antes de leer
  setTimeout(() => doLogin(), 16);
});
