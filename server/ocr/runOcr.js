/* ============================================================
   SERVER/OCR/RUNOCR.JS — OCR local (Tesseract.js)

   O Life Sucos NAO baixa OCR durante a inicializacao do sistema.
   O idioma portugues e solicitado apenas quando uma foto de NF ou
   romaneio for analisada pela primeira vez. Depois fica em cache
   local em data/tessdata e pode ser reutilizado sem novo download.
   ============================================================ */

const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.LIFESUCOS_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const TESSDATA_DIR = path.join(DATA_DIR, 'tessdata');

async function recognizeText(imageBuffer) {
  fs.mkdirSync(TESSDATA_DIR, { recursive: true });

  const { createWorker } = require('tesseract.js');
  let worker;
  try {
    // IMPORTANTE: nao informar langPath apontando para uma pasta vazia.
    // langPath e a ORIGEM dos arquivos de idioma; cachePath e o destino
    // local. Ao omitir langPath, Tesseract.js baixa o idioma padrao e o
    // guarda no cache na primeira utilizacao.
    worker = await createWorker('por', 1, { cachePath: TESSDATA_DIR });
    const { data } = await worker.recognize(imageBuffer);
    try {
      fs.writeFileSync(path.join(TESSDATA_DIR, '.prepared'), new Date().toISOString(), 'utf8');
    } catch (_) {}
    return {
      text: data.text || '',
      confidence: typeof data.confidence === 'number' ? data.confidence / 100 : null,
      words: (data.words || []).map(w => ({ text: w.text, confidence: w.confidence / 100 }))
    };
  } catch (err) {
    const friendly = new Error(
      'O leitor de imagens ainda não conseguiu carregar o idioma português. ' +
      'Na primeira utilização, mantenha o computador conectado à internet e tente novamente. ' +
      `Detalhe: ${err.message}`
    );
    friendly.cause = err;
    throw friendly;
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch (_) {}
    }
  }
}

module.exports = { recognizeText };
