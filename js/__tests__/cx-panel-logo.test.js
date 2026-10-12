import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
const mocks = vi.hoisted(() => {
  Object.assign(globalThis, {
    SUPABASE_URL: '', SUPABASE_ANON_KEY: '', location: { hash: '', search: '', pathname: '/' },
    window: { location: { hostname: '', pathname: '/', search: '', hash: '' } },
  });
  return { cxLogoImage: vi.fn() };
});
vi.mock('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm', () => ({ createClient: () => ({}) }));
vi.mock('../components/cx-logo.js', async original => ({ ...await original(), cxLogoImage: mocks.cxLogoImage }));

const node = () => ({ hidden: false, disabled: false, textContent: '', innerHTML: '', dataset: {}, style: {},
  classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {},
  addEventListener() {}, replaceChildren() {}, append() {}, prepend() {}, before() {}, querySelector: () => null, querySelectorAll: () => [] });

let wireLogoField, attachInlineUpload;

// Monta el panel CX real con la subida inline real, sin navegador.
beforeAll(async () => {
  // uploads.js carga shared.js, que instala observadores si ya existe `document`.
  ({ attachInlineUpload } = await import('../panel/uploads.js'));
  const rail = { ...node(), children: [] };
  vi.stubGlobal('document', { querySelector: selector => (selector === '.panel-rail__scroll' ? rail : node()),
    querySelectorAll: () => [], createElement: () => ({ ...node(), addEventListener: vi.fn(), click: vi.fn() }) });
  const cx = await import('../panel/cx.js');
  ({ wireLogoField } = cx);
  cx.mountCxPanel({ supabase: {}, navigate() {}, attachInlineUpload });
});

function logoForm() {
  const siblings = [], handlers = new Map();
  const wrapper = { style: {}, querySelector: () => siblings.find(item => item.className === 'inline-upload-btn') ?? null };
  const input = { value: '', name: 'logoUrl', type: 'url', style: {}, parentElement: wrapper,
    after: sibling => siblings.push(sibling),
    addEventListener: (name, handler) => handlers.set(name, handler),
    dispatchEvent: event => handlers.get(event.type)?.(event) };
  const clear = {};
  const nodes = { '[name=logoUrl]': input, '[data-logo-image]': { querySelectorAll: () => [], replaceChildren: vi.fn(), append: vi.fn() },
    '[data-logo-state]': {}, '[data-logo-clear]': clear };
  return { form: { querySelector: selector => nodes[selector] ?? null }, input, siblings, clear };
}

beforeEach(() => mocks.cxLogoImage.mockReset().mockReturnValue(null));

describe('URL y subida del logo en el editor CX', () => {
  it('conserva la URL pegada, previsualiza esa URL y no sube ningún archivo', () => {
    const { form, input, siblings } = logoForm();
    wireLogoField(form);
    input.value = 'https://other.example/shared-logo.svg';
    input.dispatchEvent({ type: 'input' });
    expect(input.value).toBe('https://other.example/shared-logo.svg');
    expect(mocks.cxLogoImage).toHaveBeenLastCalledWith({ logoUrl: 'https://other.example/shared-logo.svg' }, undefined, expect.any(Object));
    // La subida inline añade un selector de archivo oculto y un botón; no escribe sobre el campo.
    expect(siblings.some(item => item.type === 'file' && item.style.display === 'none')).toBe(true);
    expect(siblings.some(item => item.className === 'inline-upload-btn')).toBe(true);
  });

  it('no añade un segundo botón de subida al reenlazar el mismo campo', () => {
    const { form, siblings } = logoForm();
    wireLogoField(form);
    wireLogoField(form);
    expect(siblings.filter(item => item.className === 'inline-upload-btn')).toHaveLength(1);
  });

  it('muestra el error de una URL no válida sin pedir imagen', () => {
    const { form, input } = logoForm();
    wireLogoField(form);
    mocks.cxLogoImage.mockClear();
    input.value = 'javascript:alert(1)';
    input.dispatchEvent({ type: 'input' });
    expect(mocks.cxLogoImage).not.toHaveBeenCalled();
    expect(form.querySelector('[data-logo-state]').textContent).not.toBe('');
  });

  it('quitar el logo vacía el campo y actualiza la vista previa', () => {
    const { form, input, clear } = logoForm();
    wireLogoField(form);
    input.value = 'https://other.example/shared-logo.svg';
    clear.onclick();
    expect(input.value).toBe('');
    expect(mocks.cxLogoImage).toHaveBeenLastCalledWith({ logoUrl: '' }, undefined, expect.any(Object));
  });
});
