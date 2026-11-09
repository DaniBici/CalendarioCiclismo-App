// Lectura por filas de los volcados de tools/site.
//
// Esos .sql devuelven una fila con un json_agg por clave: el servidor monta cada valor entero
// en memoria (126 MB en prerender-resultados.sql), y en una instancia pequeña esa consulta ha
// precedido a reinicios de la base. Aquí cada clave se lee aparte con un cursor, por lotes y en
// una misma foto de los datos, de modo que el servidor no acumula nada. La salida es la misma
// que la de la consulta entera: el HTML generado y su huella dependen de cada valor.
//
// Los .sql no cambian: se siguen leyendo enteros acotados a unas carreras (prototipo de
// publicación). Cada clave debe tener la forma
//   (select coalesce(json_agg(expresión order by orden), '[]') from …) as clave
// o ser un valor suelto, (select valor from …) as clave. Otra forma detiene el volcado.

const LOTE = 2000;

// Por el contenido y no por la ruta: cubre las copias retocadas y la lectura por stdin.
export function esVolcadoWeb(sql) {
  return /^\s*--\s*Volcado\b/.test(sql);
}

// Posición tras la cadena, el identificador entrecomillado o el comentario que empieza en `i`;
// `i` si no empieza ninguno.
function saltarLiteral(sql, i) {
  if (sql.startsWith('--', i)) {
    const fin = sql.indexOf('\n', i);
    return fin === -1 ? sql.length : fin + 1;
  }
  if (sql.startsWith('/*', i)) {
    const fin = sql.indexOf('*/', i);
    if (fin === -1) throw new Error('Comentario sin cerrar en el volcado.');
    return fin + 2;
  }
  const comilla = sql[i];
  if (comilla === "'" || comilla === '"') {
    for (let j = i + 1; j < sql.length; j += 1) {
      if (sql[j] !== comilla) continue;
      if (sql[j + 1] !== comilla) return j + 1;
      j += 1;
    }
    throw new Error('Cadena sin cerrar en el volcado.');
  }
  return i;
}

function sinComentarios(sql) {
  let salida = '';
  for (let i = 0; i < sql.length;) {
    const tras = saltarLiteral(sql, i);
    if (tras === i) { salida += sql[i]; i += 1; continue; }
    if (sql[i] === "'" || sql[i] === '"') salida += sql.slice(i, tras);
    else salida += ' ';
    i = tras;
  }
  return salida;
}

// Posiciones fuera de paréntesis y de literales.
function* nivelCero(sql) {
  let profundidad = 0;
  for (let i = 0; i < sql.length;) {
    const tras = saltarLiteral(sql, i);
    if (tras !== i) { i = tras; continue; }
    if (sql[i] === '(') profundidad += 1;
    else if (sql[i] === ')') profundidad -= 1;
    else if (profundidad === 0) yield i;
    i += 1;
  }
}

function partir(sql, separador) {
  const partes = [];
  let desde = 0;
  for (const i of nivelCero(sql)) {
    if (sql[i] !== separador) continue;
    partes.push(sql.slice(desde, i));
    desde = i + 1;
  }
  partes.push(sql.slice(desde));
  return partes.map(parte => parte.trim()).filter(Boolean);
}

function cierre(sql, abre) {
  let profundidad = 0;
  for (let i = abre; i < sql.length;) {
    const tras = saltarLiteral(sql, i);
    if (tras !== i) { i = tras; continue; }
    if (sql[i] === '(') profundidad += 1;
    else if (sql[i] === ')') {
      profundidad -= 1;
      if (profundidad === 0) return i;
    }
    i += 1;
  }
  throw new Error('Paréntesis sin cerrar en el volcado.');
}

