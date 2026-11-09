// Publicación por página: pinta con un proceso por idioma, comprime con Brotli y
// escribe con renombrado atómico. Una página cuyo contenido no cambia no se toca.
// Una jornada nueva se publica como cualquier otra; una que desaparece de su
// carrera se retira y, si solo cambió de slug, deja una redirección.
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIRS = { es: 'jornada', en: 'en/stage', 'inscritos-es': 'inscritos', 'inscritos-en': 'en/startlist' };
const IDIOMAS = ['es', 'en'];
const ZONAS = { es: 'Europe/Madrid', en: 'Etc/GMT' };
const CALIDAD_BROTLI = 5;
// El nginx del VPS trae gzip_static, no Brotli.
const CON_GZIP = process.env.CC_GZ === '1';

// Jornadas e inscritos: la clave da su directorio y lo que dejan en disco se reconcilia.
const enDirectorio = clave => clave.split('/')[0] in DIRS;

// Fundido entre páginas: en el propio HTML. En la hoja de estilos no basta: si la de la página de
// destino aún no está en caché, el navegador no sabe a tiempo que debe hacer el fundido.
const REGLA_FUNDIDO = '@view-transition{navigation:auto}';
const conFundido = html => (html.includes(REGLA_FUNDIDO) ? html : html.replace('<head>', `<head><style>@media(prefers-reduced-motion:no-preference){${REGLA_FUNDIDO}}</style>`));

let secuencia = 0;
function escribirAtomico(file, contenido) {
  mkdirSync(dirname(file), { recursive: true });
  const temporal = `${file}.${process.pid}.${++secuencia}.tmp`;
  writeFileSync(temporal, contenido);
  renameSync(temporal, file);
}

function comprimir(texto) {
  return brotliCompressSync(Buffer.from(texto), { params: { [constants.BROTLI_PARAM_QUALITY]: CALIDAD_BROTLI } });
}

/** Brotli primero y el original después: nadie lee un .br de una versión anterior que el original ya no respalde. */
function publicarArchivo(file, texto) {
  if (CON_GZIP) {
    const gz = gzipSync(Buffer.from(texto), { level: 6 });
    escribirAtomico(`${file}.gz`, gz);
    escribirAtomico(file, texto);
    return gz.length;
  }
  const br = comprimir(texto);
  escribirAtomico(`${file}.br`, br);
  escribirAtomico(file, texto);
  return br.length;
}

/** Ruta pública de una clave `es/<slug>` o `en/<slug>`. */
export function rutaDe(clave) {
  const [lang, slug] = clave.split('/');
  return `/${DIRS[lang]}/${encodeURIComponent(slug)}/`;
}

export class Publicador {
  constructor({ salida, activos, estado = null }) {
    this.salida = salida;
    this.activos = activos;
    this.firmas = new Map();
    // clave → { raceId, dayId, ruta }: lo publicado, para saber qué retirar.
    this.publicadas = new Map();
    // Archivo con lo que no se deduce del disco: sobrevive a un reinicio del proceso.
    this.estado = estado;
    this.grupos = {};
    this.pasada = null;
    // clave retirada → clave de destino.
    this.redirecciones = new Map();
    this.trabajadores = {};
    this.pendientes = new Map();
  }

  async iniciar() {
    this.leerEstado();
    for (const lang of IDIOMAS) {
      const hijo = fork(join(HERE, 'trabajador.mjs'), [lang], { env: { ...process.env, TZ: ZONAS[lang] }, serialization: 'advanced' });
      hijo.on('message', mensaje => {
        if (mensaje.listo) return hijo.emit('listo');
        const resolver = this.pendientes.get(mensaje.id);
        this.pendientes.delete(mensaje.id);
        resolver(mensaje);
      });
      await new Promise((done, fail) => { hijo.once('listo', done); hijo.once('exit', code => fail(new Error(`Trabajador ${lang}: código ${code}`))); });
      hijo.removeAllListeners('exit');
      hijo.removeAllListeners('listo');
      this.trabajadores[lang] = hijo;
    }
  }

  cerrar() {
    for (const hijo of Object.values(this.trabajadores)) hijo.kill();
  }

  leerEstado() {
    if (!this.estado || !existsSync(this.estado)) return;
    const { familias = {}, grupos = {} } = JSON.parse(readFileSync(this.estado, 'utf8'));
    for (const [clave, dueño] of Object.entries(familias)) this.publicadas.set(clave, dueño);
    this.grupos = grupos;
  }

