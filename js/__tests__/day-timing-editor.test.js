import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../shared.js', () => ({ esc: value => String(value) }));
import { readDayTimingChanges } from '../panel/race-presentation.js';

function editor({ distance = '', duration = '', source = '', basisChanged = false } = {}) {
  const input = (value, disabled) => ({ value, disabled, setCustomValidity(message) { this.error = message; }, checkValidity() { return !this.error; }, reportValidity: vi.fn(), focus: vi.fn() });
  const fields = {
    '[data-toggle=competitive-distance]': { checked: !!distance },
    '[data-toggle=time-limit]': { checked: !!duration },
    '[data-field=competitiveDistanceKm]': input(distance, !distance),
    '[data-field=timeLimitText]': input(duration, !duration),
    '[data-field=sourceUrl]': input(source, !duration),
  };
  const host = { dataset: { timingBasisChanged: String(basisChanged) }, querySelector: key => fields[key], querySelectorAll: () => Object.values(fields).filter(f => f.checkValidity) };
  vi.stubGlobal('document', { getElementById: () => host, querySelector: () => ({ click() {} }) });
  return host;
}
afterEach(() => vi.unstubAllGlobals());
const day = { timeLimitSeconds: 18000, timeLimitBasis: { sourceUrl: 'https://example.org/rules', verifiedAt: '2026-09-01T00:00:00Z', evidence: 'official' } };
it('does not renew an unchanged verification when saving the card', () => {
  editor({ duration: '5:00:00', source: day.timeLimitBasis.sourceUrl });
  expect(readDayTimingChanges(day).timeLimit).toBeNull();
});
it('saves a revised distance and verification while preserving evidence metadata', () => {
  editor({ distance: '110.2', duration: '5:00:00', source: day.timeLimitBasis.sourceUrl, basisChanged: true });
  const changes = readDayTimingChanges(day);
  expect(changes.distance).toEqual({ competitiveDistanceKm: 110.2 });
  expect(changes.timeLimit.timeLimitBasis.evidence).toBe('official');
  expect(changes.timeLimit.timeLimitSeconds).toBe(18000);
  expect(changes.timeLimit.timeLimitBasis.verifiedAt).not.toBe(day.timeLimitBasis.verifiedAt);
});
it('clears a disabled time limit and distance override', () => {
  editor();
  expect(readDayTimingChanges(day)).toEqual({ distance: { competitiveDistanceKm: null }, timeLimit: { timeLimitSeconds: null, timeLimitBasis: null } });
});
it('opens the results section and prevents saving an invalid duration', () => {
  const host = editor({ duration: '5:99:00', source: day.timeLimitBasis.sourceUrl });
  expect(readDayTimingChanges(day)).toBeNull();
  expect(host.open).toBe(true);
});
it('rejects a non-http source', () => {
  editor({ duration: '5:00:00', source: 'javascript:alert(1)' });
  expect(readDayTimingChanges(day)).toBeNull();
});
