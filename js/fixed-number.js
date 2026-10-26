// Decimales con tablas fijas, sin ICU. El Chrome de Google degrada el formato
// español a inglés (docs/memory/seo-og-pages.md) y el HTML de la jornada debe
// salir igual en el navegador, en el build y en ese render. Reproduce
// Number#toLocaleString('es-ES' | 'en-GB', { maximumFractionDigits,
// minimumFractionDigits, useGrouping }): redondeo de la mitad hacia fuera sobre
// el decimal más corto del número; en ES, coma decimal y punto de miles desde
// cinco cifras; en EN, punto decimal y coma de miles desde cuatro. Con
// useGrouping 'always', miles desde cuatro cifras en los dos.
export function fixedDecimal(value, { lang = 'es', maximumFractionDigits = 3, minimumFractionDigits = 0, useGrouping = 'auto' } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  let [int, frac = ''] = (abs < 1e-6 ? abs.toFixed(20) : String(abs)).split('.');
  if (frac.length > maximumFractionDigits) {
    const roundUp = frac[maximumFractionDigits] >= '5';
    frac = frac.slice(0, maximumFractionDigits);
    if (roundUp) {
      const digits = (int + frac).split('');
      let i = digits.length - 1;
      for (; i >= 0 && digits[i] === '9'; i--) digits[i] = '0';
      if (i < 0) digits.unshift('1'); else digits[i] = String(Number(digits[i]) + 1);
      const joined = digits.join('');
      int = joined.slice(0, joined.length - frac.length);
      frac = joined.slice(joined.length - frac.length);
    }
  }
  frac = frac.replace(/0+$/, '').padEnd(minimumFractionDigits, '0');
  const en = lang === 'en';
  if (int.length >= (en || useGrouping === 'always' ? 4 : 5)) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, en ? ',' : '.');
  const sign = n < 0 || Object.is(n, -0) ? '-' : '';
  return `${sign}${int}${frac ? (en ? '.' : ',') + frac : ''}`;
}
