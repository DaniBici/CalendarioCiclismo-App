const count=value=>Number(value||0).toLocaleString('es-ES',{useGrouping:'always'});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const panelSectionHtml=(title,body,attributes='')=>`<section class="editor-section" ${attributes}><div class="editor-section__header"><span class="editor-section__title">${esc(title)}</span></div><div class="editor-section__body">${body}</div></section>`;

export function panelEditorTopbarHtml({name,flagHtml='',detail='',date='',published=false,updated='',actionsHtml=''}) {
  return `<div class="editor-topbar"><div class="editor-topbar__title"><div class="editor-topbar__headline">${flagHtml} ${esc(name)}${detail?` · ${esc(detail)}`:''}${date?` · <span class="editor-topbar__date">${esc(date)}</span>`:''}</div><div class="editor-topbar__meta"><span class="editor-topbar__status ${published?'editor-topbar__status--pub':''}">${published?'Publicado':'Borrador'}</span>${updated?`<span class="editor-topbar__updated" title="Última actualización">✎ ${esc(updated)}</span>`:''}</div></div><div class="editor-topbar__actions">${actionsHtml}</div></div>`;
}

export function panelEditorTabsHtml(tabs,{id='',attribute='target',active=null}={}) {
  return `<div class="editor-tabs" ${id?`id="${esc(id)}"`:''} role="tablist">${tabs.map(({key,label,disabled=false})=>`<button type="button" class="editor-tab ${key===active?'editor-tab--active':''}" role="tab" aria-selected="${key===active}" data-${attribute}="${esc(key)}" ${disabled?'disabled':''}>${esc(label)}</button>`).join('')}</div>`;
}

export function panelClassificationRowHtml({label,title='',rowCount=0,leader='',locked=false,chipsHtml='',actionsHtml=''}) {
  return `<div class="ru-class-row${locked?' ru-class-row--locked':''}"><div class="ru-class-row__main"><span class="ru-class-row__label" title="${esc(title)}">${esc(label)}</span><span class="ru-class-row__meta">${esc(rowCount)} filas${leader?` · 🏆 ${esc(leader)}`:''}</span></div>${chipsHtml}${actionsHtml}</div>`;
}

export function panelTeamRowHtml(team,{meta=[]}={}) {
  return `<div class="panel-team-row" data-team-id="${esc(team.id)}"><span class="panel-team-row__name"><strong>${esc(team.name)}</strong></span><span class="panel-team-row__meta">${esc(meta.filter(Boolean).join(' · '))}</span><button type="button" class="btn btn--ghost" data-edit-team-id="${esc(team.id)}">Editar</button></div>`;
}

export function panelTeamCatalogHtml({sections,selectedCategory=null,search='',total,rowHtml,filteredRows=null,emptyMessage='Sin resultados.'}) {
  const all=filteredRows||sections.flatMap(s=>s.items),section=sections.find(s=>s.key===selectedCategory);
  const selected=section?.key||null;
  if(!all.length)return {selectedCategory:selected,html:`<div class="u-fs-3 u-c-dim">${esc(emptyMessage)}</div>`};
  if(!search&&!section)return {selectedCategory:null,html:`<div class="cat-grid">${sections.map(s=>`<button type="button" class="cat-grid__btn" data-team-category="${esc(s.key)}"><span class="cat-grid__label">${esc(s.label)}</span><span class="cat-grid__count">${count(s.items.length)}</span></button>`).join('')}</div>`};
  const rows=[...(search?all:section.items)].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const header=search?`<div class="panel-catalog-count">${count(all.length)} de ${count(total)} equipos</div>`:`<div class="cat-back"><button type="button" class="cat-back__btn">← Categorías</button><div class="cat-back__title">${esc(section.label)} <span class="u-c-muted u-fw-400">(${count(section.items.length)})</span></div></div>`;
  return {selectedCategory:selected,html:`${header}<div class="panel-list">${rows.map(rowHtml).join('')}</div>`};
}

export function panelRiderRowHtml(rider,{index,flagHtml='',teamName=''}={}) {
  const female=['female','women'].includes(rider.gender);
  return `<button type="button" class="panel-rider-row" data-rider-index="${esc(index)}"><span class="panel-rider-row__flag">${flagHtml}</span><span class="panel-rider-row__name"><strong>${esc(rider.lastName)}</strong>, ${esc(rider.firstName)} <span class="u-c-dim u-fs-1">${female?'♀':'♂'}${rider.birthDate?` '${esc(String(rider.birthDate).slice(2,4))}`:''}</span>${teamName?`<span class="panel-rider-row__team">${esc(teamName)}</span>`:''}</span></button>`;
}
