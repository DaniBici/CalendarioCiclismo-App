// Trozo del PDF de inscritos: el mismo código de js/inscritos.js, con los datos publicados.
import { generateStartlistPDF } from '../../../js/inscritos-pdf.js';
import { prepareStartlistData, startlistHeroInfo, startlistPdfOptions } from '../../../js/startlist/data.js';
import { initI18n, t } from '../../../js/i18n.js';

export async function generar(boton, ruta) {
  await initI18n();
  boton.textContent = t('startlist.generatingPdf');
  const respuesta = await fetch(ruta, { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`Inscritos: ${respuesta.status}`);
  const { race, rows } = await respuesta.json();
  const datos = prepareStartlistData(race, rows);
  await generateStartlistPDF(startlistPdfOptions(race, datos, startlistHeroInfo(race, datos.raceDays)));
}
