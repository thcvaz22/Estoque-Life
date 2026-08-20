/* ============================================================
   SERVER/OCR/MATCHPRODUCTS.JS
   Cruza itens lidos por OCR com o catálogo cadastrado.
   Prioridade: EAN/código > atributos Life (sabor+tamanho+embalagem)
   > descrição exata > descrição aproximada.
   NUNCA cria produto automaticamente.
   ============================================================ */

function normalizeText(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^\w\s,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(s) {
  return new Set(normalizeText(s).replace(/[,.]/g, ' ').split(' ').filter(t => t.length > 1));
}

function similarity(a, b) {
  const ta = tokenSet(a), tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersect = 0;
  for (const t of ta) if (tb.has(t)) intersect++;
  const union = new Set([...ta, ...tb]).size;
  return intersect / union;
}

function normalizeVolumeFromText(text) {
  const n = normalizeText(text).replace(',', '.');
  let m = n.match(/\b(300|900)\s*ML\b/);
  if (m) return `${m[1]}ml`;
  m = n.match(/\b([1235](?:\.5)?)\s*L(?:ITRO|ITROS)?\b/);
  if (m) return `${m[1]}l`;
  /* OCR pode remover a letra L em "GALAO 1,5". */
  m = n.match(/\bGALAO\s+(1\.5|2\.5|3\.5|5)\b/);
  if (m) return `${m[1]}l`;
  return null;
}

function normalizeCatalogVolume(volume) {
  return String(volume || '').toLowerCase().replace(/\s/g, '').replace(',', '.');
}

function extractFlavor(text) {
  const n = normalizeText(text);
  if (/MARACUJA/.test(n)) return 'MARACUJA';
  if (/TANGERINA/.test(n)) return 'TANGERINA';
  if (/GOIABA/.test(n)) return 'GOIABA';
  if (/\bCAJU\b/.test(n)) return 'CAJU';
  if (/\bUVA\b/.test(n)) return 'UVA';
  if (/LIMONADA|\bLIMAO\b/.test(n)) return 'LIMAO';
  if (/LARANJA/.test(n)) return 'LARANJA';
  return null;
}

function extractPackaging(text) {
  const n = normalizeText(text);
  if (/\bGARRAFA\b/.test(n)) return 'GARRAFA';
  if (/\bGALAO\b/.test(n)) return 'GALAO';
  if (/\bBAG\b/.test(n)) return 'BAG';
  return null;
}

function normalizeFlavor(s) {
  const n = normalizeText(s);
  if (/LIMAO/.test(n)) return 'LIMAO';
  return extractFlavor(n);
}

function normalizePackaging(s) {
  const n = normalizeText(s);
  if (/GARRAFA/.test(n)) return 'GARRAFA';
  if (/GALAO/.test(n)) return 'GALAO';
  if (/BAG/.test(n)) return 'BAG';
  return null;
}

function matchLifeAttributes(item, products) {
  const text = item.descricao || '';
  const volume = normalizeVolumeFromText(text);
  const sabor = extractFlavor(text);
  const embalagem = extractPackaging(text);
  if (!volume || !sabor) return null;

  const candidates = products.filter(p => {
    const sameVol = normalizeCatalogVolume(p.volume) === volume;
    const sameFlavor = normalizeFlavor(p.sabor || p.nome) === sabor;
    const samePack = !embalagem || normalizePackaging(p.embalagem) === embalagem;
    return sameVol && sameFlavor && samePack;
  });

  if (candidates.length === 1) {
    const p = candidates[0];
    return { produtoId: p.id, produtoNome: p.nome, confianca: embalagem ? 0.98 : 0.95, metodo: 'atributos_life' };
  }
  return null;
}

function matchOneItem(item, products) {
  if (item.ean) {
    const byEan = products.find(p => p.codigoBarras && p.codigoBarras === item.ean);
    if (byEan) return { produtoId: byEan.id, produtoNome: byEan.nome, confianca: 0.99, metodo: 'ean' };
  }
  if (item.codigoProduto) {
    const byCode = products.find(p => (p.codigoInterno && String(p.codigoInterno) === String(item.codigoProduto)) || (p.codigoBarras && p.codigoBarras === item.codigoProduto));
    if (byCode) return { produtoId: byCode.id, produtoNome: byCode.nome, confianca: 0.95, metodo: 'codigo' };
  }
  if (!item.descricao) return { produtoId: null, produtoNome: null, confianca: 0, metodo: 'nenhum' };

  const lifeMatch = matchLifeAttributes(item, products);
  if (lifeMatch) return lifeMatch;

  const normDesc = normalizeText(item.descricao);
  const exact = products.find(p => normalizeText(`${p.nome} ${p.embalagem || ''} ${p.volume || ''}`) === normDesc || normalizeText(p.nome) === normDesc);
  if (exact) return { produtoId: exact.id, produtoNome: exact.nome, confianca: 0.97, metodo: 'descricao_exata' };

  let best = null, bestScore = 0;
  for (const p of products) {
    const score = similarity(item.descricao, `${p.nome} ${p.marca || ''} ${p.sabor || ''} ${p.embalagem || ''} ${p.volume || ''}`);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (best && bestScore >= 0.75) return { produtoId: best.id, produtoNome: best.nome, confianca: bestScore, metodo: 'descricao_aproximada' };
  if (best && bestScore >= 0.4) return { produtoId: null, produtoNome: best.nome, confianca: bestScore, metodo: 'sugestao_baixa_confianca', sugestaoId: best.id };

  return { produtoId: null, produtoNome: null, confianca: 0, metodo: 'nenhum' };
}

function matchProducts(itens, products) {
  const ativos = products.filter(p => p.ativo !== false);
  return itens.map(item => ({ ...item, ...matchOneItem(item, ativos) }));
}

function confidenceLevel(confianca) {
  if (confianca >= 0.85) return 'alta';
  if (confianca >= 0.4) return 'media';
  return 'baixa';
}

module.exports = {
  matchProducts, matchOneItem, similarity, confidenceLevel,
  normalizeVolumeFromText, extractFlavor, extractPackaging
};
