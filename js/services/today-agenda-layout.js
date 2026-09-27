export function agendaCardIsFeatured(sortMode, isFeatured) {
  return sortMode === 'category' && isFeatured === true;
}

export function agendaMetaState(state, { start = null, finish = null, lang = 'es', isTimeTrial = false } = {}) {
  if (state === 'waiting') return { kind: 'waiting' };
  if (state === 'results') return { kind: 'actions' };
  if (state === 'scheduled' && start) {
    return { kind: 'schedule', label: isTimeTrial ? (lang === 'en' ? 'Start' : 'Inicio') : (lang === 'en' ? 'Start' : 'Salida'), value: start, time: 'start' };
  }
  if (state === 'running' && finish) {
    return { kind: 'schedule', label: isTimeTrial ? (lang === 'en' ? 'End' : 'Final') : (lang === 'en' ? 'Finish' : 'Meta'), value: `~${finish}`, time: 'finish' };
  }
  return { kind: 'none' };
}
