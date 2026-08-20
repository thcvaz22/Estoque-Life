/* Baixa/cacheia o idioma português do Tesseract sob demanda.
   Este script NAO roda automaticamente ao abrir o Life Sucos.
   Pode ser executado manualmente com: npm run ocr:prepare */
const fs = require('fs');
const path = require('path');

(async () => {
  const dataDir = process.env.LIFESUCOS_DATA_DIR || path.join(__dirname, '..', 'data');
  const tessdata = path.join(dataDir, 'tessdata');
  fs.mkdirSync(tessdata, { recursive: true });

  try {
    console.log('[Life Sucos] Baixando/cacheando OCR em português...');
    const { createWorker } = require('tesseract.js');
    // cachePath = destino local. Sem langPath, o Tesseract usa a fonte
    // padrao de idiomas e baixa "por" quando ainda nao estiver no cache.
    const worker = await createWorker('por', 1, { cachePath: tessdata });
    await worker.terminate();
    fs.writeFileSync(path.join(tessdata, '.prepared'), new Date().toISOString(), 'utf8');
    console.log('[Life Sucos] OCR em português pronto.');
  } catch (err) {
    console.error('[Life Sucos] Nao foi possivel preparar o OCR:', err.message);
    process.exitCode = 1;
  }
})();
