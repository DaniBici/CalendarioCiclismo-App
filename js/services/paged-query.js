/** Consume every page; Supabase caps each response independently of select(). */
export async function fetchAllRows(query, pageSize = 500) {
  const rows=[];
  for (let offset=0;;offset+=pageSize) {
    const {data,error}=await query().range(offset,offset+pageSize-1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length<pageSize) return rows;
  }
}

/**
 * Igual que fetchAllRows, pero pide `batch` páginas a la vez. Una consulta que
 * cabe en `batch` páginas cuesta un solo viaje de ida y vuelta; la página
 * sobrante de cada lote llega vacía. `query` debe fijar un orden estable y
 * `pageSize` no puede superar el tope por respuesta del proyecto (2.000).
 */
export async function fetchAllRowsParallel(query, pageSize = 1000, batch = 2) {
  const rows=[];
  for (let offset=0;;offset+=pageSize*batch) {
    const pages=await Promise.all(Array.from({length:batch},(_,index)=> {
      const from=offset+index*pageSize;
      return Promise.resolve(query().range(from,from+pageSize-1));
    }));
    for (const {data,error} of pages) {
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length<pageSize) return rows;
    }
  }
}

export async function fetchByIds(client, table, columns, field, ids, configure = query => query, orderColumns = ['id']) {
  const unique=[...new Set(ids.filter(value=>value!=null))];
  const chunks=[];
  for (let i=0;i<unique.length;i+=100) chunks.push(unique.slice(i,i+100));
  // Los trozos son independientes: se piden a la vez y se concatenan en orden.
  const pages=await Promise.all(chunks.map(chunk=>fetchAllRows(()=>orderColumns.reduce((query,column)=>query.order(column),configure(client.from(table).select(columns).in(field,chunk))))));
  return pages.flat();
}
