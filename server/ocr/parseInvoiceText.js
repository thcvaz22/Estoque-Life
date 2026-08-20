/* ============================================================
   SERVER/OCR/PARSEINVOICETEXT.JS
   Recebe o TEXTO BRUTO já reconhecido pelo OCR (de uma ou mais
   páginas, já concatenado) e tenta extrair os campos estruturados
   de uma NF. É lógica pura (sem imagem, sem IA aqui) — por isso dá
   pra testar de forma determinística com textos de exemplo, sem
   precisar rodar OCR de verdade.
   Nunca "inventa" dado: quando não encontra, devolve null e quem
   usa isso mostra "Não identificado" para o usuário preencher.
   ============================================================ */

const UNIT_ALIASES = {
  UN: 'Unidade', UND: 'Unidade', UNID: 'Unidade', UNIDADE: 'Unidade', PC: 'Unidade', PÇ: 'Unidade',
  CX: 'Fardo', CAIXA: 'Fardo', FD: 'Fardo', FARDO: 'Fardo',
  PAL: 'Palete', PALETE: 'Palete', PL: 'Palete'
};

function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toUpperCase().trim();
}

function extractCNPJ(text) {
  const m = text.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, '');
  if (digits.length !== 14) return null;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function extractChaveAcesso(text) {
  // chave de acesso da NF-e: 44 dígitos, às vezes com espaços entre grupos
  const compact = text.replace(/[^\d\s]/g, ' ');
  const m = compact.match(/(?:\d[\s]?){44}/);
  if (!m) return null;
  const digits = m[0].replace(/\s/g, '');
  return digits.length === 44 ? digits : null;
}

function extractNumeroNF(text) {
  // procura "NF", "Nota Fiscal", "N°", "Nº" seguido de dígitos
  const patterns = [
    /N(?:ota)?\.?\s*F(?:iscal)?\.?\s*N?[ºo°]?\.?\s*[:\-]?\s*(\d{2,9})/i,
    /N[ºo°]\s*[:\-]?\s*(\d{2,9})/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].replace(/^0+(?=\d)/, '');
  }
  return null;
}

function extractSerie(text) {
  const m = text.match(/S[ée]rie\.?\s*[:\-]?\s*(\d{1,3})/i);
  return m ? m[1] : null;
}

function extractData(text) {
  const m = text.match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const date = new Date(iso + 'T00:00:00');
  if (isNaN(date)) return null;
  return iso;
}

function extractAllDates(text) {
  const out = [];
  const re = /(\d{2})[\/\-.](\d{2})[\/\-.](\d{2,4})/g;
  let m;
  while ((m = re.exec(text))) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    out.push(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`);
  }
  return out;
}

function extractFornecedor(text) {
  // heurística simples: primeira linha "grande" antes do CNPJ, ou depois de "Razão Social" / "Emitente"
  const labeled = text.match(/(?:Raz[aã]o Social|Emitente|Fornecedor)\.?\s*[:\-]?\s*([A-ZÀ-Ú][\wÀ-ú&.,\- ]{4,60})/i);
  if (labeled) return labeled[1].trim();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const candidate = lines.find(l => /LTDA|EIRELI|S\/A|S\.A\.|COMERCIO|DISTRIBUIDORA|INDUSTRIA/i.test(l));
  return candidate || null;
}

function extractUnidade(token) {
  const norm = normalize(token).replace(/[^\w]/g, '');
  return UNIT_ALIASES[norm] || null;
}

/* Tenta achar linhas de produto no texto. Formato esperado (varia
   muito na prática — por isso é heurístico e sempre precisa de
   conferência humana): descrição ... quantidade ... unidade
   Exemplo de linha real de NF: "001 7891000100103 SUCO LARANJA 1L UN 50 4,50 225,00" */
function extractItens(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const itens = [];

  for (const line of lines) {
    // precisa ter pelo menos uma sequência de dígitos que pareça quantidade
    // e uma descrição textual razoável — evita capturar cabeçalhos/rodapés
    const eanMatch = line.match(/\b(\d{8}|\d{12,14})\b/);
    const qtyUnitMatch = line.match(/\b(UN|UND|UNID|UNIDADE|PC|CX|CAIXA|FD|FARDO|PAL|PALETE|PL)\b\s*[:\-]?\s*(\d+(?:[.,]\d+)?)/i)
      || line.match(/(\d+(?:[.,]\d+)?)\s*\b(UN|UND|UNID|UNIDADE|PC|CX|CAIXA|FD|FARDO|PAL|PALETE|PL)\b/i);
    if (!qtyUnitMatch) continue;

    let quantidade, unidadeToken;
    if (/^\d/.test(qtyUnitMatch[1])) { quantidade = qtyUnitMatch[1]; unidadeToken = qtyUnitMatch[2]; }
    else { unidadeToken = qtyUnitMatch[1]; quantidade = qtyUnitMatch[2]; }
    quantidade = parseFloat(quantidade.replace(',', '.'));
    if (!quantidade || quantidade <= 0 || quantidade > 100000) continue;

    // descrição = o que sobra da linha tirando código/EAN/quantidade/unidade/valores
    let descricao = line
      .replace(eanMatch ? eanMatch[0] : '', '')
      .replace(qtyUnitMatch[0], '')
      .replace(/\b\d{1,4}\b/g, '') // remove códigos curtos soltos
      .replace(/[\d.,]+/g, m => m.length > 3 ? '' : m) // limpa valores residuais
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (descricao.length < 3) continue;

    itens.push({
      descricao,
      ean: eanMatch ? eanMatch[0] : null,
      quantidade,
      unidade: extractUnidade(unidadeToken),
      unidadeTextoOriginal: unidadeToken,
      lote: null,
      validade: null,
      linhaOriginal: line
    });
  }
  return itens;
}

/* Tenta associar lote/validade a itens já extraídos, procurando
   padrões próximos como "LOTE 123" / "VAL 20/09/2026" no texto inteiro
   — como isso é impreciso por natureza, só preenche quando o padrão é
   claro; o resto fica null (o usuário confirma na tela de conferência). */
function attachLotesEValidades(text, itens) {
  const loteMatches = [...text.matchAll(/LOTE\.?\s*[:\-]?\s*([A-Z0-9\-]{2,15})/gi)];
  const validadeMatches = [...text.matchAll(/VAL(?:IDADE)?\.?\s*[:\-]?\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{2,4})/gi)];

  itens.forEach((item, idx) => {
    if (loteMatches[idx]) item.lote = loteMatches[idx][1];
    if (validadeMatches[idx]) {
      const [, d, mo, y] = validadeMatches[idx][1].match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{2,4})/) || [];
      if (d) {
        const year = y.length === 2 ? '20' + y : y;
        item.validade = `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
    }
  });
  return itens;
}

function parseInvoiceText(rawText) {
  const text = String(rawText || '');
  const itens = attachLotesEValidades(text, extractItens(text));

  return {
    fornecedor: extractFornecedor(text),
    cnpjFornecedor: extractCNPJ(text),
    nf: extractNumeroNF(text),
    serie: extractSerie(text),
    chaveNFe: extractChaveAcesso(text),
    dataEmissao: extractData(text),
    todasAsDatas: extractAllDates(text),
    itens
  };
}

module.exports = { parseInvoiceText, extractCNPJ, extractChaveAcesso, extractNumeroNF, extractSerie, extractData, extractFornecedor, extractUnidade, UNIT_ALIASES };
