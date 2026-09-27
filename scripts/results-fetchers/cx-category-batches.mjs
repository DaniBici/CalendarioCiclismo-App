/**
 * Prepara y aplica cada categoría como unidad independiente. Una categoría
 * inválida queda en revisión sin revertir las ya importadas de la competición.
 */
export async function processCxCategoryDocuments({document,categories,prepareCategory,applyCategory}) {
  const selected=new Set(categories);
  const output={applied:[],skipped:[],warnings:[],reviews:[],rowsMatched:0};
  for(const source of document.categories.filter(value=>selected.has(value.category))){
    try{
      const prepared=prepareCategory(source);
      output.skipped.push(...prepared.skipped);
      output.warnings.push(...prepared.warnings);
      output.rowsMatched+=prepared.imports.reduce((sum,value)=>sum+value.rows.length,0);
      if(prepared.imports.length)output.applied.push(...await applyCategory(prepared));
    }catch(error){
      output.reviews.push({category:source.category,reason:`Categoría no importada: ${error.message}`});
    }
  }
  return output;
}
