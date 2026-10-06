// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Navegación entre vistas (rail lateral y hash)
// ─────────────────────────────────────────────────────────────────

import { mountCxPanel, showCxTab, areaAgenda } from './cx.js';
import { supabase, countryFlag, categoryBadge } from '../shared.js';
import { openDrawer, closeDrawer } from '../components/drawer.js';
import { panelState } from './state.js';
import { showToast } from './helpers.js';
import { attachInlineUpload, R2_PUBLIC_BASE, r2PutObject, r2PutTechnicalGuide } from './uploads.js';
import { setupOperationsView } from './operations.js';
import { applyRacesSubview } from './races-view.js';
import { setupAnalyticsView } from './analytics.js';
import { setupStartlistsView } from './startlists.js';
import { setupTeamsView } from './teams.js';
import { setupRidersView } from './riders.js';
import { setupNotificationsView } from './notifications.js';
import { setupHighlightsView } from './highlights.js';
import { setupFichajesView } from './fichajes.js';

// ═════════════════════════════════════════════════════════════════
//  VISTA DE CARRERAS
// ═════════════════════════════════════════════════════════════════

// ── Navegación (rail lateral; antes pestañas) ─────────────────────
export function initTabs() {
  mountCxPanel({supabase,openDrawer,closeDrawer,showToast,attachInlineUpload,countryFlag,categoryBadge,navigate:switchTab,r2PutObject,r2PutTechnicalGuide,r2PublicBase:R2_PUBLIC_BASE});
  document.querySelectorAll('.rail-item[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Logo → Agenda
  const logoHome = document.getElementById('logoHome');
  if (logoHome) logoHome.addEventListener('click', e => { e.preventDefault(); switchTab(areaAgenda()); });

  // Navegación con botones atrás/adelante del navegador
  window.addEventListener('hashchange', () => switchTab(tabFromHash(), { updateHash: false }));
}

const VALID_TABS = new Set(['agenda', 'startlists', 'riders', 'teams', 'analytics', 'operations', 'races', 'notifications', 'highlights', 'fichajes', 'cxAgenda', 'cxRaces', 'cxTournaments', 'cxStartlists', 'cxRiders', 'cxTeams']);

export function tabFromHash() {
  const hash = location.hash.slice(1);
  return VALID_TABS.has(hash) ? hash : areaAgenda();
}

export function switchTab(tab, { updateHash = true } = {}) {
  closeDrawer(1);
  showCxTab(tab);
  // Rail lateral (nav permanente): .rail-item[data-tab].
  document.querySelectorAll('.rail-item').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab)
  );
  const isAgenda        = tab === 'agenda';
  const isRaces         = tab === 'races';
  const isAnalytics     = tab === 'analytics';
  const isOperations    = tab === 'operations';
  const isStartlists    = tab === 'startlists';
  const isRiders        = tab === 'riders';
  const isTeams         = tab === 'teams';
  const isNotifications = tab === 'notifications';
  const isHighlights    = tab === 'highlights';
  const isFichajes      = tab === 'fichajes';
  document.querySelector('.panel-body').style.display                  = isAgenda        ? 'flex' : 'none';
  document.getElementById('racesView').style.display                   = isRaces         ? 'flex' : 'none';
  document.getElementById('racesView').style.flexDirection             = 'column';
  document.getElementById('analyticsView').style.display               = isAnalytics     ? 'flex' : 'none';
  document.getElementById('operationsView').style.display              = isOperations    ? 'flex' : 'none';
  document.getElementById('startlistsView').style.display              = isStartlists    ? 'flex' : 'none';
  document.getElementById('ridersView').style.display                  = isRiders        ? 'flex' : 'none';
  document.getElementById('teamsView').style.display                   = isTeams         ? 'flex' : 'none';
  document.getElementById('notificationsView').style.display           = isNotifications ? 'flex' : 'none';
  document.getElementById('highlightsView').style.display              = isHighlights    ? 'flex' : 'none';
  document.getElementById('fichajesView').style.display                = isFichajes      ? 'flex' : 'none';
  // La vista Carreras tiene dos subvistas (Carreras / Challenges) con toggle
  // propio; al entrar se renderiza la subvista activa.
  if (isRaces)         applyRacesSubview(panelState._racesSubview);
  if (isAnalytics)     setupAnalyticsView();
  if (isOperations)    setupOperationsView();
  if (isStartlists)    setupStartlistsView();
  if (isRiders)        setupRidersView();
  if (isTeams)         setupTeamsView();
  if (isNotifications) setupNotificationsView();
  if (isHighlights)    setupHighlightsView();
  if (isFichajes)      setupFichajesView();
  if (updateHash) history.pushState(null, '', '#' + tab);
}
