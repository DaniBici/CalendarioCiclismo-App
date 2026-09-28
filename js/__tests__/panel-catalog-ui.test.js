import {describe,it,expect} from 'vitest';
import {shiftPanelDay,wirePanelDayNavigation,panelCatalogModel,panelRaceListItemHtml} from '../panel/catalog-ui.js';
import {cxPanelAgendaDate,cxPanelSeasonForDate,cxPanelAgendaRaces} from '../cx/panel-presentation.js';

const rows=[{name:'Beta',class:'C2',countryCode:'BE',updatedAt:'2026-09-11'}, {name:'Alfa',class:'C1',countryCode:'ES',updatedAt:'2026-09-10'}, {name:'Otra',class:'C2',countryCode:'ES',createdAt:'2026-09-12'}];
const settings={categoryOf:r=>r.class,categoryOrder:['C1','C2']};
describe('catálogo común del panel',()=>{
  it('agrupa por categoría y conserva el filtro al buscar o ordenar por actualización',()=>{
    const grid=panelCatalogModel(rows,settings);expect(grid.categories).toEqual(['C1','C2']);expect(grid.groups.get('C2')).toHaveLength(2);
    const recent=panelCatalogModel(rows,{...settings,sort:'recent',selectedCategory:'C2'});expect(recent.list.map(r=>r.name)).toEqual(['Otra','Beta']);
    expect(panelCatalogModel(rows,{...settings,search:'alfa',selectedCategory:'C1'}).list.map(r=>r.name)).toEqual(['Alfa']);
  });
  it('restablece una categoría que ya no existe tras cambiar de país',()=>{
    const model=panelCatalogModel(rows,{...settings,country:'be',selectedCategory:'C1'});expect(model.selectedCategory).toBeNull();expect(model.list.map(r=>r.name)).toEqual(['Beta']);
    expect(rows.map(r=>r.name)).toEqual(['Beta','Alfa','Otra']);
  });
  it('escapa nombres y categorías de las filas de ambos catálogos',()=>{
    const html=panelRaceListItemHtml({name:'<img onerror=x>',category:'"<script>',isCancelled:true});expect(html).not.toContain('<img onerror');expect(html).toContain('&lt;img onerror=x&gt;');expect(html).toContain('Cancelada');
  });
});
describe('selector común de días',()=>{
  it('usa fechas civiles sin depender del cambio horario',()=>{
    expect(shiftPanelDay('2026-10-25',1)).toBe('2026-10-26');expect(shiftPanelDay('2028-02-28',1)).toBe('2028-02-29');expect(()=>shiftPanelDay('2026-02-30',1)).toThrow();
  });
  it('flechas, teclado, fecha y Hoy actualizan el mismo estado sin perder el selector',()=>{
    const node=()=>({value:'',handlers:{},addEventListener(type,handler){this.handlers[type]=handler;}});
    const picker=node(),previous=node(),next=node(),today=node();let date='2026-09-12',now='2026-09-13';
    wirePanelDayNavigation({picker,previous,next,today},{getDate:()=>date,todayDate:()=>now,onChange:value=>date=value});
    next.handlers.click();expect(date).toBe('2026-09-13');previous.handlers.click();expect(date).toBe('2026-09-12');
    let prevented=false;picker.handlers.keydown({key:'ArrowUp',preventDefault(){prevented=true;}});expect(prevented).toBe(true);expect(date).toBe('2026-09-11');
    picker.value='2026-12-31';picker.handlers.change();expect(date).toBe('2026-12-31');
    now='2026-09-14';today.handlers.click();expect(date).toBe('2026-09-14');expect(picker.value).toBe(date);
    picker.value='';picker.handlers.change();expect(picker.value).toBe(date);
  });
});
describe('agenda del día CX',()=>{
  it('salta los meses excluidos en ambos sentidos y asigna la temporada correcta',()=>{
    expect(cxPanelAgendaDate(shiftPanelDay('2027-02-28',1),1)).toBe('2027-08-01');
    expect(cxPanelAgendaDate(shiftPanelDay('2027-08-01',-1),-1)).toBe('2027-02-28');
    expect(cxPanelAgendaDate('2028-07-31',-1)).toBe('2028-02-29');expect(cxPanelAgendaDate('2027-05-10')).toBe('2027-08-01');
    expect(cxPanelSeasonForDate('2027-02-28')).toBe('2026-27');expect(cxPanelSeasonForDate('2027-08-01')).toBe('2027-28');
  });
  it('muestra cada prueba multidía solo en los días de sus categorías',()=>{
    const races=[{id:'multi',seasonKey:'2026-27',dateKey:'2027-01-29',endDateKey:'2027-01-31',cx_race_categories:[{category:'MJ',dateKey:'2027-01-29'},{category:'ME',dateKey:'2027-01-31'}]},{id:'empty',seasonKey:'2026-27',dateKey:'2027-01-30',cx_race_categories:[]}];
    expect(cxPanelAgendaRaces(races,'2027-01-29').map(r=>r.id)).toEqual(['multi']);expect(cxPanelAgendaRaces(races,'2027-01-30').map(r=>r.id)).toEqual(['empty']);expect(cxPanelAgendaRaces(races,'2027-01-31').map(r=>r.id)).toEqual(['multi']);expect(cxPanelAgendaRaces(races,'2027-03-01')).toEqual([]);
  });
});
