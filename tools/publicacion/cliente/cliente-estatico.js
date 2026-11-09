// Cliente de datos sobre filas ya leídas, con la forma de las consultas que hacen el
// cintillo y Últimos resultados. Lo usa el servidor al pintar y el navegador con los
// datos publicados: el mismo código da el mismo resultado sin Supabase.
const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class Consulta {
  constructor(tabla, cargar) {
    this.tabla = tabla;
    this.cargar = cargar;
    this.filtros = [];
    this.ordenes = [];
    this.tramo = null;
  }
  select(_columnas, { count = null } = {}) { this.conRecuento = !!count; return this; }
  single() { this.unica = true; return this; }
  eq(columna, valor) { this.filtros.push(fila => fila[columna] === valor); return this; }
  neq(columna, valor) { this.filtros.push(fila => fila[columna] !== valor); return this; }
  gt(columna, valor) { this.filtros.push(fila => fila[columna] != null && fila[columna] > valor); return this; }
  gte(columna, valor) { this.filtros.push(fila => fila[columna] != null && fila[columna] >= valor); return this; }
  lte(columna, valor) { this.filtros.push(fila => fila[columna] != null && fila[columna] <= valor); return this; }
  is(columna, valor) { this.filtros.push(fila => (fila[columna] ?? null) === valor); return this; }
  in(columna, valores) { const conjunto = new Set(valores); this.filtros.push(fila => conjunto.has(fila[columna])); return this; }
  // `columna.operador.valor` separados por comas: fechas e instantes.
  or(expresion) {
    const partes = expresion.split(',').map(parte => { const [columna, operador, ...resto] = parte.split('.'); return { columna, operador, valor: resto.join('.') }; });
    this.filtros.push(fila => partes.some(({ columna, operador, valor }) => {
      if (operador === 'is') return fila[columna] == null;
      if (fila[columna] == null) return false;
      const a = Date.parse(fila[columna]);
      const b = Date.parse(valor);
      return operador === 'lte' ? a <= b : operador === 'gte' ? a >= b : false;
    }));
    return this;
  }
  order(columna, { ascending = true } = {}) { this.ordenes.push({ columna, ascending }); return this; }
  range(desde, hasta) { this.tramo = [desde, hasta + 1]; return this; }
  then(hecho, fallo) {
    return this.cargar().then(datos => {
      let filas = (datos[this.tabla] || []).filter(fila => this.filtros.every(filtro => filtro(fila)));
      if (this.ordenes.length) {
        filas = [...filas].sort((a, b) => {
          for (const { columna, ascending } of this.ordenes) {
            const orden = comparar(a[columna], b[columna]);
            if (orden) return ascending ? orden : -orden;
          }
          return 0;
        });
      }
      if (this.tramo) filas = filas.slice(...this.tramo);
      if (this.unica) return { data: filas[0] ?? null, error: filas.length ? null : { message: 'Sin filas' } };
      return { data: filas, error: null, ...(this.conRecuento ? { count: filas.length } : {}) };
    }).then(hecho, fallo);
  }
}

export function clienteEstatico(cargar) {
  return {
    from: tabla => new Consulta(tabla, cargar),
    rpc: async (nombre, argumentos) => {
      if (nombre !== 'featured_races_for_dates') return { data: null, error: { message: 'Sin funciones en el cliente estático' } };
      const fechas = new Set(argumentos.date_keys);
      return { data: ((await cargar()).featured || []).filter(fila => fechas.has(fila.dateKey)), error: null };
    },
  };
}
