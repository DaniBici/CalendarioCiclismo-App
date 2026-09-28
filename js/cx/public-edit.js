const EDIT_SECTIONS=['identity','startlist','results','tv','videos','docs'];

export function cxPublicEditUrl(raceId,section='identity',basePath='') {
  const tab=EDIT_SECTIONS.includes(section)?section:'identity';
  return `${basePath}/panel/app.html?cxEdit=${encodeURIComponent(raceId)}&tab=${tab}`;
}

export function mountCxPublicEditButton(client,root,raceId,{getSection=()=> 'identity',lang='es',basePath=''}={}) {
  let button,revision=0;
  const remove=()=>{button?.remove();button=null;};
  const update=()=>{if(button)button.href=cxPublicEditUrl(raceId,getSection(),basePath);};
  const applySession=session=>{
    const current=++revision;
    remove();
    if(!session?.user)return Promise.resolve();
    // Defer Supabase I/O outside the auth callback to avoid holding its lock.
    return Promise.resolve().then(async()=>{
      try {
        const {data,error}=await client.rpc('cx_require_admin');
        if(error||data!==true||current!==revision)return;
        const header=root.querySelector('.race-header');
        if(!header)return;
        button=root.ownerDocument.createElement('a');
        button.id='editCxRaceBtn';
        button.className='edit-jornada-btn';
        button.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> '+(lang==='en'?'Edit race':'Editar carrera');
        update();
        header.appendChild(button);
      }catch{/* Unverified sessions do not expose the editor. */}
    });
  };
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{void applySession(session);});
  const initialRevision=revision;
  const ready=client.auth.getSession().then(({data:{session},error})=>{
    if(revision===initialRevision)return applySession(error?null:session);
  }).catch(()=>{});
  return {ready,update,dispose:()=>{++revision;subscription.unsubscribe();remove();}};
}
