// Autocomplete de país compartido por el panel (carretera y ciclocross).
// Muestra bandera + nombre + código ISO y aplica el código en mayúsculas al
// input. Incluye las banderas regionales es-ct (Catalunya) y es-pv (País Vasco).

import { flagIconUrl } from './flag-url.js';

const COUNTRY_LIST = [
  // Regionales (comunidades autónomas de España)
  { code: 'es-an', name: 'Andalucía' },
  { code: 'es-ar', name: 'Aragón' },
  { code: 'es-as', name: 'Asturias' },
  { code: 'es-cn', name: 'Canarias' },
  { code: 'es-cb', name: 'Cantabria' },
  { code: 'es-cm', name: 'Castilla-La Mancha' },
  { code: 'es-cl', name: 'Castilla y León' },
  { code: 'es-ct', name: 'Catalunya' },
  { code: 'es-ce', name: 'Ceuta' },
  { code: 'es-vc', name: 'Comunidad Valenciana' },
  { code: 'es-ex', name: 'Extremadura' },
  { code: 'es-ga', name: 'Galicia' },
  { code: 'es-ib', name: 'Islas Baleares' },
  { code: 'es-ri', name: 'La Rioja' },
  { code: 'es-md', name: 'Madrid' },
  { code: 'es-ml', name: 'Melilla' },
  { code: 'es-mc', name: 'Murcia' },
  { code: 'es-nc', name: 'Navarra' },
  { code: 'es-pv', name: 'País Vasco' },
  // A
  { code: 'ad', name: 'Andorra' },
  { code: 'ae', name: 'Emiratos Árabes Unidos' },
  { code: 'al', name: 'Albania' },
  { code: 'ao', name: 'Angola' },
  { code: 'ar', name: 'Argentina' },
  { code: 'at', name: 'Austria' },
  { code: 'au', name: 'Australia' },
  { code: 'az', name: 'Azerbaiyán' },
  // B
  { code: 'ba', name: 'Bosnia y Herzegovina' },
  { code: 'bd', name: 'Bangladés' },
  { code: 'be', name: 'Bélgica' },
  { code: 'bf', name: 'Burkina Faso' },
  { code: 'bg', name: 'Bulgaria' },
  { code: 'bh', name: 'Baréin' },
  { code: 'bo', name: 'Bolivia' },
  { code: 'br', name: 'Brasil' },
  { code: 'by', name: 'Bielorrusia' },
  // C
  { code: 'ca', name: 'Canadá' },
  { code: 'cd', name: 'República Democrática del Congo' },
  { code: 'ch', name: 'Suiza' },
  { code: 'ci', name: 'Costa de Marfil' },
  { code: 'cl', name: 'Chile' },
  { code: 'cm', name: 'Camerún' },
  { code: 'cn', name: 'China' },
  { code: 'co', name: 'Colombia' },
  { code: 'cr', name: 'Costa Rica' },
  { code: 'cu', name: 'Cuba' },
  { code: 'cy', name: 'Chipre' },
  { code: 'cz', name: 'República Checa' },
  // D
  { code: 'de', name: 'Alemania' },
  { code: 'dk', name: 'Dinamarca' },
  { code: 'do', name: 'República Dominicana' },
  { code: 'dz', name: 'Argelia' },
  // E
  { code: 'ec', name: 'Ecuador' },
  { code: 'ee', name: 'Estonia' },
  { code: 'eg', name: 'Egipto' },
  { code: 'er', name: 'Eritrea' },
  { code: 'es', name: 'España' },
  { code: 'et', name: 'Etiopía' },
  // F
  { code: 'fi', name: 'Finlandia' },
  { code: 'fr', name: 'Francia' },
  // G
  { code: 'gb', name: 'Gran Bretaña' },
  { code: 'ge', name: 'Georgia' },
  { code: 'gh', name: 'Ghana' },
  { code: 'gr', name: 'Grecia' },
  { code: 'gt', name: 'Guatemala' },
  // H
  { code: 'hr', name: 'Croacia' },
  { code: 'hu', name: 'Hungría' },
  // I
  { code: 'id', name: 'Indonesia' },
  { code: 'ie', name: 'Irlanda' },
  { code: 'il', name: 'Israel' },
  { code: 'in', name: 'India' },
  { code: 'iq', name: 'Irak' },
  { code: 'ir', name: 'Irán' },
  { code: 'it', name: 'Italia' },
  // J
  { code: 'jo', name: 'Jordania' },
  { code: 'jp', name: 'Japón' },
  // K
  { code: 'ke', name: 'Kenia' },
  { code: 'kg', name: 'Kirguistán' },
  { code: 'kp', name: 'Corea del Norte' },
  { code: 'kr', name: 'Corea del Sur' },
  { code: 'kw', name: 'Kuwait' },
  { code: 'kz', name: 'Kazajistán' },
  // L
  { code: 'lb', name: 'Líbano' },
  { code: 'li', name: 'Liechtenstein' },
  { code: 'lt', name: 'Lituania' },
  { code: 'lu', name: 'Luxemburgo' },
  { code: 'lv', name: 'Letonia' },
  // M
  { code: 'ma', name: 'Marruecos' },
  { code: 'md', name: 'Moldavia' },
  { code: 'mk', name: 'Macedonia del Norte' },
  { code: 'mn', name: 'Mongolia' },
  { code: 'mt', name: 'Malta' },
  { code: 'mu', name: 'Mauricio' },
  { code: 'mx', name: 'México' },
  { code: 'my', name: 'Malasia' },
  // N
  { code: 'ng', name: 'Nigeria' },
  { code: 'ni', name: 'Nicaragua' },
  { code: 'nl', name: 'Países Bajos' },
  { code: 'no', name: 'Noruega' },
  { code: 'nz', name: 'Nueva Zelanda' },
  // O
  { code: 'om', name: 'Omán' },
  // P
  { code: 'pa', name: 'Panamá' },
  { code: 'pe', name: 'Perú' },
  { code: 'ph', name: 'Filipinas' },
  { code: 'pk', name: 'Pakistán' },
  { code: 'pl', name: 'Polonia' },
  { code: 'pt', name: 'Portugal' },
  { code: 'py', name: 'Paraguay' },
  // Q
  { code: 'qa', name: 'Catar' },
  // R
  { code: 'ro', name: 'Rumanía' },
  { code: 'rs', name: 'Serbia' },
  { code: 'ru', name: 'Rusia' },
  { code: 'rw', name: 'Ruanda' },
  // S
  { code: 'sa', name: 'Arabia Saudí' },
  { code: 'sd', name: 'Sudán' },
  { code: 'se', name: 'Suecia' },
  { code: 'sg', name: 'Singapur' },
  { code: 'si', name: 'Eslovenia' },
  { code: 'sk', name: 'Eslovaquia' },
  { code: 'sn', name: 'Senegal' },
  { code: 'sv', name: 'El Salvador' },
  // T
  { code: 'th', name: 'Tailandia' },
  { code: 'tj', name: 'Tayikistán' },
  { code: 'tm', name: 'Turkmenistán' },
  { code: 'tn', name: 'Túnez' },
  { code: 'tr', name: 'Turquía' },
  { code: 'tw', name: 'Taiwán' },
  { code: 'tz', name: 'Tanzania' },
  // U
  { code: 'ua', name: 'Ucrania' },
  { code: 'ug', name: 'Uganda' },
  { code: 'us', name: 'Estados Unidos' },
  { code: 'uy', name: 'Uruguay' },
  { code: 'uz', name: 'Uzbekistán' },
  // V
  { code: 've', name: 'Venezuela' },
  { code: 'vn', name: 'Vietnam' },
  // Z
  { code: 'za', name: 'Sudáfrica' },
  { code: 'zm', name: 'Zambia' },
  { code: 'zw', name: 'Zimbabue' },
];

