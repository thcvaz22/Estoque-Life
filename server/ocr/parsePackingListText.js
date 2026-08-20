/* ============================================================
   SERVER/OCR/PARSEPACKINGLISTTEXT.JS
   Parser heurístico de romaneio de separação/entrega.

   Suporta também o modelo de romaneio usado pela Life Sucos:
   LOJA | Nº NF PAG | VALOR
   <cliente> <numero NF> DEP <valor>
   <descrição do produto> <quantidade>

   O campo VALOR é propositalmente ignorado. O objetivo é montar
   uma PRÉVIA editável com entregador, NF, cliente, produto e qtd.
   Nunca movimenta estoque e nunca inventa dados ausentes.
   ============================================================ */

const { extractData, extractUnidade } = require('./parseInvoiceText');

function cleanValue(v) {
  return String(v || '').replace(/^[\s:;\-–|.]+/, '').replace(/[\s|]+$/, '').trim();
}

function extractLabel(text, labels, max = 80) {
  const joined = labels.join('|');
  const re = new RegExp(`(?:${joined})\\s*[:#\\-]?\\s*([^\\n\\r]{1,${max}})`, 'i');
  const m = String(text || '').match(re);
  return m ? cleanValue(m[1]) : null;
}

function extractRomaneioNumero(text) {
  const m = String(text || '').match(/\b(?:ROMANEIO|ROM\.?|MAPA\s+DE\s+SEPARA(?:C|Ç)[AÃ]O)\s*(?:N[º°O.]*)?\s*[:#\-]?\s*([A-Z0-9.\/-]{2,20})/i);
  return m ? cleanValue(m[1]) : null;
}

function extractPlaca(text) {
  const labeled = String(text || '').match(/PLACA\s*[:#\-]?\s*([A-Z]{3}[0-9][A-Z0-9][0-9]{2}|[A-Z]{3}-?\d{4})/i);
  if (labeled) return labeled[1].toUpperCase().replace(/\s/g, '');
  const any = String(text || '').match(/\b([A-Z]{3}[0-9][A-Z0-9][0-9]{2}|[A-Z]{3}-?\d{4})\b/i);
  return any ? any[1].toUpperCase() : null;
}

function looksLikeTableHeading(line) {
  return /^(?:LOJA|N[º°O.]?\s*NF|NF\s*PAG|PAG(?:AMENTO)?|VALOR|KM\s+INICIAL|KM\s+FINAL)\b/i.test(cleanValue(line));
}

/* Cabeçalho padrão antigo: NF 10255 - CLIENTE */
function isNfHeader(line) {
  return String(line || '').match(/\b(?:NF(?:-?E)?|NOTA\s+FISCAL)\s*(?:N[º°O.]*)?\s*[:#\-]?\s*(\d{2,9})\b(?:\s*[-–|:]\s*(.+))?/i);
}

/* Modelo Life: "CONDOR JK 519151 DEP 700,80".
   O valor é reconhecido apenas para localizar as colunas e é descartado. */
function parseLifeNfHeader(line) {
  const raw = cleanValue(line);
  if (!raw || looksLikeTableHeading(raw)) return null;

  const m = raw.match(/^(.*?)\s+(\d{5,9})\s+(?:DEP|DIN|PIX|BOL|BOLETO|PAG|PG|CRED|CART(?:AO)?|CHEQ(?:UE)?)\b(?:\s+[R$\s]*\d{1,3}(?:\.\d{3})*(?:,\d{2})|\s+[R$\s]*\d+(?:,\d{2}))?\s*$/i);
  if (!m) return null;

  return {
    cliente: cleanValue(m[1]) || null,
    numero: m[2].replace(/^0+(?=\d)/, '')
  };
}

function parseProductLine(line) {
  const raw = cleanValue(line);
  if (!raw || raw.length < 4) return null;
  if (looksLikeTableHeading(raw)) return null;
  if (/\b(TOTAL|SUBTOTAL|PESO|VOLUME|CLIENTE|MOTORISTA|ENTREGADOR|VE[IÍ]CULO|PLACA|ROMANEIO|NOTA\s+FISCAL)\b/i.test(raw)) return null;
  if (parseLifeNfHeader(raw) || isNfHeader(raw)) return null;

  const eanMatch = raw.match(/\b(\d{8}|\d{12,14})\b/);
  const unitQty = raw.match(/\b(UN|UND|UNID|UNIDADE|PC|CX|CAIXA|FD|FARDO|PAL|PALETE|PALLET|PL)\b\s*[:\-]?\s*(\d+(?:[.,]\d+)?)/i);
  const qtyUnit = raw.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*\b(UN|UND|UNID|UNIDADE|PC|CX|CAIXA|FD|FARDO|PAL|PALETE|PALLET|PL)\b/i);
  const explicit = unitQty || qtyUnit;

  let unidadeToken = null;
  let quantidade = null;
  let matchedText = null;

  if (explicit) {
    if (unitQty) { unidadeToken = explicit[1]; quantidade = explicit[2]; }
    else { quantidade = explicit[1]; unidadeToken = explicit[2]; }
    matchedText = explicit[0];
  } else {
    /* Modelo Life: descrição seguida apenas pela quantidade em UNIDADES.
       Ex.: "GALAO 1,5 SUCO DE LARANJA 48" */
    const trailingQty = raw.match(/^(.*?\D)\s+(\d{1,6})\s*$/);
    if (!trailingQty) return null;
    const candidateDesc = cleanValue(trailingQty[1]);
    if (!/[A-ZÀ-Ú]{2,}/i.test(candidateDesc)) return null;
    if (!/\b(SUCO|NECTAR|N[EÉ]CTAR|LIMONADA|GARRAFA|GAL[AÃ]O|BAG|LARANJA|UVA|MARACUJA|MARACUJ[AÁ]|GOIABA|CAJU|TANGERINA|LIM[AÃ]O)\b/i.test(candidateDesc)) return null;
    quantidade = trailingQty[2];
    unidadeToken = 'UN';
    matchedText = trailingQty[2];
  }

  quantidade = Number(String(quantidade).replace(',', '.'));
  if (!Number.isFinite(quantidade) || quantidade <= 0 || quantidade > 100000) return null;

  let descricao = raw;
  if (eanMatch) descricao = descricao.replace(eanMatch[0], ' ');
  if (explicit) descricao = descricao.replace(matchedText, ' ');
  else descricao = descricao.replace(new RegExp(`\\s+${quantidade}\\s*$`), ' ');
  if (!eanMatch) descricao = descricao.replace(/^\s*(?=[A-Z0-9.\/-]*\d)[A-Z0-9.\/-]{1,12}\s+/, '');
  descricao = descricao.replace(/^[.·•\-–]+\s*/, '').replace(/\s{2,}/g, ' ').trim();
  if (descricao.length < 3) return null;

  return {
    descricao,
    ean: eanMatch ? eanMatch[0] : null,
    quantidade,
    unidade: extractUnidade(unidadeToken) || 'Unidade',
    unidadeTextoOriginal: unidadeToken,
    linhaOriginal: raw
  };
}

function isLikelyClientContinuation(line) {
  const raw = cleanValue(line);
  if (!raw || raw.length < 3 || looksLikeTableHeading(raw)) return false;
  if (/^(?:ENTREGADOR|MOTORISTA|PLACA|KM\s+INICIAL|KM\s+FINAL)\b/i.test(raw)) return false;
  if (parseLifeNfHeader(raw) || isNfHeader(raw) || parseProductLine(raw)) return false;
  /* Nomes de loja/filial costumam ser texto em caixa alta sem quantidade. */
  return /[A-ZÀ-Ú]{3,}/i.test(raw) && !/\d{3,}/.test(raw);
}

function parsePackingListText(rawText) {
  const text = String(rawText || '');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const header = {
    romaneioNumero: extractRomaneioNumero(text),
    data: extractData(text),
    /* Life usa ENTREGADOR; modelos antigos podem usar MOTORISTA/CONDUTOR. */
    motorista: (() => { const v = extractLabel(text, ['ENTREGADOR', 'MOTORISTA', 'CONDUTOR']); return v ? v.replace(/\s+(?:PLACA|KM\s+INICIAL|KM\s+FINAL)\s*[:#\-]?.*$/i, '').trim() : null; })(),
    veiculo: extractLabel(text, ['VE[IÍ]CULO', 'CAMINH[AÃ]O']),
    placa: extractPlaca(text)
  };

  const nfs = [];
  let current = null;
  let globalCliente = extractLabel(text, ['CLIENTE', 'DESTINAT[AÁ]RIO']);
  let pendingClientText = [];

  for (const line of lines) {
    if (looksLikeTableHeading(line)) continue;
    if (/^(?:ENTREGADOR|MOTORISTA|CONDUTOR|PLACA|KM\s+INICIAL|KM\s+FINAL)\b/i.test(line)) continue;

    const lifeHeader = parseLifeNfHeader(line);
    if (lifeHeader) {
      const prefix = [...pendingClientText, lifeHeader.cliente].filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
      pendingClientText = [];
      current = { numero: lifeHeader.numero, cliente: prefix || null, itens: [] };
      nfs.push(current);
      continue;
    }

    const nfMatch = isNfHeader(line);
    if (nfMatch) {
      current = { numero: nfMatch[1].replace(/^0+(?=\d)/, ''), cliente: null, itens: [] };
      const tail = cleanValue(nfMatch[2] || '');
      if (tail && !/^\d+$/.test(tail)) current.cliente = tail.replace(/^CLIENTE\s*[:\-]?\s*/i, '').trim();
      nfs.push(current);
      pendingClientText = [];
      continue;
    }

    const clientMatch = line.match(/^(?:CLIENTE|DESTINAT[AÁ]RIO)\s*[:\-]\s*(.+)$/i);
    if (clientMatch) {
      if (current) current.cliente = cleanValue(clientMatch[1]);
      else globalCliente = cleanValue(clientMatch[1]);
      continue;
    }

    const item = parseProductLine(line);
    if (item) {
      pendingClientText = [];
      if (!current) {
        current = { numero: '', cliente: globalCliente || null, itens: [] };
        nfs.push(current);
      }
      current.itens.push(item);
      continue;
    }

    /* Em alguns OCRs o nome da loja quebra em duas linhas. Se a linha vier
       logo após um cabeçalho de NF e antes do primeiro produto, anexamos ao
       cliente atual; caso apareça antes do cabeçalho, guardamos como prefixo. */
    if (isLikelyClientContinuation(line)) {
      if (current && current.itens.length === 0 && current.cliente) {
        current.cliente = `${current.cliente} ${cleanValue(line)}`.replace(/\s{2,}/g, ' ').trim();
      } else if (!current || (current && current.itens.length > 0)) {
        pendingClientText.push(cleanValue(line));
      }
    }
  }

  const filtered = nfs.filter(n => n.numero || n.itens.length > 0).map(n => ({
    ...n,
    cliente: n.cliente || globalCliente || null
  }));

  return { ...header, cliente: globalCliente || null, nfs: filtered };
}

module.exports = {
  parsePackingListText,
  parseProductLine,
  extractRomaneioNumero,
  extractPlaca,
  parseLifeNfHeader
};
