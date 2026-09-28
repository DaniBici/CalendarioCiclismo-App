import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../panel/notifications.js', import.meta.url)), 'utf8');

describe('acciones de notificaciones programadas', () => {
  it('no depende de handlers en línea que no alcanzan las funciones del módulo', () => {
    expect(source).not.toMatch(/onclick="(sendScheduledNotificationNow|cancelScheduledNotification)\(/);
    expect(source).toContain('data-scheduled-action="send"');
    expect(source).toContain('data-scheduled-action="cancel"');
  });

  it('delega los clics en el contenedor y desactiva el botón durante la acción', () => {
    expect(source).toContain('wireScheduledActions(container);');
    expect(source).toContain("button.dataset.scheduledAction === 'send'");
    expect(source).toContain('button.disabled = true;');
  });
});
