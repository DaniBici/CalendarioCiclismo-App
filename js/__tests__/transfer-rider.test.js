import { describe, expect, it } from 'vitest';
import {
  isInitialTransferImport,
  isMarketDestinationTeamEligible,
  marketDestinationTeamOptions,
  riderTeamOptionLabel,
  transferEditorAnnouncementDate,
  transferRiderInitialGender,
  transferRowBorderColor,
} from '../services/transfer-rider.js';

const teams = [
  { id: 'men', name: 'Decathlon CMA CGM', category: 'WT', gender: 'male' },
  { id: 'women', name: 'Decathlon CMA CGM', category: 'PRW', gender: 'female' },
];

describe('transferRiderInitialGender', () => {
  it('usa el destino femenino al crear una incorporación sin equipo de origen', () => {
    expect(transferRiderInitialGender({ teams, presetToTeamId: 'women' })).toBe('female');
  });

  it('prioriza el equipo de origen cuando existe', () => {
    expect(transferRiderInitialGender({
      teams,
      fromTeamId: 'men',
      presetToTeamId: 'women',
    })).toBe('male');
  });

  it('mantiene el masculino como reserva sin contexto de equipo', () => {
    expect(transferRiderInitialGender({ teams })).toBe('male');
  });
});

describe('transferRowBorderColor', () => {
  it('deja las filas de rumores sin reborde visible', () => {
    expect(transferRowBorderColor('rumor')).toBe('transparent');
  });

  it('conserva los rebordes de dudas y movimientos confirmados', () => {
    expect(transferRowBorderColor('doubt')).toBe('#8b5cf6');
    expect(transferRowBorderColor('confirmed')).toBe('var(--border)');
  });
});

describe('riderTeamOptionLabel', () => {
  it('distingue equipos homónimos por categoría', () => {
    expect(teams.map(riderTeamOptionLabel)).toEqual([
      'Decathlon CMA CGM (WT)',
      'Decathlon CMA CGM (PRW)',
    ]);
  });
});

describe('marketDestinationTeamOptions', () => {
  const catalog = [
    ...teams,
    { id: 'promoted-men', name: 'Equipo Ascendido', category: 'CT', gender: 'male' },
    { id: 'promoted-women', name: 'Equipo Femenino Ascendido', category: 'CTW', gender: 'female' },
    { id: 'continental', name: 'Equipo Continental', category: 'CT', gender: 'male' },
    { id: 'national', name: 'Selección Española', category: 'NTM', gender: 'male' },
    { id: 'special', name: 'Selección especial', category: 'WT', gender: 'male', specialEdition: true },
  ];
  const marketSeasons = [
    { teamId: 'men', name: 'Decathlon CMA CGM 2027', category: 'WT' },
    { teamId: 'women', name: 'Decathlon CMA CGM Femmes 2027', category: 'PRW' },
    { teamId: 'promoted-men', name: 'Equipo Ascendido 2027', category: 'PT' },
    { teamId: 'promoted-women', name: 'Equipo Femenino Ascendido 2027', category: 'WWT' },
    { teamId: 'continental', name: 'Equipo Continental 2027', category: 'CT' },
    { teamId: 'national', name: 'Selección Española 2027', category: 'NTM' },
    { teamId: 'special', name: 'Selección especial 2027', category: 'WT' },
  ];

  it('solo ofrece equipos de 2027 de las dos primeras divisiones del sexo del corredor', () => {
    expect(marketDestinationTeamOptions({
      teams: catalog,
      marketSeasons,
      gender: 'male',
    })).toEqual([
      expect.objectContaining({ id: 'men', name: 'Decathlon CMA CGM 2027', category: 'WT' }),
      expect.objectContaining({ id: 'promoted-men', name: 'Equipo Ascendido 2027', category: 'PT' }),
    ]);
  });

  it('excluye el equipo de origen y usa las categorías de la temporada 2027', () => {
    expect(marketDestinationTeamOptions({
      teams: catalog,
      marketSeasons,
      gender: 'female',
      excludeTeamId: 'women',
    })).toEqual([
      expect.objectContaining({ id: 'promoted-women', name: 'Equipo Femenino Ascendido 2027', category: 'WWT' }),
    ]);
  });

  it('rechaza como destino un equipo continental aunque exista en el catálogo y en 2027', () => {
    expect(isMarketDestinationTeamEligible({
      teamId: 'continental',
      teams: catalog,
      marketSeasons,
      gender: 'male',
    })).toBe(false);
  });
});

describe('transferEditorAnnouncementDate', () => {
  const initialImport = {
    announcedAt: '2026-07-20',
    createdAt: '2026-07-20T13:00:57.868Z',
    updatedAt: '2026-07-20T13:00:58.100Z',
  };

  it('usa hoy para un movimiento nuevo sin fecha previa', () => {
    expect(transferEditorAnnouncementDate({ today: '2026-09-03' })).toBe('2026-09-03');
  });

  it('reemplaza la fecha de la carga inicial al autorresolver desde Nuevo movimiento', () => {
    expect(isInitialTransferImport(initialImport)).toBe(true);
    expect(transferEditorAnnouncementDate({
      transfer: initialImport,
      today: '2026-09-03',
      autoResolvedFromNew: true,
    })).toBe('2026-09-03');
  });

  it('conserva la fecha al editar explícitamente un movimiento existente', () => {
    expect(transferEditorAnnouncementDate({
      transfer: initialImport,
      today: '2026-09-03',
    })).toBe('2026-07-20');
  });

  it('conserva una fecha editorial real al autorresolver', () => {
    const edited = { ...initialImport, announcedAt: '2026-08-28', updatedAt: '2026-08-28T10:00:00Z' };
    expect(isInitialTransferImport(edited)).toBe(false);
    expect(transferEditorAnnouncementDate({
      transfer: edited,
      today: '2026-09-03',
      autoResolvedFromNew: true,
    })).toBe('2026-08-28');
  });
});
