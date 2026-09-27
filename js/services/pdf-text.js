async function loadPdfJs() {
  const pdf=await import('../vendor/pdfjs/pdf.min.mjs');
  pdf.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdfjs/pdf.worker.min.mjs',import.meta.url).href;
  return pdf;
}

export async function extractPdfText(file,loadPdf=loadPdfJs) {
  const pdf=await loadPdf();
  const loadingTask=pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())});
  const lines=[];
  try {
    const document=await loadingTask.promise;
    for(let p=1;p<=document.numPages;p++) {
      const page=await document.getPage(p),content=await page.getTextContent(),groups=new Map();
      for(const item of content.items) {
        if(!item.str?.trim())continue;
        const y=Math.round(item.transform[5]*2)/2;
        if(!groups.has(y))groups.set(y,[]);
        groups.get(y).push(item);
      }
      for(const [,items] of [...groups].sort((a,b)=>b[0]-a[0]))
        lines.push(items.sort((a,b)=>a.transform[4]-b.transform[4]).map(item=>item.str.trim()).join('\t'));
    }
    if(!lines.length)throw new Error('El PDF no contiene texto extraíble.');
    return lines.join('\n');
  } catch(error) {
    if(error?.name==='InvalidPDFException')throw new Error('El PDF no es válido o está dañado.');
    if(error?.name==='PasswordException')throw new Error('El PDF está protegido con contraseña.');
    throw error;
  } finally {
    await loadingTask.destroy();
  }
}
