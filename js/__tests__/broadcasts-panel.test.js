import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fieldsSource = readFileSync(new URL('../panel/jornada-fields.js', import.meta.url), 'utf8');
const modalsSource = readFileSync(new URL('../panel/race-picker.js', import.meta.url), 'utf8');

describe('orden de emisiones en el panel', () => {
  it('usa solo el listener delegado para las filas nuevas', () => {
    const addBroadcastRow = fieldsSource.match(/function addBroadcastRow\(\) \{[\s\S]*?\n\}/)?.[0];

    expect(addBroadcastRow).toBeTruthy();
    expect(addBroadcastRow).not.toContain('addEventListener');
    expect(addBroadcastRow).not.toMatch(/bind(?:Remove|Move)Broadcast/);
    expect(modalsSource.match(/moveBroadcastRow\(panel, 'up'\)/g)).toHaveLength(1);
    expect(modalsSource.match(/moveBroadcastRow\(panel, 'down'\)/g)).toHaveLength(1);
  });
});
