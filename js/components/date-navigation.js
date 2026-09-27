export function dateNavigationButton({kind,label,contentHtml='',selected=false,isToday=false,visible=true,direction,onClick}) {
  const button=document.createElement('button');button.type='button';
  button.className=kind==='arrow'?'date-week-arrow cc-scroll-arrow':kind==='today'?`date-today-btn${visible?' date-today-btn--visible':''}`:`date-pill${selected?' active':''}${isToday?' is-today':''}`;
  button.setAttribute('aria-label',label);
  if(kind==='arrow'){button.dataset.direction=direction;button.innerHTML=`<span aria-hidden="true">${direction==='prev'?'‹':'›'}</span>`;}
  else if(contentHtml)button.innerHTML=contentHtml;
  else button.textContent=label;
  if(selected)button.setAttribute('aria-current','date');
  if(onClick)button.addEventListener('click',onClick);
  return button;
}
