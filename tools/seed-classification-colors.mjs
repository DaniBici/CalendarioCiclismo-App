import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Genera SQL revisable. La escritura se realiza con el conector MCP de Supabase.
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
export function classificationColorSeed(manifest) {
  if (!Number.isInteger(manifest.edition) || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.consultedAt || '')) throw new Error('Edición o fecha inválida');
  const rows = [];
  const keys = new Set();
  for (const race of manifest.races) for (const c of race.classifications) {
    if (c.status !== 'confirmed') continue;
    const key = `${race.id}:${c.classKind}`;
    if (keys.has(key) || race.year !== manifest.edition || !c.editionVerified || c.classKind === 'stage'
      || !race.kinds?.includes(c.classKind) || !/^#[0-9a-f]{6}$/i.test(c.colorHex || '')
      || !/^https:\/\//.test(c.sourceUrl || '')) throw new Error(`Asociación no acreditada: ${key}`);
    keys.add(key);
    const source = { kind:'official_jersey', edition:manifest.edition, sourceUrl:c.sourceUrl,
      consultedAt:manifest.consultedAt, description:c.description, evidence:c.evidence || null, hexIsOfficial:false };
    rows.push(`(${quote(race.id)}, ${quote(c.classKind)}, ${quote(c.colorHex)}, ${quote(JSON.stringify(source))}::jsonb)`);
  }
  if (!rows.length) throw new Error('No hay colores acreditados');
  return `WITH seed("raceId","classKind","colorHex","colorSource") AS (VALUES\n${rows.join(',\n')}\n)
UPDATE public.race_classifications c SET "colorHex"=seed."colorHex", "colorSource"=seed."colorSource", "updatedAt"=now()
FROM seed JOIN public.races r ON r.id=seed."raceId" AND r.year=${manifest.edition}
WHERE c."raceId"=seed."raceId" AND c."classKind"=seed."classKind"
  AND c."colorHex" IS NULL AND c."colorSource" IS NULL
  AND EXISTS (SELECT 1 FROM public.race_uci_stages s WHERE s."raceId"=c."raceId" AND s."classKind"=c."classKind" AND s."keepForWeb")
RETURNING c."raceId",c."classKind",c."colorHex";\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] || 'docs/plans/jerseys-2026.json';
  process.stdout.write(classificationColorSeed(JSON.parse(await readFile(file,'utf8'))));
}
