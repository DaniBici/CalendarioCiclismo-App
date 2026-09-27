#!/usr/bin/env node
// Compatibilidad del nombre de comando, sin las antiguas fases extract/draft/apply.
process.stderr.write('El preflight anterior está retirado. Usa startlist-import.mjs --in fuente.json para preparar una lista enriquecida.\n');
process.exitCode = 1;
