import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panelSource = readFileSync(new URL('../panel.js', import.meta.url), 'utf8');

describe('orden de emisiones en el panel', () => {
  it('usa solo el listener delegado para las filas nuevas', () => {
    const addBroadcastRow = panelSource.match(/function addBroadcastRow\(\) \{[\s\S]*?\n\}/)?.[0];

    expect(addBroadcastRow).toBeTruthy();
    expect(addBroadcastRow).not.toContain('addEventListener');
    expect(addBroadcastRow).not.toMatch(/bind(?:Remove|Move)Broadcast/);
    expect(panelSource.match(/moveBroadcastRow\(panel, 'up'\)/g)).toHaveLength(1);
    expect(panelSource.match(/moveBroadcastRow\(panel, 'down'\)/g)).toHaveLength(1);
  });
});
