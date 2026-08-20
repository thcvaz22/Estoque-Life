/* ============================================================
   NFE.JS — leitura de XML de NF-e (modelo padrão SEFAZ) para
   pré-preencher uma entrada automaticamente.
   Cobre os campos mais comuns: emitente, número da nota,
   itens (código, descrição, quantidade) e rastro (lote,
   fabricação, validade) quando presente no XML.
   Notas fora do padrão continuam editáveis manualmente depois.
   ============================================================ */

function _txt(node, tag) {
  if (!node) return '';
  const el = node.getElementsByTagName(tag)[0];
  return el ? el.textContent.trim() : '';
}

async function parseNFeXML(file) {
  const text = await file.text();
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) {
    throw new Error('XML inválido ou corrompido.');
  }

  const infNFe = xml.getElementsByTagName('infNFe')[0];
  if (!infNFe) throw new Error('Este arquivo não parece ser uma NF-e (tag infNFe não encontrada).');

  const idAttr = infNFe.getAttribute('Id') || '';
  const chaveNFe = idAttr.replace(/^NFe/i, '').trim() || null;

  const ide = xml.getElementsByTagName('ide')[0];
  const emit = xml.getElementsByTagName('emit')[0];

  const nNF = _txt(ide, 'nNF');
  const serie = _txt(ide, 'serie');
  const dhEmi = _txt(ide, 'dhEmi') || _txt(ide, 'dEmi');
  const fornecedor = _txt(emit, 'xNome') || 'Fornecedor não identificado';
  const cnpjFornecedor = _txt(emit, 'CNPJ');

  const detNodes = Array.from(xml.getElementsByTagName('det'));
  const itens = detNodes.map(det => {
    const prod = det.getElementsByTagName('prod')[0];
    const rastro = prod ? prod.getElementsByTagName('rastro')[0] : null;
    return {
      codigoBarras: _txt(prod, 'cEAN') !== 'SEM GTIN' && _txt(prod, 'cEAN') ? _txt(prod, 'cEAN') : _txt(prod, 'cProd'),
      codigoProduto: _txt(prod, 'cProd'),
      nome: _txt(prod, 'xProd'),
      quantidade: parseFloat(_txt(prod, 'qCom') || '0') || 0,
      unidade: _txt(prod, 'uCom') || '',
      valorUnitario: parseFloat(_txt(prod, 'vUnCom') || '0') || 0,
      lote: rastro ? _txt(rastro, 'nLote') : '',
      fabricacao: rastro ? _txt(rastro, 'dFab') : '',
      validade: rastro ? _txt(rastro, 'dVal') : ''
    };
  });

  return {
    nf: nNF,
    serie,
    chaveNFe,
    dataEmissao: dhEmi ? dhEmi.slice(0, 10) : todayISO(),
    fornecedor,
    cnpjFornecedor,
    itens
  };
}
