// Lo que una página publicada conserva de su versión en el sitio base.
const quitarScripts = html => html.replace(/<script\b[^>]*\bsrc="[^"]*"[^>]*><\/script>\s*/g, '');

export function piezasBase(source, { tema, fuente, css, isla }) {
  const inicio = source.indexOf('<body');
  const cuerpo = source.indexOf('>', inicio) + 1;
  const abreCabecera = source.indexOf('<header class="site-header"', cuerpo);
  const cierraCabecera = source.indexOf('</header>', abreCabecera) + '</header>'.length;
  const abreMain = source.indexOf('<main', cierraCabecera);
  if (inicio < 0 || abreCabecera < 0 || abreMain < 0) return null;
  let enlaces = false;
  const head = source.slice(0, inicio)
    .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
    .replace(/<link rel="preconnect" href="https:\/\/[^"]*supabase\.co"[^>]*>\s*/g, '')
    .replace(/<script src="[^"]*theme\.js[^"]*"><\/script>/, `<script src="${tema}"></script>`)
    // Las hojas propias, en una; las externas (MapLibre) se quedan.
    .replace(/<link rel="stylesheet" href="(?!https:)[^"]*">\s*/g, () => {
      if (enlaces) return '';
      enlaces = true;
      return `<link rel="stylesheet" href="${fuente}"><link rel="stylesheet" href="${css}"><link rel="modulepreload" fetchpriority="low" href="${isla}">`;
    });
  if (!enlaces) return null;
  return {
    head,
    antes: quitarScripts(source.slice(cuerpo, abreCabecera)).trim(),
    entre: quitarScripts(source.slice(cierraCabecera, abreMain)).trim(),
    atributosCabecera: /<header class="site-header" id="siteHeader"([^>]*)>/.exec(source)?.[1] || '',
    atributosMain: /<main([^>]*)>/.exec(source.slice(abreMain))?.[1].replace(/\sdata-prerendered="[^"]*"/, '') || '',
  };
}