  guardarEstado() {
    if (!this.estado) return;
    const familias = Object.fromEntries([...this.publicadas].filter(([clave, dueño]) => !enDirectorio(clave) && dueño.raceId != null));
    escribirAtomico(this.estado, JSON.stringify({ familias, grupos: this.grupos }));
  }

  /** Procesos nuevos: la fecha que los módulos fijan al cargarse (CX_HOME) se vuelve a calcular. */
  async reiniciar() {
    this.cerrar();
    await this.iniciar();
  }

  pintar(lang, items) {
    const id = ++secuencia;
    return new Promise(resolver => {
      this.pendientes.set(id, resolver);
      this.trabajadores[lang].send({ id, items, activos: this.activos });
    });
  }

  /** Trabajos por idioma; las mismas condiciones de existencia que gen_og_pages.py. */
  trabajos(entradas, transformar = null) {
    const salida = { es: [], en: [] };
    for (const input of entradas) {
      const preparado = transformar ? transformar(input) : input;
      if (preparado.familia === 'portada') {
        for (const lang of IDIOMAS) salida[lang].push({ familia: 'portada', slug: preparado.destino, destino: preparado.destino, input: preparado });
        continue;
      }
      if (preparado.familia === 'etapa') {
        for (const lang of IDIOMAS) salida[lang].push({ familia: 'etapa', slug: preparado.entrada.rd.id, input: preparado });
        continue;
      }
      if (preparado.familia === 'carrera') {
        for (const lang of IDIOMAS) salida[lang].push({ familia: 'carrera', slug: preparado.race.id, input: preparado });
        continue;
      }
      if (preparado.familia === 'calendario') {
        for (const lang of IDIOMAS) salida[lang].push({ familia: 'calendario', slug: 'temporada', input: preparado });
        continue;
      }
      if (preparado.familia === 'regeneradas') {
        for (const lang of IDIOMAS) salida[lang].push({ familia: 'regeneradas', slug: preparado.tipo, input: preparado });
        continue;
      }
      if (preparado.familia === 'hoy') {
        for (const lang of IDIOMAS) salida[lang].push({ familia: 'hoy', slug: 'hoy', input: preparado });
        continue;
      }
      if (preparado.familia === 'mercado') {
        for (const lang of IDIOMAS) salida[lang].push({ familia: 'mercado', slug: 'mercado', input: preparado });
        continue;
      }
      if (preparado.familia === 'resultados') {
        for (const lang of IDIOMAS) salida[lang].push({ familia: 'resultados', slug: 'feed', input: preparado });
        continue;
      }
      if (preparado.familia === 'inscritos') {
        const { race } = preparado;
        if (race.slug) salida.es.push({ familia: 'inscritos', slug: race.slug, input: preparado });
        if (race.slugEn && (race.nameEn || race.name)) salida.en.push({ familia: 'inscritos', slug: race.slugEn, input: preparado });
        continue;
      }
      if (preparado.rd.slug) salida.es.push({ slug: preparado.rd.slug, input: preparado });
      if (preparado.rd.slugEn && (preparado.race.nameEn || preparado.race.name)) salida.en.push({ slug: preparado.rd.slugEn, input: preparado });
    }
    return salida;
  }

