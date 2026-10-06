// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Punto de entrada: guard de autenticación e inicialización del panel
// ─────────────────────────────────────────────────────────────────

import {
  panelDayNavigationHtml, wirePanelDayNavigation,
} from './catalog-ui.js';
import { openCxRaceEditor } from './cx.js';
import { supabase } from '../shared.js';
import { madridDateKey } from '../services/timezone.js';
import { panelState } from './state.js';
import { switchTab, tabFromHash } from './navigation.js';
import {
  ensureRaceLoadedById, ensureRaceYearLoaded, loadRaces, loadSidebar, raceYearFromDateKey,
} from './agenda.js';
import { openEditor } from './jornada-editor.js';
import { openRaceModal, setupModals } from './race-picker.js';
import { setupRacesView } from './races-view.js';
import { fetchTeams, openTeamEditor } from './teams.js';

// ── Guard de autenticación ────────────────────────────────────────
// Antes de expulsar al login, conservar el deep-link (?edit=…, #analytics…)
// para que login.js (devReturnUrl) vuelva aquí tras autenticarse.
function _gotoLogin() {
  const target = location.pathname + location.search + location.hash;
  if (location.search || (location.hash && location.hash !== '#agenda')) {
    sessionStorage.setItem('devReturnUrl', target);
  }
  window.location.href = CONFIG.basePath + '/panel/index.html';
}

supabase.auth.getSession().then(async ({ data: { session } }) => {
  if (!session?.user) {
    _gotoLogin();
    return;
  }
  document.getElementById('userEmail').textContent = 'Dani Sánchez';
  await initPanel();
  const overlay = document.getElementById('panelOverlay');
  if (overlay) {
    overlay.classList.add('panel-overlay--hidden');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
  }
});

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session?.user) {
    _gotoLogin();
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => supabase.auth.signOut());

// Activa una pestaña del editor de jornada cuando exista. El editor carga
// la jornada por red, así que con un deep-link (?edit=…&tab=mas / ?perfil=…)
// las pestañas aún no están montadas: reintentar en vez de un timeout fijo.
function _clickEditorTab(target, tries = 20) {
  const btn = document.querySelector(`#editorTabs .editor-tab[data-target="${target}"]`);
  if (btn) { btn.click(); return; }
  if (tries > 0) setTimeout(() => _clickEditorTab(target, tries - 1), 150);
}

// ── Init panel ────────────────────────────────────────────────────
async function initPanel() {
  document.querySelector('#sidebar .sidebar__header').innerHTML=panelDayNavigationHtml({pickerId:'agendaDate',previousId:'prevDayBtn',nextId:'nextDayBtn',todayId:'todayBtn',addId:'addJornadaBtn',addLabel:'+ Añadir jornada'});
  const datePicker = document.getElementById('agendaDate');
  wirePanelDayNavigation({
    picker:datePicker, previous:document.getElementById('prevDayBtn'),
    next:document.getElementById('nextDayBtn'), today:document.getElementById('todayBtn'),
  }, {
    getDate:()=>panelState.currentDateKey, todayDate:()=>madridDateKey(new Date()),
    onChange:date=>{panelState.currentDateKey=date;loadSidebar();},
  });

  document.getElementById('addJornadaBtn').addEventListener('click', openRaceModal);

  // Cargar carreras
  await loadRaces();

  // Si venimos desde una página pública con query params, navegar a la sección correspondiente
  const _urlEdit   = new URLSearchParams(location.search);
  const _editId    = _urlEdit.get('edit');
  const _cxEditId  = _urlEdit.get('cxEdit');
  const _startlist = _urlEdit.get('startlist');
  const _perfilId  = _urlEdit.get('perfil');
  const _teamId    = _urlEdit.get('team');
  const _tabParam  = _urlEdit.get('tab');

  if (_editId) {
    try {
      const { data: rdData } = await supabase.from('race_days').select('dateKey').eq('id', _editId).single();
      if (rdData?.dateKey) {
        panelState.currentDateKey    = rdData.dateKey;
        datePicker.value  = rdData.dateKey;
      }
    } catch (_) {}
  } else if (_perfilId) {
    try {
      const { data: rdData } = await supabase.from('race_days').select('dateKey').eq('id', _perfilId).single();
      if (rdData?.dateKey) {
        panelState.currentDateKey    = rdData.dateKey;
        datePicker.value  = rdData.dateKey;
      }
    } catch (_) {}
  }
  if ((_editId || _perfilId) && panelState.currentDateKey) {
    await ensureRaceYearLoaded(raceYearFromDateKey(panelState.currentDateKey));
  }
  if (_startlist) {
    await ensureRaceLoadedById(_startlist);
  }

  // Limpiar los query params del deep-link conservando el hash: tabFromHash()
  // se lee más abajo y los marcadores (#analytics…) deben sobrevivir.
  history.replaceState(null, '', location.pathname + location.hash);

  setupModals();
  setupRacesView();
  loadSidebar();
  if (_cxEditId) {
    await openCxRaceEditor(_cxEditId,_tabParam||'identity');
  } else if (_editId) {
    switchTab('agenda', { updateHash: false });
    history.replaceState(null, '', '#agenda');
    openEditor(_editId);
    if (_tabParam) _clickEditorTab(_tabParam);
  } else if (_startlist) {
    switchTab('startlists', { updateHash: false });
    history.replaceState(null, '', '#startlists');
    // allRaces ya está cargado (loadRaces se awaiteó antes de este bloque)
    openStartlistEditor(_startlist);
  } else if (_perfilId) {
    switchTab('agenda', { updateHash: false });
    history.replaceState(null, '', '#agenda');
    openEditor(_perfilId);
    _clickEditorTab('perfil');
  } else if (_teamId) {
    // Deep-link desde la página pública /equipo/<slug>/ ("Editar equipo").
    switchTab('teams', { updateHash: false });
    history.replaceState(null, '', '#teams');
    // switchTab→setupTeamsView es async y no se awaita; garantizamos que el
    // cache de equipos esté cargado antes de abrir el editor del equipo.
    await fetchTeams();
    openTeamEditor(_teamId);
  } else {
    const initialTab = tabFromHash();
    switchTab(initialTab, { updateHash: false });
    history.replaceState(null, '', '#' + initialTab);
  }

}
