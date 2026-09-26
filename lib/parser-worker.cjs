const { parentPort, workerData } = require('node:worker_threads');
const pdfParse = require('pdf-parse');
const AdmZip = require('adm-zip');
(async () => {
  const buffer = Buffer.from(workerData.content, 'base64');
  let text = '';
  if (workerData.extension === 'pdf') {
    if (buffer.subarray(0,5).toString() !== '%PDF-') throw Object.assign(new Error('Invalid PDF'), {status:400});
    const doc = await pdfParse(buffer, {max:100});
    if (doc.numpages > 100) throw Object.assign(new Error('Maximum 100 pages'), {status:413});
    text = doc.text || '';
  } else if (workerData.extension === 'docx') {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    if (entries.length>2000 || entries.reduce((n,e)=>n+e.header.size,0)>32*1024*1024) throw Object.assign(new Error('Expanded file too large'),{status:413});
    if (!zip.getEntry('word/document.xml')) throw Object.assign(new Error('Invalid DOCX'),{status:400});
    text=zip.readAsText('word/document.xml').replace(/<w:p\b[^>]*>/gi,'\n').replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi,'$1').replace(/<[^>]+>/g,'')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
  } else text=buffer.toString('utf8');
  if (Buffer.byteLength(text)>750000) throw Object.assign(new Error('Extracted text too large'),{status:413});
  if (!text.trim()) throw Object.assign(new Error('No text. Scanned documents require OCR.'),{status:422});
  parentPort.postMessage({text});
})().catch(e=>parentPort.postMessage({error:e.status?e.message:'File could not be parsed',status:e.status||422}));
