/* ============================================================
   NFE.JS — leitura de XML de NF-e (modelo padrão SEFAZ)
   v17.2: além dos dados operacionais, preserva dados do emitente,
   totais e referências fiscais úteis para romaneio/devolução.
   ============================================================ */

function _txt(node, tag) {
  if (!node) return '';
  const el = node.getElementsByTagName(tag)[0];
  return el ? el.textContent.trim() : '';
}
function _num(node, tag){ const n=Number(String(_txt(node,tag)||'0').replace(',','.')); return Number.isFinite(n)?n:0; }

async function parseNFeXML(file) {
  const text = await file.text();
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('XML inválido ou corrompido.');

  const infNFe = xml.getElementsByTagName('infNFe')[0];
  if (!infNFe) throw new Error('Este arquivo não parece ser uma NF-e (tag infNFe não encontrada).');

  const idAttr = infNFe.getAttribute('Id') || '';
  const chaveNFe = idAttr.replace(/^NFe/i, '').trim() || null;
  const ide = xml.getElementsByTagName('ide')[0];
  const emit = xml.getElementsByTagName('emit')[0];
  const enderEmit = emit ? emit.getElementsByTagName('enderEmit')[0] : null;
  const total = xml.getElementsByTagName('ICMSTot')[0];

  const nNF = _txt(ide, 'nNF');
  const serie = _txt(ide, 'serie');
  const dhEmi = _txt(ide, 'dhEmi') || _txt(ide, 'dEmi');
  const fornecedor = _txt(emit, 'xNome') || 'Fornecedor não identificado';
  const cnpjFornecedor = _txt(emit, 'CNPJ') || _txt(emit,'CPF');
  const fornecedorDados = {
    razaoSocial: fornecedor,
    nomeFantasia: _txt(emit,'xFant'),
    cnpjCpf: cnpjFornecedor,
    inscricaoEstadual: _txt(emit,'IE'),
    logradouro: _txt(enderEmit,'xLgr'), numero: _txt(enderEmit,'nro'), complemento: _txt(enderEmit,'xCpl'),
    bairro: _txt(enderEmit,'xBairro'), cidade: _txt(enderEmit,'xMun'), uf: _txt(enderEmit,'UF'), cep: _txt(enderEmit,'CEP'),
    codigoMunicipioIBGE: _txt(enderEmit,'cMun'), telefone: _txt(enderEmit,'fone')
  };

  const detNodes = Array.from(xml.getElementsByTagName('det'));
  const itens = detNodes.map(det => {
    const prod = det.getElementsByTagName('prod')[0];
    const imposto = det.getElementsByTagName('imposto')[0];
    const rastro = prod ? prod.getElementsByTagName('rastro')[0] : null;
    const icms = imposto ? imposto.getElementsByTagName('ICMS')[0] : null;
    const pis = imposto ? imposto.getElementsByTagName('PIS')[0] : null;
    const cofins = imposto ? imposto.getElementsByTagName('COFINS')[0] : null;
    const ipi = imposto ? imposto.getElementsByTagName('IPI')[0] : null;
    return {
      codigoBarras: _txt(prod, 'cEAN') !== 'SEM GTIN' && _txt(prod, 'cEAN') ? _txt(prod, 'cEAN') : _txt(prod, 'cProd'),
      codigoProduto: _txt(prod, 'cProd'),
      nome: _txt(prod, 'xProd'),
      quantidade: _num(prod,'qCom'),
      unidade: _txt(prod, 'uCom') || '',
      valorUnitario: _num(prod,'vUnCom'),
      valorTotalItem: _num(prod,'vProd'),
      lote: rastro ? _txt(rastro, 'nLote') : '',
      fabricacao: rastro ? _txt(rastro, 'dFab') : '',
      validade: rastro ? _txt(rastro, 'dVal') : '',
      fiscal: {
        ncm:_txt(prod,'NCM'), cest:_txt(prod,'CEST'), cfop:_txt(prod,'CFOP'), unidadeTributavel:_txt(prod,'uTrib'),
        cstIcms:_txt(icms,'CST'), csosn:_txt(icms,'CSOSN'), origem:_txt(icms,'orig'),
        cstPis:_txt(pis,'CST'), cstCofins:_txt(cofins,'CST'), cstIpi:_txt(ipi,'CST')
      }
    };
  });

  return {
    nf: nNF, serie, chaveNFe,
    dataEmissao: dhEmi ? dhEmi.slice(0, 10) : todayISO(),
    fornecedor, cnpjFornecedor, fornecedorDados,
    valorProdutos:_num(total,'vProd'), valorTotal:_num(total,'vNF'),
    itens
  };
}
