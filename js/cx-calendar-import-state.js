import {cxDateInSeason} from './cx-season.js';

export function validateCxCalendarPreview(manifest,seasonKey) {
  if(!manifest||manifest.source!=='uci_web_calendar'||manifest.seasonKey!==seasonKey||!Array.isArray(manifest.races)||!manifest.races.length)
    throw new Error('Manifiesto incompatible con la temporada seleccionada.');
  if(!manifest.summary||!['races','categories','excludedCompetitions'].every(key=>Number.isSafeInteger(manifest.summary[key])&&manifest.summary[key]>=0)
    ||manifest.races.some(item=>!item?.race||!Array.isArray(item.categories)||!item.categories.length))
    throw new Error('El manifiesto no contiene las pruebas y categorías completas.');
  if(manifest.races.some(item=>!cxDateInSeason(seasonKey,item.race.dateKey)
    ||(item.race.endDateKey&&!cxDateInSeason(seasonKey,item.race.endDateKey))
    ||item.categories.some(category=>!category||!cxDateInSeason(seasonKey,category.dateKey||item.race.dateKey))))
    throw new Error('El calendario CX solo admite pruebas de agosto a febrero.');
  return manifest;
}

// Una selección nueva invalida inmediatamente la anterior. El RPC sigue siendo
// responsable de validar e importar el manifiesto completo de forma atómica.
export class CxCalendarImportState {
  #revision=0;
  #closed=false;
  #state={status:'idle',manifest:null,result:null,error:null};

  constructor(seasonKey,onState=()=>{}) {
    this.seasonKey=seasonKey;
    this.onState=onState;
  }

  get state() {return this.#state;}

  #set(status,{manifest=null,result=null,error=null}={}) {
    this.#state={status,manifest,result,error};
    this.onState(this.#state);
  }

  async load(loader) {
    if(this.#closed||this.#state.status==='applying')return false;
    const revision=++this.#revision;
    this.#set('loading');
    try {
      const manifest=await loader();
      if(this.#closed||revision!==this.#revision)return false;
      validateCxCalendarPreview(manifest,this.seasonKey);
      this.#set('ready',{manifest:structuredClone(manifest)});
      return true;
    } catch(error) {
      if(this.#closed||revision!==this.#revision)return false;
      this.#set('error',{error});
      return false;
    }
  }

  async apply(applier) {
    if(this.#closed||this.#state.status!=='ready')return false;
    const revision=this.#revision,manifest=this.#state.manifest;
    this.#set('applying',{manifest});
    try {
      const result=await applier(structuredClone(manifest));
      if(this.#closed||revision!==this.#revision)return false;
      this.#set('applied',{result});
      return true;
    } catch(error) {
      if(this.#closed||revision!==this.#revision)return false;
      this.#set('ready',{manifest,error});
      return false;
    }
  }

  close() {
    this.#closed=true;
    ++this.#revision;
  }
}