  /**
   * Pinta las jornadas `entradas` (Datos.entradas) y publica las que cambian.
   * Devuelve tiempos, recuentos y claves. `transformar(input)`, para simular un cambio.
   */
  async publicar(entradas, { transformar = null, forzar = false } = {}) {
    const trabajos = this.trabajos(entradas, transformar);
    const inicio = performance.now();
    const resultados = await Promise.all(Object.entries(trabajos).filter(([, items]) => items.length).map(async ([lang, items]) => {
      // Lotes: IPC con muchos documentos pesa más que el pintado.
      const salida = [];
      const errores = [];
      let ms = 0;
      for (let at = 0; at < items.length; at += 200) {
        const parte = await this.pintar(lang, items.slice(at, at + 200));
        salida.push(...parte.salida);
        errores.push(...parte.errores);
        ms += parte.ms;
      }
      return { salida, errores, ms };
    }));
    const pintado = performance.now();
    const paginas = resultados.flatMap(result => result.salida);
    for (const pagina of paginas) pagina.pagina = conFundido(pagina.pagina);
    const clavesCambiadas = [];
    let bytes = 0;
    let bytesBr = 0;
    for (const pagina of paginas) {
      this.publicadas.set(pagina.clave, { raceId: pagina.raceId, dayId: pagina.dayId, ruta: pagina.ruta ?? null });
      this.pasada?.claves.add(pagina.clave);
      this.quitarRedireccion(pagina.clave);
      // Archivos que acompañan a la página, antes que ella.
      for (const [ruta, texto] of Object.entries(pagina.archivos || {})) {
        const firmaArchivo = createHash('sha1').update(texto).digest('hex');
        if (!forzar && this.firmas.get(ruta) === firmaArchivo) continue;
        this.firmas.set(ruta, firmaArchivo);
        publicarArchivo(join(this.salida, ruta), texto);
      }
      const firma = createHash('sha1').update(pagina.pagina).update(pagina.datos ?? '').digest('hex');
      if (!forzar && this.firmas.get(pagina.clave) === firma) continue;
      this.firmas.set(pagina.clave, firma);
      clavesCambiadas.push(pagina.clave);
      const base = pagina.ruta != null ? join(this.salida, pagina.ruta) : join(this.salida, DIRS[pagina.clave.split('/')[0]], pagina.slug);
      if (pagina.datos != null) publicarArchivo(join(this.salida, 'd', `${pagina.clave}.json`), pagina.datos);
      if (pagina.fragmento != null) publicarArchivo(join(this.salida, 'f', `${pagina.clave}.html`), pagina.fragmento);
      bytesBr += publicarArchivo(join(base, 'index.html'), pagina.pagina);
      bytes += Buffer.byteLength(pagina.pagina);
      // La versión al final: una pestaña abierta solo la ve con todo lo anterior escrito.
      escribirAtomico(join(this.salida, 'v', `${pagina.clave}.txt`), pagina.version);
    }
    const fin = performance.now();
    if (this.pasada && resultados.some(result => result.errores.length)) this.pasada.conErrores = true;
    return {
      paginas: paginas.length, cambiadas: clavesCambiadas.length, clavesCambiadas, bytes, bytesBr,
      claves: paginas.map(pagina => pagina.clave),
      errores: resultados.flatMap(result => result.errores),
      pintadoMs: pintado - inicio,
      pintadoCpuMs: resultados.reduce((sum, result) => sum + result.ms, 0),
      escrituraMs: fin - pintado,
      totalMs: fin - inicio,
    };
  }

  /** Publica una carrera y retira lo publicado de ella que ya no existe. */
  async publicarCarrera(raceId, entradas, opciones = {}) {
    const fase = await this.publicar(entradas, opciones);
    if (fase.errores.length) return { ...fase, retiradas: [], redirigidas: [] };
    return { ...fase, ...this.retirarAusentes(fase.claves, (dueño, clave) => enDirectorio(clave) && dueño.raceId === raceId) };
  }

  /** Publica todo lo vigente y retira lo demás, también lo que solo está en disco. */
  async sincronizar(entradas, opciones = {}) {
    const fase = await this.publicar(entradas, opciones);
    // Una página que no se ha podido pintar no ha dejado de existir.
    if (fase.errores.length) return { ...fase, retiradas: [], redirigidas: [] };
    // Solo jornadas e inscritos: el resto de familias se publica aparte (retirarFamilia, cerrarPasada).
    const { retiradas, redirigidas } = this.retirarAusentes(fase.claves, (dueño, clave) => enDirectorio(clave) && dueño.raceId != null);
    return { ...fase, retiradas: [...retiradas, ...this.reconciliar()], redirigidas };
  }

  retirarAusentes(claves, afecta) {
    const vigentes = new Set(claves);
    const destinoPorDia = new Map();
    for (const clave of claves) destinoPorDia.set(`${clave.split('/')[0]}|${this.publicadas.get(clave).dayId}`, clave);
    const retiradas = [];
    const redirigidas = [];
    for (const [clave, dueño] of [...this.publicadas]) {
      if (!afecta(dueño, clave) || vigentes.has(clave)) continue;
      const destino = destinoPorDia.get(`${clave.split('/')[0]}|${dueño.dayId}`) || null;
      this.retirar(clave, destino);
      (destino ? redirigidas : retiradas).push(clave);
    }
    return { retiradas, redirigidas };
  }

  /** Tras publicar `familia` (carrera, etapa) para `carreras`: retira lo de ellas que ya no sale. */
  retirarFamilia(familia, claves, carreras) {
    const vigentes = new Set(claves);
    const retiradas = [];
    for (const [clave, dueño] of [...this.publicadas]) {
      if (!clave.startsWith(`${familia}-`) || !carreras.has(dueño.raceId) || vigentes.has(clave)) continue;
      this.retirar(clave);
      retiradas.push(clave);
    }
    return retiradas;
  }

