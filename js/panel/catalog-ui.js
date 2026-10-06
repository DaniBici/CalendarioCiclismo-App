const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const idAttribute=id=>id?` id="${escapeHtml(id)}"`:'';

export function panelDayNavigationHtml({pickerId,previousId,nextId,todayId,addId,addLabel,disabled=false,title='Agenda'}) {
  return `<h1 class="sr-only">${escapeHtml(title)}</h1><div class="date-nav"><div class="date-nav__picker"><button type="button" class="date-nav__arrow date-nav__arrow--left" data-previous${idAttribute(previousId)} title="Día anterior" aria-label="Día anterior">‹</button><input type="date" class="date-nav__input" data-date${idAttribute(pickerId)} aria-label="Fecha de la agenda"><button type="button" class="date-nav__arrow date-nav__arrow--right" data-next${idAttribute(nextId)} title="Día siguiente" aria-label="Día siguiente">›</button></div><button type="button" class="btn btn--ghost date-nav__today" data-today${idAttribute(todayId)}>Hoy</button>${addLabel?`<button type="button" class="btn btn--primary date-nav__add" data-new${idAttribute(addId)} ${disabled?'disabled':''}>${escapeHtml(addLabel)}</button>`:''}</div>`;
}

export function panelCatalogHeaderHtml({tabs,tabsId,controls,filterRowId,searchId,search='',actions}) {
  const optionHtml=(options,value)=>options.map(([key,label])=>`<option value="${escapeHtml(key)}" ${String(key)===String(value??'')?'selected':''}>${escapeHtml(label)}</option>`).join('');
  return `<div class="races-header__inner"><div class="races-header__row1"><div class="races-subview-toggle"${idAttribute(tabsId)} role="tablist" aria-label="${escapeHtml(tabs.map(t=>t.label).join(' o '))}">${tabs.map((tab,index)=>`<button type="button" class="races-subview-btn ${index===0?'active':''}" data-subview="${escapeHtml(tab.key)}" role="tab" aria-selected="${index===0}">${escapeHtml(tab.label)}</button>`).join('')}</div><div class="panel-view-actions">${actions.map(action=>`<button type="button" class="btn btn--${action.primary?'primary':'ghost'} races-new-btn" data-${escapeHtml(action.key)}${idAttribute(action.id)} ${action.disabled?'disabled':''}${action.hidden?' style="display:none"':''}>${escapeHtml(action.label)}</button>`).join('')}</div></div><div class="races-header__row2"${idAttribute(filterRowId)}><div class="races-filters">${controls.map(control=>`<select class="races-select" data-${escapeHtml(control.key)}${idAttribute(control.id)}${control.name?` name="${escapeHtml(control.name)}"`:''} aria-label="${escapeHtml(control.label)}" ${control.disabled?'disabled':''}>${optionHtml(control.options,control.value)}</select>`).join('')}</div><input class="races-search" type="search" data-search${idAttribute(searchId)} placeholder="Buscar…" aria-label="Buscar" value="${escapeHtml(search)}"></div></div>`;
}

export function shiftPanelDay(dateKey,delta) {
  const date=new Date(`${dateKey}T12:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==dateKey)throw new Error('Fecha inválida.');
  date.setUTCDate(date.getUTCDate()+delta);
  return date.toISOString().slice(0,10);
}

export function wirePanelDayNavigation({picker,previous,next,today},{getDate,onChange,todayDate,normalize=date=>date}) {
  const commit=(date,direction=0)=>{const value=normalize(date,direction);picker.value=value;onChange(value);};
  picker.value=getDate();
  picker.addEventListener('change',()=>{if(picker.value)commit(picker.value);else picker.value=getDate();});
  const shift=delta=>commit(shiftPanelDay(getDate(),delta),delta);
  picker.addEventListener('keydown',event=>{
    if(!['ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();shift(event.key==='ArrowUp'?-1:1);
  });
  previous.addEventListener('click',()=>shift(-1));
  next.addEventListener('click',()=>shift(1));
  today.addEventListener('click',()=>commit(todayDate()));
}

export function panelCatalogModel(rows,{categoryOf,categoryOrder,search='',country='',sort='cat',selectedCategory=null}) {
  const needle=search.toLowerCase();
  const filtered=rows.filter(row=>(!needle||(row.name||'').toLowerCase().includes(needle))&&(!country||(row.countryCode||'').toUpperCase()===country.toUpperCase()));
  const groups=new Map();
  for(const row of filtered){const category=categoryOf(row)||'Sin categoría';if(!groups.has(category))groups.set(category,[]);groups.get(category).push(row);}
  const order=category=>{const index=categoryOrder.indexOf(category);return index<0?99:index;};
  const categories=[...groups.keys()].sort((a,b)=>order(a)-order(b)||a.localeCompare(b));
  const category=groups.has(selectedCategory)?selectedCategory:null;
  const flat=Boolean(needle)||sort==='recent';
  const list=[...(category?groups.get(category):filtered)].sort((a,b)=>sort==='recent'
    ?(b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||'')||(a.name||'').localeCompare(b.name||'')
    :(a.name||'').localeCompare(b.name||''));
  return {groups,categories,selectedCategory:category,flat,list,sort};
}

export function panelRaceListItemHtml({flagHtml='',name,isCancelled=false,metadataHtml='',category=''}) {
  return `<span class="race-list-item__flag">${flagHtml}</span><div class="race-list-item__main"><div class="race-list-item__name${isCancelled?' u-strike':''}">${escapeHtml(name)}${isCancelled?' <span class="badge badge--type-cancelled">Cancelada</span>':''}</div><div class="race-list-item__sub">${metadataHtml}</div></div><span class="race-list-item__cat">${escapeHtml(category||'—')}</span>`;
}

export function panelAgendaItemHtml({flagHtml='',name,detailHtml='',badgesHtml=''}) {
  return `<span class="sidebar-item__flag">${flagHtml}</span><div class="sidebar-item__info"><div class="sidebar-item__name">${escapeHtml(name)}</div>${detailHtml?`<div class="sidebar-item__stage">${detailHtml}</div>`:''}<div class="sidebar-item__badges">${badgesHtml}</div></div>`;
}

export function renderPanelCatalog(root,model,{onCategory,onRace,itemHtml,emptyMessage}) {
  root.replaceChildren();
  if(!model.list.length){const empty=document.createElement('p');empty.className='panel-catalog-empty';empty.textContent=emptyMessage;root.append(empty);return;}
  if(!model.flat&&!model.selectedCategory){
    const grid=document.createElement('div');grid.className='cat-grid';
    for(const category of model.categories){const button=document.createElement('button');button.type='button';button.className='cat-grid__btn';button.innerHTML=`<span class="cat-grid__label">${escapeHtml(category)}</span><span class="cat-grid__count">${model.groups.get(category).length}</span>`;button.onclick=()=>onCategory(category);grid.append(button);}
    root.append(grid);return;
  }
  if(model.selectedCategory&&!model.flat){const back=document.createElement('div');back.className='cat-back';back.innerHTML=`<button type="button" class="cat-back__btn">← Categorías</button><div class="cat-back__title">${escapeHtml(model.selectedCategory)} <span class="u-o60">(${model.list.length})</span></div>`;back.querySelector('button').onclick=()=>onCategory(null);root.append(back);}
  for(const race of model.list){const button=document.createElement('button');button.type='button';button.className='race-list-item';button.innerHTML=itemHtml(race,{showTimestamp:model.sort==='recent'});button.onclick=()=>onRace(race);root.append(button);}
}
