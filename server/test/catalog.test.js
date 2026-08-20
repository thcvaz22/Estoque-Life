const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCatalog, toBaseUnits } = require('../catalog');

test('catálogo Life possui 35 produtos e códigos esperados', () => {
  const cat = makeCatalog('2026-08-14T00:00:00.000Z');
  assert.equal(cat.length, 35);
  assert.equal(cat.find(p => p.codigoInterno === '100').nome, 'Suco de Laranja 300 ml');
  assert.equal(cat.find(p => p.codigoInterno === '307').embalagem, 'Bag');
});

test('conversões 300ml', () => {
  const p = makeCatalog().find(p => p.codigoInterno === '100');
  assert.equal(toBaseUnits(p, 1, 'Fardo'), 24);
  assert.equal(toBaseUnits(p, 1, 'Pallet'), 3360);
  assert.equal(toBaseUnits(p, 1, 'Meio Pallet'), 1680);
});

test('conversões 900ml e 3,5L', () => {
  const cat = makeCatalog();
  const p900 = cat.find(p => p.codigoInterno === '700');
  const p35 = cat.find(p => p.codigoInterno === '420');
  assert.equal(toBaseUnits(p900, 1, 'Pallet'), 1008);
  assert.equal(toBaseUnits(p35, 1, 'Pallet'), 192);
});

test('Bag usa caixa com 7 unidades e pallet com 25 caixas', () => {
  const p = makeCatalog().find(p => p.codigoInterno === '300');
  assert.equal(p.nomeFardo, 'Caixa');
  assert.equal(toBaseUnits(p, 1, 'Caixa'), 7);
  assert.equal(toBaseUnits(p, 1, 'Pallet'), 175);
  assert.equal(toBaseUnits(p, 1, 'Meio Pallet'), 87.5);
});
