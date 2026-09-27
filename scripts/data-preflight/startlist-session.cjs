// Factory evaluable in functions.exec; CommonJS export for local tests.
(function () {
  const quote = value => "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
  const sqlValue = value => "'" + String(value).replaceAll("'", "''") + "'";
  const iso = value => new Date(value).toISOString();

  function rowsFromMcp(value) {
    if (value?.isError || value?.error) throw new Error('Supabase MCP devolvió un error: ' + JSON.stringify(value).slice(0,600));
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try { return rowsFromMcp(JSON.parse(value)); } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      const match = value.match(/(?:^|\n)<untrusted-data-[^>]+>\s*([\s\S]*?)\s*<\/untrusted-data-[^>]+>/);
      if (match) return rowsFromMcp(JSON.parse(match[1]));
    }
    if (value && typeof value === 'object') {
      for (const key of ['result', 'data', 'structuredContent']) {
        if (value[key] != null) return rowsFromMcp(value[key]);
      }
      const text = value.content?.find(item => item.type === 'text');
      if (text) return rowsFromMcp(text.text);
    }
    throw new Error('Formato de respuesta MCP no reconocido. Conservar el importId antes de reintentar.');
  }

  function createSession({ tools, store, load, ALL_TOOLS, now = Date.now, key = 'cc_startlist_session' }) {
    let state = load(key);
    const save = () => store(key, state);
    const requireState = () => { if (!state) throw new Error('Iniciar la sesión con begin().'); };
    async function measured(phase, kind, operation) {
      requireState();
      const start = now();
      const event = { phase, kind, startUtc: iso(start) };
      try {
        const result = await operation();
        event.status = 'ok';
        return result;
      } catch (error) {
        event.status = 'error';
        state.incidents.push({ phase, message: String(error.message || error).slice(0,600) });
        throw error;
      } finally {
        const end = now();
        Object.assign(event, { endUtc: iso(end), durationMs: end - start });
        state.events.push(event); save();
      }
    }
    async function command(phase, cmd) {
      return measured(phase, 'cli', async () => {
        const result = await tools.exec_command({ cmd, max_output_tokens: 20000 });
        if (result.exit_code !== 0 || !result.output?.trim() || result.output.includes('Warning: truncated')) {
          throw new Error(`Falló ${phase}: ` + (result.output || 'salida vacía').slice(0,600));
        }
        return result.output;
      });
    }
    async function sql(phase, query) {
      const name = ALL_TOOLS.find(t => t.name.endsWith('supabase_execute_sql'))?.name;
      if (!name) throw new Error('No está disponible Supabase MCP.');
      return measured(phase, 'mcp', async () => rowsFromMcp(await tools[name]({ project_id: state.projectId, query })));
    }
    async function importOperation(phase, args) {
      const timing = state.measure ? ' --timed' : '';
      const query = await command(phase + '_cli', 'node scripts/data-preflight/startlist-import.mjs ' + args + timing);
      const rows = await sql(phase, query);
      const report = rows[0]?.report;
      if (!report?.importId) throw new Error('La respuesta no contiene importId. No repetir la preparación a ciegas.');
      state.importId = report.importId;
      state.report = report;
      if (rows[0].server_ms != null) state.events.at(-1).serverMs = Number(rows[0].server_ms);
      if (report.status === 'applied') state.publicStartedUtc = iso(now());
      save();
      return { ...report, publicUrl: state.race.publicUrl };
    }
    function selectRace(id) {
      const race = state.races?.find(r => r.id === id);
      if (!race) throw new Error('Elegir una carrera de la consulta inicial.');
      const publicUrl = race.slug
        ? 'https://calendariociclismo.app/inscritos/' + encodeURIComponent(race.slug) + '/'
        : 'https://calendariociclismo.app/inscritos.html?race=' + encodeURIComponent(race.id);
      state.race = { ...race, publicUrl }; save();
      return state.race;
    }
    return {
      begin({ projectId, sentUtc, firstToolUtc, measure = false, outputDir }) {
        if (state) throw new Error('Ya hay una sesión; reutilizarla en vez de reiniciar las mediciones.');
        if (measure && !firstToolUtc) throw new Error('La medición requiere la marca de la primera herramienta, incluidas las lecturas iniciales.');
        const first = firstToolUtc || iso(now());
        if (!Number.isFinite(Date.parse(first)) || (sentUtc && !Number.isFinite(Date.parse(sentUtc)))) throw new Error('Marca UTC inválida.');
        state = { projectId, sentUtc, firstToolUtc: first, measure,
          outputDir: outputDir || 'output/startlist-' + iso(now()).replace(/[:.]/g, '-'), events: [], incidents: [] };
        save();
        return { outputDir: state.outputDir };
      },
      async lookup(name, year) {
        if (!Number.isInteger(year) || year < 1900 || year > 2200 || !name?.trim()) throw new Error('Nombre y año de carrera requeridos.');
        state.races = await sql('race_lookup', `SELECT id, name, slug, "startDate" FROM public.races WHERE name ILIKE ${sqlValue('%' + name + '%')} AND "startDate" >= ${sqlValue(year + '-01-01')} AND "startDate" < ${sqlValue((year+1) + '-01-01')} ORDER BY "startDate", id;`);
        state.year = year; save();
        return state.races.length === 1 ? selectRace(state.races[0].id) : { candidates: state.races };
      },
      selectRace,
      async prepare({ pdf, source }) {
        if (!state?.race) throw new Error('Identificar una carrera antes de preparar.');
        if (state.importId) throw new Error('Ya existe importId: resolver o aplicar sin volver a extraer.');
        if (!!pdf === !!source) throw new Error('Elegir PDF o fuente estructurada.');
        state.source = source || state.outputDir + '/source.json'; state.sourcePdf = pdf; save();
        const args = pdf
          ? '--pdf ' + quote(pdf) + ' --race-id ' + quote(state.race.id) + ' --year ' + state.year + ' --source-out ' + quote(state.source)
          : '--in ' + quote(source) + ' --race-id ' + quote(state.race.id);
        // mkdir and extraction share the CLI call; source is the only intermediate file.
        if (pdf) {
          const query = await command('extract_prepare_cli', 'mkdir -p ' + quote(state.outputDir) + ' && node scripts/data-preflight/startlist-import.mjs ' + args + (state.measure ? ' --timed' : ''));
          const rows = await sql('prepare', query);
          if (!rows[0]?.report?.importId) throw new Error('La preparación no contiene importId.');
          state.report = rows[0].report; state.importId = state.report.importId;
          if (rows[0].server_ms != null) state.events.at(-1).serverMs = Number(rows[0].server_ms);
          save(); return { ...state.report, publicUrl: state.race.publicUrl };
        }
        return importOperation('prepare', args);
      },
      async reuseTeamDecisions(path) {
        const issues = state?.report?.issues || [];
        if (!issues.some(i => i.code === 'AMBIGUOUS_TEAM')) return { overrides: {}, unresolved: issues };
        const evidence = JSON.parse(await command('read_team_decisions', 'cat ' + quote(path)));
        const overrides = { teams: {} }, reused = [];
        const unresolved = issues.filter(issue => {
          if (issue.code !== 'AMBIGUOUS_TEAM' || evidence.raceId !== state.race.id) return true;
          const candidates = [...(issue.candidateIds || [])].sort();
          const matches = (evidence.teams || []).filter(d => d.teamName === issue.teamName && /^https?:\/\//.test(d.sourceUrl || '') && Number.isFinite(Date.parse(d.verifiedAt))
            && candidates.includes(d.teamId) && JSON.stringify([...(d.candidateIds || [])].sort()) === JSON.stringify(candidates));
          if (matches.length !== 1) return true;
          const match = matches[0]; overrides.teams[issue.teamIndex] = { teamId: match.teamId };
          reused.push({ teamIndex: issue.teamIndex, teamId: match.teamId, sourceUrl: match.sourceUrl, verifiedAt: match.verifiedAt });
          return false;
        });
        state.decisions = reused; save();
        return { overrides, reused, unresolved };
      },
      async apply(overrides = {}) {
        if (!state?.importId) throw new Error('Preparar antes de aplicar.');
        if (state.report?.status === 'applied') return { ...state.report, publicUrl: state.race.publicUrl };
        return importOperation('apply', '--import-id ' + quote(state.importId) + ' --overrides-json ' + quote(JSON.stringify(overrides)));
      },
      status() { requireState(); return JSON.parse(JSON.stringify(state)); },
      async finish({ publicVerified, publicCheckedUtc, blocker } = {}) {
        requireState();
        if (state.finished) return state.finished;
        if (!blocker && (state.report?.status !== 'applied' || publicVerified !== true)) throw new Error('Falta aplicación o comprobación pública.');
        const checked = publicCheckedUtc || iso(now());
        if (!Number.isFinite(Date.parse(checked)) || (publicVerified && Date.parse(checked) < Date.parse(state.publicStartedUtc))) throw new Error('Marca de comprobación inválida.');
        const summary = { importId: state.importId, teams: state.report?.teams, riders: state.report?.riders,
          publicUrl: state.race?.publicUrl, publicCheckedUtc: publicVerified ? checked : null,
          status: blocker ? 'blocked' : 'applied_public_verified', blocker: blocker || null };
        if (!state.measure) { state.finished = summary; save(); return summary; }
        const record = { ...state, ...summary };
        delete record.races; delete record.measure;
        const script = `const fs=require('node:fs');const r=JSON.parse(process.argv[1]);r.closedUtc=new Date().toISOString();const diff=(a,b)=>Date.parse(b)-Date.parse(a);r.durationsMs={codexTotal:diff(r.firstToolUtc,r.closedUtc),dispatchLatency:r.sentUtc?diff(r.sentUtc,r.firstToolUtc):null,sendToClose:r.sentUtc?diff(r.sentUtc,r.closedUtc):null,untilPublic:r.publicCheckedUtc?diff(r.firstToolUtc,r.publicCheckedUtc):null,publicCheck:r.publicCheckedUtc?diff(r.publicStartedUtc,r.publicCheckedUtc):null,cli:r.events.filter(e=>e.kind==='cli').reduce((s,e)=>s+e.durationMs,0),mcp:r.events.filter(e=>e.kind==='mcp').reduce((s,e)=>s+e.durationMs,0),server:r.events.reduce((s,e)=>s+(e.serverMs||0),0)};fs.mkdirSync(r.outputDir,{recursive:true});const p=r.outputDir+'/measurement.json';fs.writeFileSync(p,JSON.stringify(r)+'\\n',{flag:'wx'});console.log(JSON.stringify({status:r.status,importId:r.importId,teams:r.teams,riders:r.riders,publicUrl:r.publicUrl,record:p,closedUtc:r.closedUtc,durationsMs:r.durationsMs}));`;
        // One exclusive write; stdout is the final concise delivery, not a second report.
        const result = await command('write_measurement', 'node -e ' + quote(script) + ' ' + quote(JSON.stringify(record)));
        state.finished = JSON.parse(result); save(); return state.finished;
      }
    };
  }
  createSession.rowsFromMcp = rowsFromMcp;
  if (typeof module !== 'undefined') module.exports = createSession;
  return createSession;
})()
