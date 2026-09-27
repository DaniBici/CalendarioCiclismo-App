#!/usr/bin/env node
// Obtiene un manifiesto oficial para revisión/importación. I/O de BD solo MCP/panel.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {collectUciCxCalendar} from '../../supabase/functions/_shared/cx-uci-calendar.mjs';
import {countryCode} from '../uci-catalog/countries.mjs';

const seasonKey=process.argv[2] || '2026-27';
const target=resolve(process.argv[3] || `/tmp/cc-cx-calendar-${seasonKey}.json`);
try {
  const manifest=await collectUciCxCalendar({seasonKey,countryCode,onProgress:({completed,total})=>{
    if (completed%20===0 || completed===total) console.log(`Fichas UCI: ${completed}/${total}`);
  }});
  writeFileSync(target,JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({file:target,...manifest.summary}));
} catch(error) {
  console.error(error.message);process.exitCode=1;
}
