#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import pg from 'pg';

const SOURCE_ENV = process.env.RESULTS_ENV_PATH || '/etc/calendario-ciclismo/uci-results.env';
const TARGET_ENV = process.env.BROADCASTS_ENV_PATH || '/etc/calendario-ciclismo/broadcasts.env';

function databaseUrlFromEnv(path) {
  const line = readFileSync(path, 'utf8').split(/\r?\n/)
    .find((entry) => entry.startsWith('DATABASE_URL='));
  if (!line) throw new Error(`Falta DATABASE_URL en ${path}`);
  return line.slice('DATABASE_URL='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
}

function broadcastsUrl(sourceUrl, password) {
  const url = new URL(sourceUrl);
  const currentUser = decodeURIComponent(url.username);
  const suffix = currentUser.startsWith('cc_results_worker.')
    ? currentUser.slice('cc_results_worker'.length)
    : '';
  url.username = `cc_broadcasts_login${suffix}`;
  url.password = password;
  return url.toString();
}

const sourceUrl = databaseUrlFromEnv(SOURCE_ENV);
const password = randomBytes(36).toString('base64url');
const targetUrl = broadcastsUrl(sourceUrl, password);
const temporary = `${TARGET_ENV}.tmp-${process.pid}`;
writeFileSync(temporary, `BROADCASTS_DATABASE_URL=${targetUrl}\nBROADCASTS_STABILITY_MINUTES=10\n`, {
  encoding: 'utf8', mode: 0o600, flag: 'wx',
});
const client = new pg.Client({
  connectionString: sourceUrl,
  ssl: sourceUrl.includes('localhost') ? undefined : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query('SELECT private.provision_cc_broadcasts_login($1)', [password]);
  renameSync(temporary, TARGET_ENV);
} catch (error) {
  try { unlinkSync(temporary); } catch {}
  throw error;
} finally {
  await client.end();
}
console.log(`Credencial de broadcasts creada en ${TARGET_ENV} sin mostrar su contenido.`);
