/* ============================================================
   SERVER/OCRROUTES.JS — OCR local para NF de entrada e romaneio
   Regra: IMAGEM → OCR → PRÉVIA → CONFERÊNCIA HUMANA.
   Estas rotas NUNCA movimentam estoque; só leem, cruzam produtos
   e guardam a imagem original para consulta/auditoria.
   ============================================================ */

const express = require('express');
const { Data } = require('./db');
const { parseInvoiceText } = require('./ocr/parseInvoiceText');
const { parsePackingListText } = require('./ocr/parsePackingListText');
const { matchProducts, confidenceLevel } = require('./ocr/matchProducts');
const photoStore = require('./ocr/photoStore');

const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function createOcrRouter({ recognizeText } = {}) {
  const router = express.Router();
  const ocrEngine = recognizeText || require('./ocr/runOcr').recognizeText;

  async function processImages(imagens) {
    if (!Array.isArray(imagens) || imagens.length === 0) {
      const err = new Error('Envie ao menos uma imagem.'); err.status = 400; throw err;
    }
    if (imagens.length > MAX_IMAGES) {
      const err = new Error(`Máximo de ${MAX_IMAGES} imagens por documento.`); err.status = 400; throw err;
    }
    const fotos = [];
    const textos = [];
    const confiancas = [];
    for (const img of imagens) {
      if (!img || !img.base64) { const err = new Error('Imagem inválida recebida.'); err.status = 400; throw err; }
      const buffer = Buffer.from(img.base64, 'base64');
      if (buffer.length === 0) { const err = new Error('Uma das imagens está vazia.'); err.status = 400; throw err; }
      if (buffer.length > MAX_IMAGE_BYTES) { const err = new Error('Uma das imagens é maior que 15MB.'); err.status = 400; throw err; }
      const saved = photoStore.savePhoto(buffer, img.mimeType);
      fotos.push(saved);
      let ocrResult;
      try { ocrResult = await ocrEngine(buffer); }
      catch (e) { const err = new Error('Não foi possível processar a imagem com o leitor de texto (OCR): ' + e.message); err.status = 503; err.fotos = fotos; throw err; }
      textos.push(ocrResult.text || '');
      if (typeof ocrResult.confidence === 'number') confiancas.push(ocrResult.confidence);
    }
    const confidence = confiancas.length ? confiancas.reduce((a, b) => a + b, 0) / confiancas.length : null;
    return { fotos, texto: textos.join('\n\n'), confidence };
  }

  router.post('/analyze', async (req, res) => {
    try {
      const processed = await processImages((req.body || {}).imagens);
      const parsed = parseInvoiceText(processed.texto);
      const products = Data.all('products');
      const itensComMatch = matchProducts(parsed.itens, products);

      let duplicado = null;
      if (parsed.chaveNFe) {
        const existente = Data.all('entries').find(e => e.chaveNFe === parsed.chaveNFe);
        if (existente) duplicado = { nf: existente.nf, data: existente.data, fornecedor: existente.fornecedor };
      }

      res.json({
        fotos: processed.fotos.map(f => ({ id: f.id, mimeType: f.mimeType })),
        paginasAnalisadas: (req.body.imagens || []).length,
        confiancaDocumento: processed.confidence,
        fornecedor: parsed.fornecedor,
        cnpjFornecedor: parsed.cnpjFornecedor,
        nf: parsed.nf,
        serie: parsed.serie,
        chaveNFe: parsed.chaveNFe,
        dataEmissao: parsed.dataEmissao,
        duplicado,
        itens: itensComMatch.map(it => ({
          descricao: it.descricao,
          ean: it.ean,
          quantidade: it.quantidade,
          unidade: it.unidade,
          unidadeTextoOriginal: it.unidadeTextoOriginal,
          unidadeNaoIdentificada: !it.unidade,
          lote: it.lote,
          validade: it.validade,
          produtoId: it.produtoId,
          produtoNome: it.produtoNome,
          confianca: Math.round((it.confianca || 0) * 100) / 100,
          nivelConfianca: confidenceLevel(it.confianca || 0),
          sugestaoId: it.sugestaoId || null
        }))
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: 'Falha ao analisar a nota fiscal: ' + err.message, fotos: (err.fotos || []).map(f => ({ id: f.id, mimeType: f.mimeType })) });
    }
  });

  router.post('/analyze-romaneio', async (req, res) => {
    try {
      const processed = await processImages((req.body || {}).imagens);
      const parsed = parsePackingListText(processed.texto);
      const products = Data.all('products');
      const nfs = parsed.nfs.map(nf => ({
        numero: nf.numero,
        cliente: nf.cliente,
        itens: matchProducts(nf.itens, products).map(it => ({
          descricao: it.descricao,
          ean: it.ean,
          quantidade: it.quantidade,
          unidade: it.unidade,
          produtoId: it.produtoId,
          produtoNome: it.produtoNome,
          confianca: Math.round((it.confianca || 0) * 100) / 100,
          nivelConfianca: confidenceLevel(it.confianca || 0),
          sugestaoId: it.sugestaoId || null
        }))
      }));
      res.json({
        fotos: processed.fotos.map(f => ({ id: f.id, mimeType: f.mimeType })),
        paginasAnalisadas: (req.body.imagens || []).length,
        confiancaDocumento: processed.confidence,
        romaneioNumero: parsed.romaneioNumero,
        data: parsed.data,
        motorista: parsed.motorista,
        veiculo: parsed.veiculo,
        placa: parsed.placa,
        cliente: parsed.cliente,
        nfs
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: 'Falha ao analisar o romaneio: ' + err.message, fotos: (err.fotos || []).map(f => ({ id: f.id, mimeType: f.mimeType })) });
    }
  });

  router.post('/photo', (req, res) => {
    const { base64, mimeType } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'Imagem maior que 15MB.' });
    const saved = photoStore.savePhoto(buffer, mimeType);
    res.json({ id: saved.id, mimeType: saved.mimeType });
  });

  router.get('/photo/:id', (req, res) => {
    const buffer = photoStore.readPhoto(req.params.id);
    if (!buffer) return res.status(404).json({ error: 'Foto não encontrada.' });
    const ext = (req.params.id.split('.').pop() || 'jpg').toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' }[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(buffer);
  });

  return router;
}

module.exports = { createOcrRouter };
