#!/usr/bin/env bash
# Vigilancia LOCAL Tour de Francia 2026 E1 (CRE/TTT) — Tissot tdf2026/-56031.
# PARTICULARIDAD CRE: 23 equipos salen escalonados (18:00→18:55 hora local, UAE
# Team Emirates-XRG ÚLTIMO a las 18:55). Tissot ya puede tener datos EN VIVO de
# los equipos que ya han acabado mucho antes de que acabe UAE — NO SE VUELCA
# NADA hasta que UAE tenga fila con rank/tiempo (o IRM) en la clasificación de
# equipos de la etapa. Antes de eso: solo se observa (dry-run), nunca --apply.
#
# Fuente = HÍBRIDA (ver tissot-results-fetch.mjs): intenta primero la "Stage
# Classification" individual de DataRide (tiempos reales con centésimas); si la
# UCI aún no publicó, cae a expansión por roster de Tissot (líder con tiempo
# absoluto, compañeros detrás). El siguiente volcado se autocorrige solo.
#
# Vuelca SIN --source (el link ya es tissot; ver feedback_uci_upsert_source_bug:
# --source con link existente puede poner el code a NULL y violar el CHECK).
set -uo pipefail
cd "$(dirname "$0")/../.."

COMP=tdf2026; COMPID=-56031; RACE=u5p2npjYLwduznQbDY4e; STAGE=1
LAST_TEAM="UAE Team Emirates-XRG"   # último en salir → gate de cierre
TOTAL_TEAMS=23
OUT=scripts/catalog-continental/_results_run/tissot-tdf2026
JSON="$OUT/$COMPID.json"
PART="$OUT/$COMPID.part.json"
FETCH=scripts/results-fetchers/tissot-results-fetch.mjs
UPSERT=scripts/results-fetchers/uci-results-upsert.mjs
FILL=scripts/catalog-continental/_apply-ttt-individual-times.mjs
REORDER=scripts/catalog-continental/_reorder-ttt-riders-by-time.mjs
FAST="${FAST:-90}"; STABLE_STOP="${STABLE_STOP:-3}"; MAX_TRIES="${MAX_TRIES:-160}"

# ⚠️ ANOMALÍA CAZADA POR DANI (2026-07-04): en esta etapa 1, la "Overall Teams
# Classification" (classKind='teams', scope='overall') que da Tissot viene con
# gaps/tiempos MULTIPLICADOS/distorsionados (p. ej. INEOS "1:07:08" ≈ 3× el
# tiempo real de la etapa de ~21:47, y el ranking no coincide con el de la
# etapa real). Es inestable entre pasadas (cambia el "ganador" de una lectura
# a otra) — NO es una acumulada real de 1 sola etapa disputada. Se filtra esa
# clasificación del JSON antes de aplicar (build_part) hasta que Tissot lo
# corrija solo (entonces bastará con quitar este filtro).
build_part() {
  node -e "
    const fs=require('fs');
    const d=JSON.parse(fs.readFileSync('$JSON','utf8'));
    const out={...d, stages:(d.stages||[]).map(s=>({...s, classifications:(s.classifications||[]).filter(c=>!(c.classKind==='teams'&&c.scope==='overall'))}))};
    fs.writeFileSync('$PART', JSON.stringify(out));
  "
}

# En una CRE, el resultado por EQUIPO vive en classKind='stage'/scope='stage'
# como filas de CORREDOR expandidas (cada corredor lleva teamName; solo la
# 1ª fila del bloque de cada equipo trae rank/irm, el resto rank=null detrás).
# NO existe una clasificación "teams/stage" separada para el día de la CRE
# (esa clave es la General de equipos ACUMULADA, no la de esta etapa).
# Lee el JSON y decide si UAE ya está resuelto (agrupando por teamName).
# Imprime: "<equiposResueltos> <uaeListo:0|1> <sig>"
check() {
  node -e "
    const fs=require('fs');
    try{
      const d=JSON.parse(fs.readFileSync('$JSON','utf8'));
      const stg=(d.stages||[]).find(s=>s.stageNumber===$STAGE);
      const stageCl=stg?stg.classifications.find(c=>c.classKind==='stage'&&c.scope==='stage'):null;
      const rows=stageCl?stageCl.rows:[];
      const byTeam=new Map();
      for (const r of rows){
        const key=(r.teamName||'').toUpperCase();
        if(!key) continue;
        const cur=byTeam.get(key)||{rank:null,irm:null};
        if (r.rank!=null) cur.rank=r.rank;
        if (r.irm) cur.irm=r.irm;
        byTeam.set(key,cur);
      }
      const resolved=[...byTeam.values()].filter(v=>v.rank!=null||v.irm).length;
      const uaeKey=[...byTeam.keys()].find(k=>k.includes('UAE'));
      const uaeReady = uaeKey && (byTeam.get(uaeKey).rank!=null || byTeam.get(uaeKey).irm) ? 1 : 0;
      const sig=require('crypto').createHash('sha1').update(JSON.stringify(d.stages)).digest('hex').slice(0,12);
      process.stdout.write(resolved+' '+uaeReady+' '+sig);
    }catch(e){ process.stdout.write('0 0 none'); }
  "
}

