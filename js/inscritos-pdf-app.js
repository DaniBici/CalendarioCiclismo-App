// ─────────────────────────────────────────────────────────────────
//  INSCRITOS-PDF-APP — genera el PDF de inscritos para las apps
//  URL: /inscritos-pdf.html?race=RACE_ID[&lang=en]
//
//  Las apps cargan esta página en una vista web invisible. Genera el mismo PDF
//  que la web (inscritos-pdf.js) y lo entrega en base64 al puente nativo:
//    iOS      window.webkit.messageHandlers.ccStartlistPdf.postMessage(msg)
//    Android  window.CCStartlistPdf.onPdf(fileName, base64) / .onError(message)
//  msg = { type: 'pdf', fileName, base64 } | { type: 'error', message }.
//  Sin cabecera, aviso de cookies ni analítica.
// ─────────────────────────────────────────────────────────────────

import { initI18n, getLang } from './i18n.js';
import { enBase } from './shared.js';
import { generateStartlistPDF } from './inscritos-pdf.js';
import { resolveStartlistRace, loadStartlistData, startlistHeroInfo, startlistPdfOptions } from './startlist/data.js';

function post(message) {
  const ios = window.webkit?.messageHandlers?.ccStartlistPdf;
  if (ios) { ios.postMessage(message); return; }
  const android = window.CCStartlistPdf;
  if (android) {
    if (message.type === 'pdf') android.onPdf(message.fileName, message.base64);
    else android.onError(message.message || 'error');
    return;
  }
  console.log('[inscritos-pdf-app]', message.type, message.fileName || message.message);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function run() {
  await initI18n();
  const params = new URLSearchParams(window.location.search);
  const isEn = getLang() === 'en';
  const race = await resolveStartlistRace({ raceId: params.get('race'), slug: params.get('slug'), isEn });
  if (!race) throw new Error('race-not-found');
  const data = await loadStartlistData(race);
  if (!data) throw new Error('startlist-empty');

  const hero = startlistHeroInfo(race, data.raceDays);
  const path = isEn
    ? `${enBase()}/startlist/${encodeURIComponent(race.slugEn || race.slug)}/`
    : `/inscritos/${encodeURIComponent(race.slug)}/`;
  await generateStartlistPDF({
    ...startlistPdfOptions(race, data, hero),
    pageUrl: new URL(path, window.location.origin).href,
    deliver: async ({ blob, fileName }) => {
      post({ type: 'pdf', fileName, base64: await blobToBase64(blob) });
    },
  });
}

run().catch(err => post({ type: 'error', message: String(err?.message || err) }));
