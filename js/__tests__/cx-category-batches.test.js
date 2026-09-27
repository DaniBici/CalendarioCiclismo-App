import {describe,expect,it} from 'vitest';
import {processCxCategoryDocuments} from '../../scripts/results-fetchers/cx-category-batches.mjs';

describe('volcado progresivo de categorías CX',()=>{
  it('aplica las categorías presentes y no espera a una categoría aún ausente',async()=>{
    const applied=[];
    const value=await processCxCategoryDocuments({
      document:{categories:['MJ','WJ','WE'].map(category=>({category,rows:[{rank:1}]}))},
      categories:['MJ','WJ','WE','ME'],
      prepareCategory:source=>({imports:[{category:source.category,rows:source.rows}],skipped:[],warnings:[]}),
      applyCategory:async prepared=>{applied.push(prepared.imports[0].category);return [{category:prepared.imports[0].category,rows:1,unchanged:false}];},
    });
    expect(applied).toEqual(['MJ','WJ','WE']);
    expect(value).toMatchObject({rowsMatched:3,reviews:[]});
  });

  it('aísla el fallo de una categoría y conserva las demás',async()=>{
    const applied=[];
    const value=await processCxCategoryDocuments({
      document:{categories:['MJ','WE','WJ'].map(category=>({category,rows:[{rank:1}]}))},
      categories:['MJ','WE','WJ'],
      prepareCategory:source=>{
        if(source.category==='WE')throw new Error('fila contradictoria');
        return {imports:[{category:source.category,rows:source.rows}],skipped:[],warnings:[]};
      },
      applyCategory:async prepared=>{applied.push(prepared.imports[0].category);return [{category:prepared.imports[0].category,rows:1,unchanged:false}];},
    });
    expect(applied).toEqual(['MJ','WJ']);
    expect(value.rowsMatched).toBe(2);
    expect(value.reviews).toEqual([{category:'WE',reason:'Categoría no importada: fila contradictoria'}]);
  });
});
