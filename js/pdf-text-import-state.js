// Solo la selección vigente puede entregar texto o errores al editor.
export class PdfTextImportState {
  #revision=0;
  #pending=false;

  constructor({isCurrent=()=>true,onState=()=>{}}={}) {
    this.isCurrent=isCurrent;
    this.onState=onState;
  }

  get pending(){return this.#pending;}

  invalidate() {
    ++this.#revision;
    if(!this.#pending)return;
    this.#pending=false;
    if(this.isCurrent())this.onState(false);
  }

  async read(file,loader,onText,onError) {
    if(!file||!this.isCurrent())return false;
    const revision=++this.#revision;
    this.#pending=true;
    this.onState(true);
    const current=()=>revision===this.#revision&&this.isCurrent();
    try {
      const text=await loader(file);
      if(!current())return false;
      onText(text);
      return true;
    } catch(error) {
      if(!current())return false;
      onError(error);
      return false;
    } finally {
      if(revision===this.#revision) {
        this.#pending=false;
        if(this.isCurrent())this.onState(false);
      }
    }
  }
}