  /** Pasada completa: al cerrarla se retira lo que no ha salido, también lo que dejó un proceso anterior. */
  abrirPasada() {
    this.pasada = { claves: new Set(), conErrores: false };
  }

  cerrarPasada() {
    const { claves, conErrores } = this.pasada;
    this.pasada = null;
    const retiradas = [];
    if (!conErrores) {
      for (const [clave, dueño] of [...this.publicadas]) {
        if (enDirectorio(clave) || dueño.raceId == null || claves.has(clave)) continue;
        this.retirar(clave);
        retiradas.push(clave);
      }
    }
    this.guardarEstado();
    return retiradas;
  }

  /** Archivos escritos sin clave propia (`grupo`): se borra lo que estaba en la vez anterior y ya no. */
  retirarRutasAusentes(grupo, vigentes) {
    const retiradas = (this.grupos[grupo] || []).filter(ruta => !vigentes.has(ruta));
    for (const ruta of retiradas) {
      for (const extension of ['', '.br', '.gz']) rmSync(join(this.salida, `${ruta}${extension}`), { force: true });
      this.firmas.delete(ruta);
    }
    this.grupos[grupo] = [...vigentes];
    this.guardarEstado();
    return retiradas;
  }

  /** Publica un archivo suelto: datos de la agenda o del cintillo. */
  publicarRuta(ruta, texto) {
    const contenido = ruta.endsWith('.html') ? conFundido(texto) : texto;
    const firma = createHash('sha1').update(contenido).digest('hex');
    if (this.firmas.get(ruta) === firma) return 0;
    this.firmas.set(ruta, firma);
    return publicarArchivo(join(this.salida, ruta), contenido);
  }

  /** Retira una página. Con `destino` (clave), su URL pasa a redirigir allí. */
  retirar(clave, destino = null) {
    const [lang, slug] = clave.split('/');
    const ruta = this.publicadas.get(clave)?.ruta;
    if (ruta != null) {
      // Su directorio puede contener las páginas de otras claves: solo su documento.
      for (const extension of ['', '.br', '.gz']) rmSync(join(this.salida, ruta, `index.html${extension}`), { force: true });
    } else {
      rmSync(join(this.salida, DIRS[lang], slug), { recursive: true, force: true });
    }
    for (const raiz of ['d', 'f']) {
      for (const extension of raiz === 'd' ? ['json', 'json.br', 'json.gz'] : ['html', 'html.br', 'html.gz']) {
        rmSync(join(this.salida, raiz, `${clave}.${extension}`), { force: true });
      }
    }
    this.firmas.delete(clave);
    this.publicadas.delete(clave);
    const version = join(this.salida, 'v', `${clave}.txt`);
    if (destino) {
      // Una pestaña abierta ve el traslado en su siguiente comprobación.
      escribirAtomico(version, `→${rutaDe(destino)}`);
      this.fijarRedireccion(clave, destino);
      // Lo que apuntaba aquí pasa a apuntar al destino final.
      for (const [origen, anterior] of [...this.redirecciones]) if (anterior === clave) this.fijarRedireccion(origen, destino);
    } else {
      rmSync(version, { force: true });
    }
  }

  fijarRedireccion(origen, destino) {
    this.redirecciones.set(origen, destino);
    escribirAtomico(join(this.salida, 'r', `${origen}.txt`), rutaDe(destino));
  }

  quitarRedireccion(clave) {
    if (!this.redirecciones.delete(clave)) return;
    rmSync(join(this.salida, 'r', `${clave}.txt`), { force: true });
  }

  /** Retira lo que hay en disco y no está publicado (cambios con el proceso parado). */
  reconciliar() {
    const raiz = join(this.salida, 'v');
    const huerfanas = [];
    for (const lang of Object.keys(DIRS)) {
      const dir = join(raiz, lang);
      if (!existsSync(dir)) continue;
      for (const nombre of readdirSync(dir)) {
        if (!nombre.endsWith('.txt')) continue;
        const clave = `${lang}/${nombre.slice(0, -4)}`;
        if (this.publicadas.has(clave)) continue;
        // Las trasladadas conservan su marca: la redirección sigue vigente.
        if (readFileSync(join(dir, nombre), 'utf8').startsWith('→')) continue;
        this.retirar(clave);
        huerfanas.push(clave);
      }
    }
    return huerfanas;
  }
}
