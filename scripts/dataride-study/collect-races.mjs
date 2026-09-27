#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const BASE = 'https://dataride.uci.ch/iframe';
const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const inputPath = resolve(arg('catalog', 'output/estudio-dataride-2020-2025-corregido-20260907-final/catalogo-dataride-2020-2025.json'));
const outputPath = resolve(arg('out', 'output/estudio-dataride-2020-2025-corregido-20260907-final/races-dataride.json'));
const concurrency = Math.max(1, Math.min(24, Number(arg('concurrency', '4')) || 4));
const retryCount = Math.max(1, Number(arg('retries', '5')) || 5);

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function compactRace(row) {
  return {
    Id: row.Id,
    RaceCode: row.RaceCode ?? null,
    Index: row.Index ?? null,
    RaceName: row.RaceName ?? null,
    CategoryCode: row.CategoryCode ?? null,
    RaceTypeCode: row.RaceTypeCode ?? null,
    StartLocation: row.StartLocation || null,
    EndLocation: row.EndLocation || null,
    Venue: row.Venue || null,
    StartDate: row.StartDate ?? null,
    EndDate: row.EndDate ?? null,
    MandatoryDate: row.MandatoryDate ?? null,
    Date: row.Date ?? null,
  };
}

async function fetchRaces(competitionId) {
  let lastError;
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/Races/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': UA,
        },
        body: new URLSearchParams({
          disciplineId: '10', competitionId: String(competitionId),
          take: '100', skip: '0', page: '1', pageSize: '100',
        }),
      });
      const text = await response.text();
      const json = JSON.parse(text);
      if (!response.ok || !Array.isArray(json?.data)) throw new Error(`HTTP ${response.status}`);
      return json.data.map(compactRace);
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) await sleep(attempt * 750);
    }
  }
  throw lastError;
}

function save(records) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`);
  renameSync(temporary, outputPath);
}

const catalog = JSON.parse(readFileSync(inputPath, 'utf8'));
const previous = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, 'utf8')) : [];
const byCompetition = new Map(previous.filter((record) => !record.error)
  .map((record) => [Number(record.competitionId), record]));
const pending = catalog.filter((competition) => !byCompetition.has(Number(competition.competitionId)));
let cursor = 0;
let completedSinceSave = 0;

async function worker() {
  while (cursor < pending.length) {
    const index = cursor;
    cursor += 1;
    const competition = pending[index];
    try {
      const races = await fetchRaces(competition.competitionId);
      byCompetition.set(Number(competition.competitionId), {
        year: competition.year,
        competitionId: Number(competition.competitionId),
        fetchedAt: new Date().toISOString(),
        races,
      });
    } catch (error) {
      byCompetition.set(Number(competition.competitionId), {
        year: competition.year,
        competitionId: Number(competition.competitionId),
        fetchedAt: new Date().toISOString(),
        error: String(error?.message || error),
        races: [],
      });
    }
    completedSinceSave += 1;
    if (completedSinceSave >= 50) {
      completedSinceSave = 0;
      save([...byCompetition.values()].sort((a, b) => a.year - b.year || a.competitionId - b.competitionId));
      process.stderr.write(`Recopiladas ${byCompetition.size}/${catalog.length}\n`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, pending.length || 1) }, worker));
const records = [...byCompetition.values()].sort((a, b) => a.year - b.year || a.competitionId - b.competitionId);
save(records);
const failed = records.filter((record) => record.error).length;
const empty = records.filter((record) => !record.error && record.races.length === 0).length;
process.stdout.write(`${JSON.stringify({ outputPath, competitions: records.length, failed, empty })}\n`);
