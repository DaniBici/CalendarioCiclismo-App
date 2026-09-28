import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  gapToSeconds,
  normalizeAbsoluteTime,
  normalizeGap,
  normalizeResultsDocument,
  validateResultsDocument,
} from '../data-preflight/results-preflight.mjs';
import { buildPlan } from '../results-fetchers/results-upsert.mjs';

const fixture = (name) => JSON.parse(readFileSync(resolve('scripts/data-preflight/fixtures', name), 'utf8'));
const errorCodes = (report) => report.errors.map((entry) => entry.code);

describe('preflight de resultados', () => {
  it('normaliza tiempos de imprenta, gaps, mismo tiempo, absolutos e IRM', () => {
    const normalized = normalizeResultsDocument(fixture('results-normalization.json'));
    const classification = normalized.stages[0].classifications[0];

    expect(classification).toMatchObject({ rowCount: 5, winnerName: 'Matteo Jorgenson' });
    expect(classification.rows[0]).toMatchObject({ rank: 1, timeText: '4:32:54', gapText: null, resultValue: '4:32:54' });
    expect(classification.rows[1]).toMatchObject({ rank: 2, timeText: null, gapText: '+00', resultValue: '+00' });
    expect(classification.rows[2]).toMatchObject({ rank: 3, gapText: '+08', resultValue: '+08' });
    expect(classification.rows[3]).toMatchObject({ rank: 4, gapText: '+1:02', resultValue: '+1:02' });
    expect(classification.rows[4]).toMatchObject({ rank: null, rankText: 'DNF', irm: 'DNF', timeText: null, gapText: null });
  });

  it('acepta el corpus normalizado y cruza dorsales con la startlist', () => {
    const normalized = normalizeResultsDocument(fixture('results-normalization.json'));
    const report = validateResultsDocument(normalized, {
      startlistBibs: new Set(['11', '12', '21', '22', '31']),
    });

    expect(report.ok).toBe(true);
    expect(report.summary).toEqual({ stages: 1, classifications: 1, rows: 5 });
  });

  it('bloquea gaps no monótonos, dorsales duplicados y clasificados tras IRM', () => {
    const normalized = normalizeResultsDocument(fixture('results-normalization.json'));
    const rows = normalized.stages[0].classifications[0].rows;
    rows[2].bib = '12';
    rows[2].gapText = '+2:00';
    rows[2].resultValue = '+2:00';
    rows[3].gapText = '+1:02';
    rows[3].resultValue = '+1:02';
    [rows[3], rows[4]] = [rows[4], rows[3]];

    const report = validateResultsDocument(normalized);

    expect(errorCodes(report)).toEqual(expect.arrayContaining([
      'DUPLICATE_BIB',
      'NON_MONOTONIC_GAP',
      'CLASSIFIED_AFTER_IRM',
    ]));
  });

  it('conserva un tiempo asignado reglamentariamente tras comprobarlo en la fuente', () => {
    const normalized = normalizeResultsDocument(fixture('results-normalization.json'));
    const rows = normalized.stages[0].classifications[0].rows;
    rows[2].gapText = '+2:00';
    rows[2].resultValue = '+2:00';
    rows[3].gapText = '+00';
    rows[3].resultValue = '+00';

    const report = validateResultsDocument(normalized, { allowNonMonotonicGaps: true });

    expect(report.ok).toBe(true);
    expect(report.warnings.map((entry) => entry.code))
      .toContain('NON_MONOTONIC_GAP_ASSIGNED_TIME');
  });

  it('bloquea una coincidencia de dorsales inferior al 90 %', () => {
    const normalized = normalizeResultsDocument(fixture('results-normalization.json'));
    const report = validateResultsDocument(normalized, { startlistBibs: new Set(['11']) });

    expect(errorCodes(report)).toContain('LOW_STARTLIST_MATCH');
  });

  it('bloquea una clasificación recortada respecto al recuento de la fuente', () => {
    const normalized = normalizeResultsDocument(fixture('results-normalization.json'));
    normalized.stages[0].classifications[0].expectedRowCount = 6;

    const report = validateResultsDocument(normalized);

    expect(errorCodes(report)).toContain('EXPECTED_ROW_COUNT_MISMATCH');
  });

  it.each(['DF', 'NR'])('conserva el estado IRM %s', (irm) => {
    const normalized = normalizeResultsDocument({
      raceId: 'irm-race',
      stages: [{
        stageNumber: 1,
        classifications: [{
          eventId: -170001,
          eventName: 'Stage',
          classKind: 'stage',
          scope: 'stage',
          rows: [{ bib: '11', status: irm }],
        }],
      }],
    });

    expect(normalized.stages[0].classifications[0].rows[0]).toMatchObject({
      rank: null,
      rankText: irm,
      irm,
    });
  });

  it('bloquea identificadores de carrera ausentes o incompatibles', () => {
    const normalized = normalizeResultsDocument(fixture('results-normalization.json'));
    const mismatch = validateResultsDocument(normalized, {
      expectedRaceId: 'otra-carrera',
      startlistRaceId: 'otra-startlist',
    });
    delete normalized.raceId;
    const missing = validateResultsDocument(normalized);

    expect(errorCodes(mismatch)).toEqual(expect.arrayContaining([
      'RACE_ID_MISMATCH',
      'STARTLIST_RACE_ID_MISMATCH',
    ]));
    expect(errorCodes(missing)).toContain('MISSING_RACE_ID');
  });

  it('valida el contrato triple y el orden de puntos', () => {
    const document = {
      stages: [{
        stageNumber: 1,
        raceType: 'RR',
        classifications: [{
          eventId: -173002,
          eventName: 'Overall Points Classification',
          classKind: 'points',
          scope: 'overall',
          isTeamEvent: false,
          winnerName: 'Corredor Uno',
          rowCount: 2,
          expectedRowCount: 2,
          rows: [
            { rank: 1, rankText: '1', bib: '11', riderDisplay: 'Corredor Uno', points: 10, resultValue: '10', timeText: '10', gapText: null, irm: null },
            { rank: 2, rankText: '2', bib: '12', riderDisplay: 'Corredor Dos', points: 12, resultValue: '11', timeText: '12', gapText: null, irm: null },
          ],
        }],
      }],
    };

    const report = validateResultsDocument(document);

    expect(errorCodes(report)).toEqual(expect.arrayContaining(['INVALID_POINTS_ROW', 'NON_MONOTONIC_POINTS']));
  });

  it('valida clasificaciones de equipos y conserva el ganador por teamName', () => {
    const normalized = normalizeResultsDocument({
      raceId: 'eval-teams',
      stages: [{
        stageNumber: 1,
        raceType: 'TTT',
        classifications: [{
          eventId: -173003,
          eventName: 'Overall Teams Classification',
          classKind: 'teams',
          scope: 'overall',
          isTeamEvent: true,
          expectedRowCount: 2,
          rows: [
            { rankText: '1', teamName: 'Equipo Uno', timeText: '1:02:03' },
            { rankText: '2', teamName: 'Equipo Dos', gapText: '+12' },
          ],
        }],
      }],
    });

    expect(normalized.stages[0].classifications[0].winnerName).toBe('Equipo Uno');
    expect(validateResultsDocument(normalized).ok).toBe(true);
  });

  it('valida la secuencia de líderes y compañeros en una CRE', () => {
    const base = {
      raceId: 'eval-ttt',
      stages: [{
        stageNumber: 1,
        raceType: 'TTT',
        classifications: [{
          eventId: -173004,
          eventName: 'Stage Classification',
          classKind: 'stage',
          scope: 'stage',
          isTeamEvent: false,
          expectedRowCount: 2,
          rows: [
            { rankText: '1', bib: '11', riderDisplay: 'Líder', teamName: 'Equipo Uno', timeText: '1:02:03' },
            { rankText: null, bib: '12', riderDisplay: 'Compañero', teamName: 'Equipo Uno' },
          ],
        }],
      }],
    };
    const valid = normalizeResultsDocument(base);
    const invalid = structuredClone(valid);
    invalid.stages[0].classifications[0].rows[1].teamName = 'Equipo Dos';

    expect(validateResultsDocument(valid).ok).toBe(true);
    expect(errorCodes(validateResultsDocument(invalid))).toContain('INVALID_TTT_TEAM_SEQUENCE');
  });

  it('normaliza dialectos de tiempo y gap sin reinterpretar centésimas', () => {
    expect(normalizeAbsoluteTime("32'52\"17")).toBe('0:32:52');
    expect(normalizeAbsoluteTime("4h32'52\"17")).toBe('4:32:52');
    expect(normalizeAbsoluteTime('1:02:03.98')).toBe('1:02:03');
    expect(normalizeGap("+1'02\"17")).toBe('+1:02');
    expect(normalizeGap("+1h02'03\"17")).toBe('+1:02:03');
    expect(normalizeGap('+8\"17')).toBe('+08');
    expect(gapToSeconds('+1:02')).toBe(62);
  });

  it('acepta filas compactas por dorsal y las expande al contrato interno', () => {
    const normalized = normalizeResultsDocument({
      raceId: 'compacta',
      stages: [{
        stageNumber: 1,
        raceType: 'RR',
        classifications: [{
          eventId: -173005,
          eventName: 'Etapa 1',
          classKind: 'stage',
          scope: 'stage',
          isTeamEvent: false,
          expectedRowCount: 3,
          rows: [
            { dorsal: '#11', position: 1, value: '4h 32m 54s' },
            { bib: '12', position: 2, value: 'm.t.' },
            { bib: '13', position: 'Abandon' },
          ],
        }],
      }],
    });
    const rows = normalized.stages[0].classifications[0].rows;

    expect(rows).toEqual([
      expect.objectContaining({ bib: '11', rank: 1, rankText: '1', timeText: '4:32:54', gapText: null, resultValue: '4:32:54', riderDisplay: null }),
      expect.objectContaining({ bib: '12', rank: 2, rankText: '2', timeText: null, gapText: '+00', resultValue: '+00', riderDisplay: null }),
      expect.objectContaining({ bib: '13', rank: null, rankText: 'DNF', irm: 'DNF', timeText: null, gapText: null, resultValue: null, riderDisplay: null }),
    ]);
    expect(rows[0]).not.toHaveProperty('dorsal');
    expect(rows[0]).not.toHaveProperty('position');
    expect(rows[0]).not.toHaveProperty('value');
    expect(validateResultsDocument(normalized, { startlistBibs: new Set(['11', '12', '13']) }).ok).toBe(true);
  });

  it('acepta un único valor de puntos o IRM sin nombres, equipo ni país', () => {
    const normalized = normalizeResultsDocument({
      raceId: 'compacta-puntos',
      stages: [{
        stageNumber: 1,
        raceType: 'RR',
        classifications: [{
          eventId: -173006,
          eventName: 'Puntos',
          classKind: 'points',
          scope: 'overall',
          isTeamEvent: false,
          expectedRowCount: 3,
          rows: [
            { bib: '11', position: 1, value: '25 pts.' },
            { bib: '12', position: 2, value: '17,5' },
            { bib: '13', irm: 'DNS' },
          ],
        }],
      }],
    });
    const rows = normalized.stages[0].classifications[0].rows;

    expect(rows[0]).toMatchObject({ points: 25, resultValue: '25', timeText: '25' });
    expect(rows[1]).toMatchObject({ points: 17.5, resultValue: '17.5', timeText: '17.5' });
    expect(rows[2]).toMatchObject({ rank: null, rankText: 'DNS', irm: 'DNS', points: null });
    expect(validateResultsDocument(normalized).ok).toBe(true);
  });

  it('exige dorsal para corredores salvo compatibilidad explícita con documentos antiguos', () => {
    const normalized = normalizeResultsDocument({
      raceId: 'sin-dorsal',
      stages: [{
        stageNumber: 1,
        raceType: 'RR',
        classifications: [{
          eventId: -173007,
          eventName: 'Etapa',
          classKind: 'stage',
          scope: 'stage',
          isTeamEvent: false,
          expectedRowCount: 1,
          rows: [{ position: 1, value: '1:00:00', riderDisplay: 'Documento antiguo' }],
        }],
      }],
    });

    expect(errorCodes(validateResultsDocument(normalized))).toContain('MISSING_BIB');
    expect(validateResultsDocument(normalized, { allowBibless: true }).ok).toBe(true);
  });

  it('rechaza el dorsal técnico 0 en una clasificación individual', () => {
    const normalized = normalizeResultsDocument({
      raceId: 'dorsal-cero',
      stages: [{
        stageNumber: 1,
        raceType: 'RR',
        classifications: [{
          eventId: -173009,
          eventName: 'Etapa',
          classKind: 'stage',
          scope: 'stage',
          isTeamEvent: false,
          expectedRowCount: 1,
          rows: [{ bib: '0', position: 1, value: '1:00:00' }],
        }],
      }],
    });

    expect(errorCodes(validateResultsDocument(normalized))).toContain('INVALID_BIB');
  });

  it('descarta toda identidad fuente de filas con dorsal al construir el SQL del upsert', () => {
    const normalized = normalizeResultsDocument({
      competitionId: -173008,
      stages: [{
        stageNumber: 1,
        classifications: [{
          eventId: -173008,
          eventName: 'Etapa',
          classKind: 'stage',
          scope: 'stage',
          isTeamEvent: false,
          rowCount: 1,
          winnerName: 'Nombre fuente que no debe guardarse',
          rows: [{ bib: '11', position: 1, value: '1:00:00', riderDisplay: 'Nombre fuente', teamName: 'Equipo fuente', teamId: 'team-source', isoCode2: 'es' }],
        }],
      }],
    });
    const { plan } = buildPlan(normalized);
    const resultInsert = plan.find((statement) => statement.text.includes('INSERT INTO public.race_uci_results'));
    const stageInsert = plan.find((statement) => statement.text.includes('INSERT INTO public.race_uci_stages'));

    expect(resultInsert.params[6]).toBeNull();
    expect(resultInsert.params[7]).toBeNull();
    expect(stageInsert.params[13]).toBeNull();
  });

  it('conserva el nombre de una clasificación por equipos aunque lleve bib técnico', () => {
    const { plan } = buildPlan({
      competitionId: -173010,
      stages: [{
        stageNumber: 1,
        classifications: [
          {
            eventId: -173010,
            eventName: 'Etapa',
            classKind: 'stage',
            scope: 'stage',
            isTeamEvent: false,
            rowCount: 1,
            rows: [{ bib: '11', rank: 1, riderDisplay: 'No guardar', timeText: '1:00:00' }],
          },
          {
            eventId: -173011,
            eventName: 'Equipos',
            classKind: 'teams',
            scope: 'overall',
            isTeamEvent: true,
            winnerName: 'Equipo fuente',
            rowCount: 1,
            rows: [{ bib: '0', rank: 1, riderDisplay: 'Equipo fuente', teamId: 'team-source', timeText: '2:00:00' }],
          },
        ],
      }],
    });
    const teamResult = plan.find((statement) => statement.text.includes('INSERT INTO public.race_uci_results') && statement.params[2] === -173011);
    const teamStage = plan.find((statement) => statement.text.includes('INSERT INTO public.race_uci_stages') && statement.params[4] === -173011);

    expect(teamResult.params[6]).toBe('Equipo fuente');
    expect(teamResult.params[7]).toBe('team-source');
    expect(teamStage.params[13]).toBe('Equipo fuente');
  });
});
