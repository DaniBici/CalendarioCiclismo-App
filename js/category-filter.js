export function isTourDelPorvenir(name) {
  return /tour del porvenir/i.test(name || '');
}

// Carrera sin género (`races.gender` nulo): prueba mixta o campeonato con
// pruebas de ambos sexos, como «Campeonatos de Europa». Hoy, Mes y Temporada la
// listan tanto en Masculino como en Femenino. Un objeto sin la columna `gender`
// (la carrera ausente, `{}`) no cuenta como neutro.
export function isGenderNeutral(race) {
  return !!race && race.gender !== undefined && race.gender !== 'male' && race.gender !== 'female';
}
