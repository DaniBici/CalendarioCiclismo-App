#!/usr/bin/env bash
# Vigilancia LOCAL Tour de Francia 2026 — Tissot tdf2026/-56031. Etapas EN LÍNEA.
# Uso: bash scripts/results-fetchers/_watch-tdf2026.sh <STAGE>
#
# UNA PASADA por invocación (la cadencia la marca el loop, no el script).
# Vuelca solo si la firma de las clasificaciones CAMBIÓ respecto a la última
# pasada volcada (.eN.sig) → idempotente y no machaca la instancia.
#
# Vuelca SIN --source: el link ya es tissot y --source con link existente puede
# poner el code a NULL y violar el CHECK (ver feedback_uci_upsert_source_bug).
#
# Termina imprimiendo una línea:
#   STATE STAGE=<n> STAGE_FIN=<n> TOP50=<0|1> POINTS_ROWS=<n> POINTS_WIN=<name>
#         CHANGED=<0|1> FINAL_GC=<n> FETCH=<OK|ERROR>
# FINAL_GC se queda a 0 durante todo el Tour (Tissot mantiene status=Live hasta
# la E21) → NO es señal de cierre diario. Ver el runbook.
set -uo pipefail
cd "$(dirname "$0")/../.."

STAGE="${1:?uso: _watch-tdf2026.sh <STAGE>}"
COMP=tdf2026; COMPID=-56031; RACE=u5p2npjYLwduznQbDY4e
OUT=scripts/results-fetchers/_results_run/tissot-tdf2026
JSON="$OUT/$COMPID.json"
SIGFILE="$OUT/.e$STAGE.sig"
FETCH=scripts/results-fetchers/tissot-results-fetch.mjs
UPSERT=scripts/results-fetchers/uci-results-upsert.mjs

mkdir -p "$OUT"

FETCH_LOG="$(mktemp "${TMPDIR:-/tmp}/tdf-watch-fetch.XXXXXX")"
trap 'rm -f "$FETCH_LOG"' EXIT
node "$FETCH" --competition "$COMP" --competition-id "$COMPID" --stage "$STAGE" --out "$OUT" >"$FETCH_LOG" 2>&1
fetch_rc=$?
if [ "$fetch_rc" -ne 0 ]; then
  echo ">>> [$(date -u +%H:%M:%S)] FETCH FAILED rc=$fetch_rc — no se interpreta como etapa sin publicar." >&2
  sed 's/^/    /' "$FETCH_LOG" >&2
  echo "STATE STAGE=$STAGE STAGE_FIN=0 TOP50=0 POINTS_ROWS=0 POINTS_WIN=- CHANGED=0 FINAL_GC=0 FETCH=ERROR"
  exit "$fetch_rc"
fi

# Lee el JSON y calcula el estado. STAGE_FIN = prefijo CONTIGUO de finishers con
# puesto (regla: puesto hasta el primer hueco; ver feedback_live_results_prefix_and_times).
read STAGE_FIN POINTS_ROWS POINTS_WIN FINAL_GC SIG < <(node -e "
  const fs=require('fs');
  try{
    const d=JSON.parse(fs.readFileSync('$JSON','utf8'));
    const stg=(d.stages||[]).find(s=>s.stageNumber===$STAGE);
    const cl=(k,sc)=>stg?(stg.classifications||[]).find(c=>c.classKind===k&&c.scope===sc):null;

    const stageCl=cl('stage','stage');
    const rows=stageCl?(stageCl.rows||[]):[];
    let fin=0;
    for(const r of rows){ if(r.rank!=null) fin++; else break; }

    const pts=cl('points','overall')||cl('points','stage');
    const pRows=pts?(pts.rows||[]).length:0;
    const pWin=pts&&pts.rows&&pts.rows.length?((pts.rows[0].riderDisplay||'-').replace(/\s+/g,'_')):'-';

    // pseudo-final: stageNumber null (solo se rellena al cerrar la E21)
    const fstg=(d.stages||[]).find(s=>s.stageNumber==null);
    const fgc=fstg?((fstg.classifications||[]).find(c=>c.classKind==='gc')||{rows:[]}).rows.length:0;

    const sig=require('crypto').createHash('sha1').update(JSON.stringify(stg||{})).digest('hex').slice(0,12);
    process.stdout.write([fin,pRows,pWin,fgc,sig].join(' '));
  }catch(e){ process.stdout.write('0 0 - 0 none'); }
")

TOP50=0; [ "${STAGE_FIN:-0}" -ge 50 ] && TOP50=1
CHANGED=0
PREV=""; [ -f "$SIGFILE" ] && PREV="$(cat "$SIGFILE")"

if [ "$SIG" = "none" ] || [ "${STAGE_FIN:-0}" = "0" ]; then
  echo "[$(date -u +%H:%M:%S)] E$STAGE aún SIN publicar (Tissot no da Stage Ranking)."
elif [ "$SIG" != "$PREV" ]; then
  echo ">>> [$(date -u +%H:%M:%S)] cambio detectado (finishers=$STAGE_FIN) — volcando..."
  node "$UPSERT" --in "$JSON" --race-id "$RACE" --gender male --apply --skip-existing-after-min 60 2>&1 | tail -6
  rc=${PIPESTATUS[0]}
  if [ "$rc" = 0 ] || [ "$rc" = 2 ] || [ "$rc" = 3 ]; then
    echo "$SIG" > "$SIGFILE"; CHANGED=1
  else
    echo ">>> upsert FALLÓ rc=$rc"
  fi
else
  echo "[$(date -u +%H:%M:%S)] sin cambios (finishers=$STAGE_FIN)."
fi

echo "STATE STAGE=$STAGE STAGE_FIN=${STAGE_FIN:-0} TOP50=$TOP50 POINTS_ROWS=${POINTS_ROWS:-0} POINTS_WIN=${POINTS_WIN:--} CHANGED=$CHANGED FINAL_GC=${FINAL_GC:-0} FETCH=OK"
