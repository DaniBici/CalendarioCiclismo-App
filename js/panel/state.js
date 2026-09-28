// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — estado mutable compartido entre módulos
// ─────────────────────────────────────────────────────────────────
// Variables que antes eran `let` de primer nivel en js/panel.js y que leen o
// escriben varios módulos. Se agrupan en un único objeto porque un binding
// importado es de solo lectura.

import { madridDateKey } from '../services/timezone.js';
import { CURRENT_TEAM_SEASON } from './constants.js';

export const panelState = {
  // ── Agenda y editor de jornada ──
  // La agenda abre SIEMPRE en el día en curso (antes recordaba el último día
  // visitado vía localStorage 'panel_dateKey' y resultaba incómodo).
  currentDateKey: madridDateKey(new Date()),
  currentRaceDayId: null,
  allRaces: [],
  allRacesFullyLoaded: false,
  allRacesLoadPromise: null,
  currentDayRaceIds: new Set(), // raceIds que ya tienen jornada en currentDateKey
  _editorCache: null, // { rd, broadcasts, assets } | null — evita releer Firestore tras guardar
  _profileDigitizerCleanup: null,
  _raceDaySaveInFlight: false,

  // ── Vista de carreras ──
  // Los challenges agrupan varias carreras (challenge_groups.raceIds) y se usan
  // en pocas carreras → no merecen un tab propio en el rail; viven aquí, como
  // una segunda subvista que comparte cabecera con Carreras.
  _racesSubview: 'races',
  // Flag para saber si nueva carrera viene de la vista de carreras
  _newRaceFromRacesView: false,

  // ── Inscritos ──
  _editingRaceId: null,
  _editingRaceProvisional: false, // toggle "Lista provisional"
  _slTeamMatchIndex: new Map(),

  // ── Equipos ──
  _teamsCache: null, // todos los equipos (ordenados por nombre)
  _editingTeamId: null, // null = creando nuevo
  // Alta desde «+ Equipo <MARKET_SEASON>»: el equipo NACE en la temporada del
  // mercado → al insertarlo en `teams` se le fija firstSeason para que el trigger
  // sync_team_to_season NO le estampe una temporada del año en curso (mig. 129).
  // Se resetea en cada openTeamEditor y se consume en el INSERT de saveTeam.
  _newTeamMarketBorn: false,
  _teamsListYear: new Date().getFullYear(),

  // ── Plantilla y temporada del equipo ──
  _editingTeamSeasonYear: CURRENT_TEAM_SEASON,
  _editingTeamIsSeason: false,
  _rosterTeamId: null,
  _season27Row: null, // nombre heredado para conservar el mínimo diff interno

  // ── Corredores ──
  // Género del corredor sobre el que opera el editor/fusión (riders_men/women).
  // Lo fija la búsqueda, la plantilla o el editor de movimientos antes de abrir
  // la ficha.
  _ridersGender: 'male',
  _editingRiderId: null,
  _ridersAllCache: [], // ficha(s) en memoria que el editor puede leer
  // Callback de UN SOLO USO que dispara saveRider al guardar. Lo arma quien abre
  // el editor desde otro flujo y necesita la ficha recién creada (hoy: el editor
  // de un movimiento del mercado, que la deja seleccionada). Se limpia al usarse
  // y al abrir el editor por la vía normal → nunca se dispara de más.
  _onRiderSavedOnce: null,

  // ── Fichajes ──
  _transfersCache: [], // filas de rider_transfers + .rider hidratado
  _marketSeasons: [], // filas team_seasons del mercado (lista de equipos)
  _trTeamNameById: new Map(), // teamId → nombre 2027 (destino)
};
