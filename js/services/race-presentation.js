export const startlistCyclistHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';
export const resultsTrophyHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>';
const CLASS_ORDER = ['stage', 'gc', 'points', 'kom', 'youth', 'teams'];
const CLASS_LABELS = {
  stage:{ es:'Etapa', en:'Stage' }, gc:{ es:'General', en:'GC' }, points:{ es:'Puntos', en:'Points' },
  kom:{ es:'Montaña', en:'KOM' }, youth:{ es:'Jóvenes', en:'Youth' }, teams:{ es:'Equipos', en:'Teams' },
};

export function classificationInventory(config = [], stages = []) {
  const map = new Map(config.map(row => [row.classKind, { ...row }]));
  for (const stage of stages) if (!map.has(stage.classKind)) map.set(stage.classKind, { classKind:stage.classKind });
  return [...map.values()].sort((a,b) => (a.position ?? fallbackOrder(a.classKind)) - (b.position ?? fallbackOrder(b.classKind)) || a.classKind.localeCompare(b.classKind));
}
function fallbackOrder(kind) { const index = CLASS_ORDER.indexOf(kind); return index < 0 ? 10 : index; }
export function classificationLabel(row, lang = 'es') {
  return row?.[lang === 'en' ? 'labelEn' : 'labelEs'] || CLASS_LABELS[row?.classKind]?.[lang] || row?.classKind || '';
}
export function classificationColor(row) {
  if (row?.classKind === 'stage') return null;
  return /^#[0-9a-f]{6}$/i.test(row?.colorHex || '') ? row.colorHex : null;
}
export function visibleStageClassifications(rows = [], inventory = []) {
  const position = new Map(inventory.map((row,index) => [row.classKind,index]));
  return [...rows].sort((a,b) => (position.get(a.classKind) ?? Infinity) - (position.get(b.classKind) ?? Infinity));
}
export async function loadFeaturedRaces(client, dates) {
  if (!dates.length) return new Map();
  const { data, error } = await client.rpc('featured_races_for_dates', { date_keys:[...new Set(dates)] });
  if (error) throw error;
  const byDate = new Map();
  for (const row of data || []) {
    if (!byDate.has(row.dateKey)) byDate.set(row.dateKey,new Set());
    byDate.get(row.dateKey).add(row.raceId);
  }
  return byDate;
}
export function todayRaceState(day, now = Date.now()) {
  if (day.isCancelledDay) return 'cancelled';
  if (day.isRestDay) return 'rest';
  if (day._hasInhouse) return 'results';
  if (day.raceStatus === 'finished') return 'waiting';
  const finish = Date.parse(day.estimatedFinishTimeUtc);
  if (Number.isFinite(finish) && now >= finish) return 'waiting';
  const start = Date.parse(day.neutralStartTimeUtc);
  return day.raceStatus === 'running' || (Number.isFinite(start) && now >= start) ? 'running' : 'scheduled';
}
export function waitingResultsHtml(lang = 'es', element = 'div') {
  const tag = element === 'span' ? 'span' : 'div';
  const label = lang === 'en' ? 'Awaiting results' : 'Esperando resultados';
  return `<${tag} class="race-card__schedule race-card__schedule--waiting" role="status" aria-label="${label}">
    <svg class="race-card__waiting-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 21V3"/>
      <path d="M4 5c3-1.8 5.7-1.45 8.3-.52 3.05 1.1 5.85 1.18 8.7-.58v9.6c-2.85 1.76-5.65 1.68-8.7.58-2.6-.93-5.3-1.28-8.3.52V5Z"/>
      <path d="M4.85 4.58c1.35-.55 2.67-.63 3.95-.48v4.75c-1.28-.15-2.6-.07-3.95.48V4.58Zm7.45-.1c1.52.55 2.98.82 4.4.63v4.74c-1.42.19-2.88-.08-4.4-.63V4.48ZM8.8 8.85c1.14.13 2.3.43 3.5.86v4.75c-1.2-.43-2.36-.73-3.5-.86V8.85Zm7.9 1c1.45-.19 2.87-.68 4.3-1.56v4.75c-1.43.88-2.85 1.37-4.3 1.56V9.85Z" fill="currentColor" stroke="none"/>
    </svg>
    <svg class="race-card__waiting-dots" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="20" cy="12" r="2"/></svg>
  </${tag}>`;
}
export function profileProgress(day, now = Date.now()) {
  if (day.isCancelledDay || day.isRestDay) return 0;
  if (day._hasInhouse || day.raceStatus === 'finished') return 1;
  // Crono en curso: con salidas escalonadas no hay un avance único que pintar.
  if (['itt','ttt'].includes(day.primaryType)) return 0;
  const start = Date.parse(day.realStartTimeUtc || day.neutralStartTimeUtc), finish = Date.parse(day.estimatedFinishTimeUtc);
  return Number.isFinite(start) && finish > start ? Math.max(0, Math.min(1, (now-start)/(finish-start))) : 0;
}
export function hasValidTimeLimit(day) {
  if (!Number.isFinite(Number(day?.timeLimitSeconds)) || Number(day.timeLimitSeconds)<=0 || !Number.isFinite(Date.parse(day?.timeLimitBasis?.verifiedAt))) return false;
  try { return ['http:','https:'].includes(new URL(day.timeLimitBasis.sourceUrl).protocol); }
  catch { return false; }
}

