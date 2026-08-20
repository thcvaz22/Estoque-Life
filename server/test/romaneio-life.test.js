const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePackingListText } = require('../ocr/parsePackingListText');
const { matchProducts } = require('../ocr/matchProducts');
const { makeCatalog } = require('../catalog');

const text = `
ENTREGADOR: CHILLI        PLACA:
KM INICIAL:               KM FINAL:
LOJA                         Nº NF PAG        VALOR
RISOTOLANDIA INDUSTRIA E 518458 DEP 8.900,00
COMERCIO DE ALIMENTOS LTD
SUCO DE LARANJA INTEGRAL 1L 1000
CONDOR JK 519151 DEP 700,80
GALAO 1,5 SUCO DE LARANJA 48
CONDOR CAMPO COMPRIDO - 519138 DEP 655,20
JOAO DEMBINSKI
GARRAFA DE 900 ML - SUCO DE LARANJA 12
GALAO 1,5 SUCO DE LARANJA 24
GARRAFA DE 300 ML - NECTAR DE UVA 24
GARRAFA DE 300 ML - MARACUJA 24
CONDOR PILARZINHO 519594 DEP 1.500,00
GARRAFA DE 300 ML - SUCO DE LARANJA 24
GALAO 1,5 SUCO DE LARANJA 96
`;

test('romaneio Life identifica entregador e agrupa produtos por NF ignorando valores', () => {
  const r = parsePackingListText(text);
  assert.equal(r.motorista, 'CHILLI');
  assert.equal(r.nfs.length, 4);
  assert.equal(r.nfs[0].numero, '518458');
  assert.match(r.nfs[0].cliente, /RISOTOLANDIA INDUSTRIA E COMERCIO DE ALIMENTOS LTD/);
  assert.equal(r.nfs[0].itens[0].quantidade, 1000);
  assert.equal(r.nfs[1].numero, '519151');
  assert.equal(r.nfs[1].itens[0].quantidade, 48);
  assert.equal(r.nfs[2].numero, '519138');
  assert.match(r.nfs[2].cliente, /CONDOR CAMPO COMPRIDO.*JOAO DEMBINSKI/);
  assert.equal(r.nfs[2].itens.length, 4);
  assert.equal(r.nfs[3].numero, '519594');
  assert.equal(r.nfs[3].itens.length, 2);
});

test('romaneio Life reconhece produtos do catálogo por sabor, tamanho e embalagem', () => {
  const r = parsePackingListText(text);
  const products = makeCatalog();
  const jk = matchProducts(r.nfs[1].itens, products);
  assert.equal(jk[0].produtoId, 'life_920'); // Galão 1,5 L laranja

  const cc = matchProducts(r.nfs[2].itens, products);
  assert.equal(cc[0].produtoId, 'life_700'); // Garrafa 900 ml laranja
  assert.equal(cc[1].produtoId, 'life_920'); // Galão 1,5 L laranja
  assert.equal(cc[2].produtoId, 'life_101'); // 300 ml uva
  assert.equal(cc[3].produtoId, 'life_102'); // 300 ml maracujá

  const pilar = matchProducts(r.nfs[3].itens, products);
  assert.equal(pilar[0].produtoId, 'life_100');
  assert.equal(pilar[1].produtoId, 'life_920');
});

test('produto 1L inexistente no catálogo não é convertido silenciosamente para 900ml', () => {
  const r = parsePackingListText(text);
  const matched = matchProducts(r.nfs[0].itens, makeCatalog());
  assert.equal(matched[0].produtoId, null);
});
