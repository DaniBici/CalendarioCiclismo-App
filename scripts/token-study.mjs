#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';

function main() {
  const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
  const days = Number(arg('days') || 7);
  const dbPath = arg('db') || `${homedir()}/.local/share/opencode/opencode.db`;
  if (!Number.isFinite(days) || days <= 0 || process.argv.length > 5) {
    throw new Error('Uso: token-study.mjs [--days N] [--db ruta/opencode.db].');
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const since = Date.now() - days * 86400000;
  const dbSessions = `SELECT DISTINCT m.session_id AS id FROM part p JOIN message m ON p.message_id = m.id
    WHERE json_extract(p.data, '$.type') = 'tool' AND json_extract(p.data, '$.tool') = 'supabase_execute_sql'`;
  const inWindow = `m.session_id IN (SELECT id FROM session WHERE time_created > ${since})`;
  const totals = db.prepare(`
    WITH sess AS (${dbSessions} AND ${inWindow}),
    tok AS (SELECT m.session_id,
        SUM(CAST(json_extract(m.data, '$.tokens.input') AS INTEGER)) AS inp,
        SUM(CAST(json_extract(m.data, '$.tokens.cache.read') AS INTEGER)) AS cr,
        SUM(CAST(json_extract(m.data, '$.tokens.output') AS INTEGER)) AS outp,
        SUM(CAST(json_extract(m.data, '$.tokens.reasoning') AS INTEGER)) AS rsn,
        SUM(CASE WHEN CAST(json_extract(m.data, '$.tokens.cache.read') AS INTEGER) = 0
              AND CAST(json_extract(m.data, '$.tokens.input') AS INTEGER) > 20000 THEN 1 ELSE 0 END) AS miss_turns,
        SUM(CASE WHEN CAST(json_extract(m.data, '$.tokens.cache.read') AS INTEGER) = 0
              AND CAST(json_extract(m.data, '$.tokens.input') AS INTEGER) > 20000
              THEN CAST(json_extract(m.data, '$.tokens.input') AS INTEGER) ELSE 0 END) AS miss_tokens,
        count(*) AS turns
      FROM message m WHERE json_extract(m.data, '$.role') = 'assistant' AND m.session_id IN (SELECT id FROM sess)
      GROUP BY m.session_id)
    SELECT (SELECT count(*) FROM sess) AS sessions, SUM(turns) AS turns, SUM(inp) AS input_uncached,
      SUM(cr) AS cache_read, SUM(outp) AS output, SUM(rsn) AS reasoning,
      SUM(miss_turns) AS miss_turns, SUM(miss_tokens) AS miss_tokens,
      SUM(miss_tokens) * 1.0 / NULLIF(SUM(inp), 0) AS miss_share
    FROM tok`).get() ?? {};
  const coldStart = db.prepare(`
    WITH sess AS (${dbSessions} AND ${inWindow}),
    firsts AS (SELECT m.session_id, MIN(m.time_created) AS t0 FROM message m
      WHERE json_extract(m.data, '$.role') = 'assistant' AND m.session_id IN (SELECT id FROM sess) GROUP BY m.session_id)
    SELECT SUM(CAST(json_extract(m.data, '$.tokens.input') AS INTEGER)) AS cold_start_tokens
    FROM message m JOIN firsts f ON f.session_id = m.session_id AND m.time_created = f.t0`).get() ?? {};
  const toolOutputs = db.prepare(`
    WITH sess AS (${dbSessions} AND ${inWindow})
    SELECT json_extract(p.data, '$.tool') AS tool, count(*) AS calls,
      SUM(length(coalesce(json_extract(p.data, '$.state.output'), ''))) AS output_chars
    FROM part p JOIN message m ON p.message_id = m.id
    WHERE json_extract(p.data, '$.type') = 'tool' AND m.session_id IN (SELECT id FROM sess)
    GROUP BY 1 ORDER BY output_chars DESC LIMIT 8`).all();
  const skills = db.prepare(`
    WITH sess AS (${dbSessions} AND ${inWindow})
    SELECT json_extract(p.data, '$.state.input') AS skill, count(*) AS loads,
      SUM(length(coalesce(json_extract(p.data, '$.state.output'), ''))) AS output_chars
    FROM part p JOIN message m ON p.message_id = m.id
    WHERE json_extract(p.data, '$.type') = 'tool' AND json_extract(p.data, '$.tool') = 'skill'
      AND m.session_id IN (SELECT id FROM sess)
    GROUP BY 1 ORDER BY loads DESC LIMIT 8`).all();
  const avgPlateau = totals.turns ? Math.round(totals.cache_read / totals.turns) : 0;
  const avgMiss = totals.miss_turns ? Math.round(totals.miss_tokens / totals.miss_turns) : 0;
  process.stdout.write(`${JSON.stringify({ window_days: days, sessions: totals.sessions, turns: totals.turns,
    input_uncached: totals.input_uncached, cache_read: totals.cache_read, output: totals.output,
    reasoning: totals.reasoning, avg_plateau_tokens: avgPlateau, miss_turns: totals.miss_turns,
    miss_tokens: totals.miss_tokens, avg_miss_tokens: avgMiss, miss_share_of_uncached: totals.miss_share,
    cold_start_tokens: coldStart.cold_start_tokens,
    tool_outputs: toolOutputs, skills }, null, 2)}\n`);
}

try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
