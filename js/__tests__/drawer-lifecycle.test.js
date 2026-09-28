import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

function node() {
  const classes=new Set(),attributes=new Map();
  return {textContent:'',innerHTML:'',scrollTop:0,isConnected:true,style:{overflow:'auto'},
    classList:{add:(...values)=>values.forEach(value=>classes.add(value)),remove:(...values)=>values.forEach(value=>classes.delete(value)),contains:value=>classes.has(value),toggle:(value,enabled)=>enabled?classes.add(value):classes.delete(value)},
    setAttribute:(key,value)=>attributes.set(key,value),
    toggleAttribute:(key,enabled)=>enabled?attributes.set(key,''):attributes.delete(key),
    closest:()=>null,addEventListener:vi.fn(),focus:vi.fn()};
}

describe('propiedad de las instancias del editor compartido',()=>{
  let drawers,nodes;
  beforeEach(async()=>{
    vi.resetModules();
    nodes=Object.fromEntries(['ccDrawerRoot','ccDrawer1','ccDrawer1Body','ccDrawer1Title','ccDrawer1Close','ccDrawer2','ccDrawer2Body','ccDrawer2Title','ccDrawer2Close'].map(id=>[id,node()]));
    const rail=node(),label=node();label.textContent='Carreras';
    vi.stubGlobal('document',{body:node(),activeElement:rail,getElementById:id=>nodes[id],
      querySelectorAll:()=>[],querySelector:selector=>selector.includes('__label')?label:rail,addEventListener:vi.fn()});
    vi.stubGlobal('window',{matchMedia:()=>({matches:false,addEventListener:vi.fn()})});
    vi.stubGlobal('requestAnimationFrame',callback=>callback());
    drawers=await import('../components/drawer.js');
  });
  afterEach(()=>vi.unstubAllGlobals());

  it('una respuesta antigua no puede cerrar ni renombrar el editor que la sustituye',()=>{
    const closed=vi.fn(),old=drawers.openDrawer({title:'Carrera anterior',onClose:closed});
    const current=drawers.openDrawer({title:'Borrador vigente'});
    expect(closed).toHaveBeenCalledTimes(1);
    expect(old.isCurrent()).toBe(false);
    old.setTitle('Respuesta tardía');old.close();
    expect(current.isCurrent()).toBe(true);
    expect(nodes.ccDrawer1Title.textContent).toBe('Borrador vigente');
    expect(drawers.isDrawerOpen()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    current.setTitle('Título vigente');
    expect(nodes.ccDrawer1Title.textContent).toBe('Título vigente');
  });

  it('cerrar y reabrir el mismo host no reactiva un handle retirado',()=>{
    const old=drawers.openDrawer({title:'Guardado pendiente'});
    drawers.closeDrawer();
    const current=drawers.openDrawer({title:'Nueva carrera'});
    expect(old.body).toBe(current.body);
    old.close();
    expect(old.isCurrent()).toBe(false);
    expect(current.isCurrent()).toBe(true);
    expect(nodes.ccDrawerRoot.classList.contains('is-open')).toBe(true);
  });

  it('un handle de ficha sustituida no cierra su sustituta ni el editor padre',()=>{
    const parent=drawers.openDrawer({title:'Jornada'}),closed=vi.fn();
    const old=drawers.openDrawer({level:2,title:'Ficha anterior',onClose:closed});
    const current=drawers.openDrawer({level:2,title:'Resultados vigentes'});
    old.setTitle('Ficha guardada');old.close();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(nodes.ccDrawer2Title.textContent).toBe('Resultados vigentes');
    expect(current.isCurrent()).toBe(true);
    expect(parent.isCurrent()).toBe(true);
    current.close();
    expect(current.isCurrent()).toBe(false);
    expect(parent.isCurrent()).toBe(true);
    expect(drawers.isDrawerOpen()).toBe(true);
  });

  it('sustituir la jornada retira también los handles de sus fichas dependientes',()=>{
    const parentClosed=vi.fn(),childClosed=vi.fn();
    const old=drawers.openDrawer({title:'Jornada anterior',onClose:parentClosed});
    const child=drawers.openDrawer({level:2,title:'Ficha',onClose:childClosed});
    const current=drawers.openDrawer({title:'Jornada nueva'});
    old.close();child.close();
    expect(parentClosed).toHaveBeenCalledTimes(1);
    expect(childClosed).toHaveBeenCalledTimes(1);
    expect(old.isCurrent()).toBe(false);
    expect(child.isCurrent()).toBe(false);
    expect(current.isCurrent()).toBe(true);
    expect(nodes.ccDrawer1.classList.contains('is-open')).toBe(true);
    expect(nodes.ccDrawer2.classList.contains('is-open')).toBe(false);
  });

  it('cerrar el padre vigente cierra ambos niveles una sola vez y restaura el desplazamiento',()=>{
    const parentClosed=vi.fn(),childClosed=vi.fn();
    const parent=drawers.openDrawer({title:'Jornada',onClose:parentClosed});
    const child=drawers.openDrawer({level:2,title:'Ficha',onClose:childClosed});
    parent.close();parent.close();child.close();
    expect(parentClosed).toHaveBeenCalledTimes(1);
    expect(childClosed).toHaveBeenCalledTimes(1);
    expect(parent.isCurrent()).toBe(false);
    expect(child.isCurrent()).toBe(false);
    expect(drawers.isDrawerOpen()).toBe(false);
    expect(document.body.style.overflow).toBe('auto');
  });
});
