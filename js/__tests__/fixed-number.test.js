import { describe, expect, it } from 'vitest';
import { fixedDecimal } from '../fixed-number.js';

const LOCALES = { es: 'es-ES', en: 'en-GB' };
const OPTIONS = [{}, { maximumFractionDigits: 1 }, { maximumFractionDigits: 1, minimumFractionDigits: 1 }, { maximumFractionDigits: 0 },
  { maximumFractionDigits: 2 }, { useGrouping: 'always' }];
// Mitades exactas y casi exactas, miles a partir de cuatro y cinco cifras, negativos y ceros.
const VALUES = [0, -0, 1, 4.05, 4.15, 4.25, 4.35, 1.005, 2.675, 9.95, 9.995, 99.95, 999.95, 1234.5, 9999.5, 10000,
  12345.678, 123456789.123, 0.0005, 0.00049, 1e-7, -0.04, -1.25, -1234.5, 185.4, 212.25];

describe('fixedDecimal', () => {
  it('coincide con toLocaleString de es-ES y en-GB', () => {
    for (const [lang, locale] of Object.entries(LOCALES)) {
      for (const options of OPTIONS) {
        for (const value of VALUES) {
          expect(fixedDecimal(value, { lang, ...options }), `${value} ${lang} ${JSON.stringify(options)}`)
            .toBe(value.toLocaleString(locale, options));
        }
      }
    }
  });

  it('formatea sin ICU: coma decimal en ES y punto en EN', () => {
    expect(fixedDecimal(185.4, { lang: 'es' })).toBe('185,4');
    expect(fixedDecimal(185.4, { lang: 'en' })).toBe('185.4');
    expect(fixedDecimal(7.95, { lang: 'es', maximumFractionDigits: 1, minimumFractionDigits: 1 })).toBe('8,0');
    expect(fixedDecimal(1234, { lang: 'es' })).toBe('1234');
    expect(fixedDecimal(12345, { lang: 'es' })).toBe('12.345');
    expect(fixedDecimal(1234, { lang: 'en' })).toBe('1,234');
  });
});
