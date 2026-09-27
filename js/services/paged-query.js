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

export async function fetchByIds(client, table, columns, field, ids, configure = query => query, orderColumns = ['id']) {
  const unique=[...new Set(ids.filter(value=>value!=null))];
  const rows=[];
  for (let i=0;i<unique.length;i+=100) {
    rows.push(...await fetchAllRows(()=>orderColumns.reduce((query,column)=>query.order(column),configure(client.from(table).select(columns).in(field,unique.slice(i,i+100))))));
  }
  return rows;
}