export function formatDurationSeconds(value) {
  const total = Number(value);
  if (!Number.isFinite(total) || total <= 0) return '';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total - hours * 3600) / 60);
  const seconds = Number((total - hours * 3600 - minutes * 60).toFixed(3));
  const [wholeSeconds, fraction] = String(seconds).split('.');
  const secondsText = `${wholeSeconds.padStart(2, '0')}${fraction ? `.${fraction}` : ''}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`;
}

export function parseDurationText(value) {
  const match = String(value ?? '').trim().match(/^(\d+):([0-5]\d):([0-5]\d(?:[.,]\d+)?)$/);
  if (!match) return null;
  const total = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3].replace(',', '.'));
  return Number.isFinite(total) && total > 0 ? total : null;
}

export function classificationIsUpdating(row, now = Date.now()) {
  return row?.publicationStatus === 'provisional' && row.updating === true
    && Number.isFinite(Date.parse(row.updatingUntil)) && now < Date.parse(row.updatingUntil);
}

export function isTttStageClassification({
  rows = [], classKind, isTeams = false, raceDay = null,
  stageNumber = null, isOneDay = false, stageRaceType = null,
} = {}) {
  const eligible = classKind === 'stage'
    || (classKind === 'gc' && stageNumber == null && isOneDay);
  if (isTeams || !eligible) return false;

  const sourceType = String(stageRaceType || '').toUpperCase();
  if (raceDay && raceDay.primaryType !== 'ttt') return false;
  if (!raceDay && ['ITT', 'IRR'].includes(sourceType)) return false;

  const rowIrm = row => String(row.irm || row.resultValue || row.timeText || '').toUpperCase();
  const classified = rows.filter(row => !/^(DNS|DNF|OTL|DSQ|ABD|DF|NR)$/.test(rowIrm(row)));
  const counts = new Map();
  for (const row of classified) if (row.rank != null) counts.set(row.rank, (counts.get(row.rank) || 0) + 1);
  let sharedRanks = 0;
  for (const count of counts.values()) if (count >= 2) sharedRanks++;
  const nullRanks = classified.filter(row => row.rank == null).length;
  const structural = sharedRanks >= 2 || nullRanks >= 2;
  if (!structural) return false;

  if (raceDay?.primaryType === 'ttt' || sourceType === 'TTT') return true;
  return sharedRanks >= 3 || nullRanks >= 6;
}