export function attachCountryAutocomplete(input) {
  if (input.dataset.countryAc) return; // evitar duplicados
  input.dataset.countryAc = '1';
  input.autocomplete = 'off';

  const dropdown = document.createElement('div');
  dropdown.className = 'country-ac-dropdown';
  // position:fixed anclado al body para no depender del overflow:hidden de contenedores
  // ancestrales (p.ej. .editor-section tiene overflow:hidden para recortar el header).
  dropdown.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-card);border-radius:var(--radius);box-shadow:0 4px 16px rgba(0,0,0,0.18);max-height:220px;overflow-y:auto;min-width:220px;display:none';
  document.body.appendChild(dropdown);

  function positionDropdown() {
    const r = input.getBoundingClientRect();
    dropdown.style.left  = `${r.left}px`;
    dropdown.style.top   = `${r.bottom + 4}px`;
    dropdown.style.width = `${Math.max(r.width, 220)}px`;
  }

  function show(items) {
    dropdown.innerHTML = items.map(c =>
      `<div class="country-ac-item" data-code="${c.code}" style="padding:0.4rem 0.75rem;cursor:pointer;font-family:var(--font-display);font-size:0.8rem;display:flex;align-items:center;gap:0.5rem">
        <img src="${flagIconUrl(c.code)}" style="width:1.2em;height:0.9em;object-fit:cover;border-radius:2px;flex-shrink:0">
        <span>${c.name}</span>
        <span style="margin-left:auto;opacity:0.45;font-size:0.7rem">${c.code.toUpperCase()}</span>
      </div>`
    ).join('');
    if (items.length) {
      positionDropdown();
      dropdown.style.display = 'block';
    } else {
      dropdown.style.display = 'none';
    }
    dropdown.querySelectorAll('.country-ac-item').forEach(item => {
      item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-card-hover)');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = item.dataset.code.toUpperCase();
        dropdown.style.display = 'none';
      });
    });
  }

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    if (!q) { dropdown.style.display = 'none'; return; }
    const matches = COUNTRY_LIST.filter(c =>
      c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    ).slice(0, 8);
    show(matches);
  });

  input.addEventListener('focus', () => {
    const q = input.value.toLowerCase().trim();
    if (q.length >= 1) input.dispatchEvent(new Event('input'));
  });

  // Reposicionar si el usuario scrollea o redimensiona mientras está abierto
  window.addEventListener('scroll', () => {
    if (dropdown.style.display === 'block') positionDropdown();
  }, true);
  window.addEventListener('resize', () => {
    if (dropdown.style.display === 'block') positionDropdown();
  });

  document.addEventListener('click', e => {
    if (e.target !== input && !dropdown.contains(e.target)) dropdown.style.display = 'none';
  });
}