# Verificación POST-volcado contra BD real (no fiarse del exit code del upsert).
# Comprueba: isTeamEvent correcto por clasificación, raceType='TTT' en cabecera,
# nº de filas de corredor (~184) con bib+globalRiderId resuelto, nº de filas de
# equipo (=23, bib NULL), y filas de corredor sin timeText/gapText/irm (fallback
# a medio expandir, aún sin tiempo individual de la UCI).
VERIFY=scripts/catalog-continental/_verify-ttt-stage.mjs
verify_bd() {
  node "$VERIFY" --race-id "$RACE" --stage "$STAGE" 2>&1
}

echo ">>> [TdF 2026 E1 CRE] arrancado $(date -u +%H:%M:%S)UTC — esperando a que $LAST_TEAM (última salida) complete. SOLO OBSERVANDO hasta entonces."
prev=""; stable=0
for i in $(seq 1 "$MAX_TRIES"); do
  node "$FETCH" --competition "$COMP" --competition-id "$COMPID" --stage "$STAGE" --out "$OUT" >/dev/null 2>&1
  read RESOLVED UAE_READY SIG < <(check)

  if [ "${UAE_READY:-0}" != "1" ]; then
    echo "[$(date -u +%H:%M:%S)] equipos resueltos: ${RESOLVED:-0}/$TOTAL_TEAMS — UAE aún SIN acabar. No se vuelca."
  else
    if [ "$SIG" != "$prev" ] && [ "$SIG" != "none" ]; then
      echo ">>> [$(date -u +%H:%M:%S)] UAE completado ($RESOLVED/$TOTAL_TEAMS equipos resueltos). Volcando (SIN --source, SIN teams/overall anómala)..."
      build_part
      node "$UPSERT" --in "$PART" --race-id "$RACE" --gender male --apply --skip-existing-after-min 60 2>&1 | tail -5
      rc=${PIPESTATUS[0]}
      if [ "$rc" = 0 ] || [ "$rc" = 2 ] || [ "$rc" = 3 ]; then
        prev="$SIG"; stable=0
        echo ">>> [$(date -u +%H:%M:%S)] rellenando tiempos individuales de corredor (desde gc/stage) + reordenando por tiempo dentro de cada equipo..."
        node "$FILL" --json "$PART" --race-id "$RACE" --stage "$STAGE" 2>&1 | tail -5
        node "$REORDER" --race-id "$RACE" --stage "$STAGE" 2>&1 | tail -5
        echo ">>> [$(date -u +%H:%M:%S)] verificación en BD tras el volcado:"
        verify_bd
      else
        echo ">>> upsert FALLÓ rc=$rc"
      fi
    else
      echo "[$(date -u +%H:%M:%S)] sin cambios tras UAE completo (equipos resueltos=$RESOLVED/$TOTAL_TEAMS)."
      stable=$((stable+1))
    fi
  fi

  if [ "${UAE_READY:-0}" = "1" ] && [ "${RESOLVED:-0}" -ge "$TOTAL_TEAMS" ] && [ "$stable" -ge "$STABLE_STOP" ]; then
    echo ">>> FIN: $TOTAL_TEAMS/$TOTAL_TEAMS equipos resueltos y estable. Etapa 1 consolidada."
    exit 0
  fi
  sleep "$FAST"
done
echo ">>> Agotada la ventana. equipos resueltos=${RESOLVED:-0}/$TOTAL_TEAMS, UAE listo=${UAE_READY:-0}."; exit 1
