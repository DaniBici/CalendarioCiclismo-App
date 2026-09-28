import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const panelCss = readFileSync(fileURLToPath(new URL('../../css/panel.css', import.meta.url)), 'utf8');

describe('layout del panel', () => {
  it('ancla la vista de corredores a la derecha del rail', () => {
    expect(panelCss).toContain('#ridersView,');
  });
});