function palabraEnNivelCero(sql, palabra) {
  const patron = new RegExp(`^${palabra}\\b`, 'i');
  let ultima = -1;
  for (const i of nivelCero(sql)) {
    if (/[\w"]/.test(sql[i - 1] ?? ' ')) continue;
    if (patron.test(sql.slice(i, i + palabra.length + 1))) ultima = i;
  }
  return ultima;
}

function planClave(texto) {
  const fin = texto[0] === '(' ? cierre(texto, 0) : -1;
  const alias = fin === -1 ? null : /^as\s+("?)([A-Za-z_]\w*)\1$/i.exec(texto.slice(fin + 1).trim());
  if (!alias) throw new Error(`Clave con forma inesperada en el volcado (ajustarla o quitar el comentario «-- Volcado» inicial): ${texto.slice(0, 80)}`);
  const clave = alias[2];
  const interior = texto.slice(1, fin).trim();
  const agregado = /^select\s+coalesce\s*\(\s*jsonb?_agg\s*\(/i.exec(interior);
  if (!agregado) return { clave, consulta: interior, valorSuelto: true };

  const abre = agregado[0].length - 1;
  const cierra = cierre(interior, abre);
  const vacio = /^\s*,\s*'\[\]'(?:::jsonb?)?\s*\)/.exec(interior.slice(cierra + 1));
  if (!vacio) throw new Error(`La clave ${clave} no devuelve '[]' sin filas.`);
  const resto = interior.slice(cierra + 1 + vacio[0].length).trim();
  const argumentos = interior.slice(abre + 1, cierra);
  const orden = palabraEnNivelCero(argumentos, 'order\\s+by');
  const expresion = (orden === -1 ? argumentos : argumentos.slice(0, orden)).trim();
  const criterio = orden === -1 ? '' : ` ${argumentos.slice(orden).trim()}`;
  return { clave, consulta: `select ${expresion} as fila ${resto}${criterio}`, valorSuelto: false };
}

export function planVolcado(sql) {
  const sentencias = partir(sinComentarios(sql), ';');
  const principal = sentencias.pop();
  const seleccion = [...nivelCero(principal)].find(i =>
    !/[\w"]/.test(principal[i - 1] ?? ' ') && /^select\b/i.test(principal.slice(i, i + 7)));
  if (seleccion === undefined) throw new Error('El volcado no termina en un select.');
  const prefijo = principal.slice(0, seleccion).trim();
  const claves = partir(principal.slice(seleccion + 'select'.length), ',').map(planClave);
  return {
    preambulo: sentencias,
    claves: claves.map(({ clave, consulta, valorSuelto }) => ({
      clave,
      valorSuelto,
      consulta: prefijo ? `${prefijo} ${consulta}` : consulta,
    })),
  };
}

function escribir(salida, texto) {
  if (salida.write(texto)) return Promise.resolve();
  return new Promise(resolve => salida.once('drain', resolve));
}

// Escribe en `salida` lo mismo que JSON.stringify de las filas de la consulta entera.
export async function escribirVolcado(client, plan, salida) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    for (const sentencia of plan.preambulo) await client.query(sentencia);
    await escribir(salida, '[{');
    let primeraClave = true;
    for (const { clave, consulta, valorSuelto } of plan.claves) {
      await escribir(salida, `${primeraClave ? '' : ','}${JSON.stringify(clave)}:`);
      primeraClave = false;
      if (valorSuelto) {
        const { rows } = await client.query(consulta);
        const valor = rows.length ? Object.values(rows[0])[0] : null;
        await escribir(salida, JSON.stringify(valor));
        continue;
      }
      await client.query(`DECLARE volcado NO SCROLL CURSOR FOR ${consulta}`);
      await escribir(salida, '[');
      let primeraFila = true;
      for (;;) {
        const { rows } = await client.query(`FETCH ${LOTE} FROM volcado`);
        if (!rows.length) break;
        const texto = rows.map(fila => JSON.stringify(fila.fila)).join(',');
        await escribir(salida, primeraFila ? texto : `,${texto}`);
        primeraFila = false;
      }
      await client.query('CLOSE volcado');
      await escribir(salida, ']');
    }
    await escribir(salida, '}]\n');
  } finally {
    await client.query('ROLLBACK');
  }
}
