import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const panelSource = readFileSync(fileURLToPath(new URL('../panel.js', import.meta.url)), 'utf8');
const panelHtml = readFileSync(fileURLToPath(new URL('../../panel/app.html', import.meta.url)), 'utf8');
const panelCss = readFileSync(fileURLToPath(new URL('../../css/panel.css', import.meta.url)), 'utf8');

describe('monitor de operaciones', () => {
  it('expone resultados y emisiones como pasadas manuales encoladas', () => {
    expect(panelHtml).toContain('data-tab="operations"');
    expect(panelSource).toContain("admin_trigger_results_sync");
    expect(panelSource).toContain("admin_trigger_broadcasts_sync");
    expect(panelSource).toContain("admin_get_automation_monitor");
    expect(panelSource).not.toContain('class="operations-force__track"');
    expect(panelSource).not.toContain('role="switch"');
    expect(panelSource).toContain('insufficient_broadcast_evidence');
    expect(panelSource).toContain('selectOperationHistory(payload.runs || [])');
    expect(panelSource).toContain("stale: 'Sin actualizar'");
    expect(panelSource).toContain('shortOperationRevision(run.revision)');
    expect(panelSource).toContain("{ id: 'rai', label: 'RAI' }");
    expect(panelSource).toContain('operationSourceCatalog(_OPERATIONS_SOURCES, sources)');
    expect(panelSource).toContain('Compara a diario el catálogo oficial de la UCI');
    expect(panelSource).toContain('incidencias pendientes de revisión');
    expect(panelSource).toContain('Corredores dependientes de esos equipos');
    expect(panelSource).toContain('No son errores publicados');
  });

  it('mantiene una estructura legible y semántica', () => {
    expect(panelHtml).toContain('<h1 class="panel-view-title">Operaciones</h1>');
    expect(panelHtml).toContain('<h2 class="operations-section__title">Fuentes de automatización</h2>');
    expect(panelSource).toContain('<caption class="sr-only">Últimas ejecuciones por trabajo</caption>');
    expect(panelSource).toContain('Ver detalles registrados (${detailCount})');
    expect(panelCss).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(panelCss).toContain('align-items: start;');
    expect(panelCss).toContain('.operations-catalog__breakdown');
  });

  it('no recupera la vista global retirada', () => {
    expect(panelHtml).not.toContain('id="uciView"');
    expect(panelSource).not.toContain('setupUciView');
    expect(panelSource).not.toContain('Volcar hoy ahora');
    expect(panelSource).not.toContain('admin_trigger_uci_results_workflow');
  });
});
