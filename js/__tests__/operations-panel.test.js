import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const panelDir = new URL('../panel/', import.meta.url);
const operationsSource = readFileSync(fileURLToPath(new URL('operations.js', panelDir)), 'utf8');
// Las ausencias se comprueban sobre todos los módulos del panel.
const panelSource = readdirSync(panelDir)
  .filter(file => file.endsWith('.js'))
  .map(file => readFileSync(fileURLToPath(new URL(file, panelDir)), 'utf8'))
  .join('\n');
const panelHtml = readFileSync(fileURLToPath(new URL('../../panel/app.html', import.meta.url)), 'utf8');
const panelCss = readFileSync(fileURLToPath(new URL('../../css/panel.css', import.meta.url)), 'utf8');

describe('monitor de operaciones', () => {
  it('expone resultados y emisiones como pasadas manuales encoladas', () => {
    expect(panelHtml).toContain('data-tab="operations"');
    expect(operationsSource).toContain("admin_trigger_results_sync");
    expect(operationsSource).toContain("admin_trigger_broadcasts_sync");
    expect(operationsSource).toContain("admin_get_automation_monitor");
    expect(panelSource).not.toContain('class="operations-force__track"');
    expect(panelSource).not.toContain('role="switch"');
    expect(operationsSource).toContain('insufficient_broadcast_evidence');
    expect(operationsSource).toContain('selectOperationHistory(payload.runs || [])');
    expect(operationsSource).toContain("stale: 'Sin actualizar'");
    expect(operationsSource).toContain('shortOperationRevision(run.revision)');
    expect(operationsSource).toContain("{ id: 'rai', label: 'RAI' }");
    expect(operationsSource).toContain('operationSourceCatalog(_OPERATIONS_SOURCES, sources)');
    expect(operationsSource).toContain('Compara a diario el catálogo oficial de la UCI');
    expect(operationsSource).toContain('incidencias pendientes de revisión');
    expect(operationsSource).toContain('Corredores dependientes de esos equipos');
    expect(operationsSource).toContain('No son errores publicados');
  });

  it('mantiene una estructura legible y semántica', () => {
    expect(panelHtml).toContain('<h1 class="panel-view-title">Operaciones</h1>');
    expect(panelHtml).toContain('<h2 class="operations-section__title">Fuentes de automatización</h2>');
    expect(operationsSource).toContain('<caption class="sr-only">Últimas ejecuciones por trabajo</caption>');
    expect(operationsSource).toContain('Ver detalles registrados (${detailCount})');
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
