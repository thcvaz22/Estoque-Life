const test=require('node:test');
const assert=require('node:assert/strict');
const { searchAll }=require('../globalSearch');

const fixture={
  products:[{id:'p1',codigoInterno:'100',nome:'Laranja 300 ml',marca:'Life',codigoBarras:'7891234567890',ativo:true}],
  customers:[{id:'c1',nome:'Mercado Avenida',cnpj:'12.345.678/0001-90',cidade:'Curitiba',bairro:'Centro',ativo:true}],
  orders:[{id:'o1',numero:'PED000321',nfNumero:'45879',clienteNome:'Mercado Avenida',vendedorNome:'Carlos',status:'aprovado'}],
  invoices:[{id:'n1',numero:'45879',chaveAcesso:'41260812345678000190550010000458791234567890',clienteNome:'Mercado Avenida',pedidoNumero:'PED000321',status:'autorizada'}],
  entries:[{id:'e1',nf:'9001',fornecedor:'Fábrica Life'}],
  exits:[{id:'s1',cliente:'Mercado Avenida',motorista:'João',nfs:[{numero:'45879'}]}],
  backlog:[{id:'b1',nf:'777',cliente:'Mercado Sul',produtoNome:'Uva 900 ml',status:'bloqueado'}],
  suppliers:[{id:'f1',nome:'Fábrica Life',cnpj:'98.765.432/0001-10',ativo:true}],
  lots:[{id:'l1',productId:'p1',lote:'L20260819',localizacao:'A-01',validade:'2026-09-20'}]
};

test('busca pedido apenas pelo número',()=>{
  const r=searchAll(fixture,'000321');
  assert.ok(r.some(x=>x.type==='order'&&x.id==='o1'));
});

test('busca NF pelo número e encontra nota/pedido/saída relacionados',()=>{
  const r=searchAll(fixture,'45879');
  assert.ok(r.some(x=>x.type==='invoice'&&x.id==='n1'));
  assert.ok(r.some(x=>x.type==='order'&&x.id==='o1'));
  assert.ok(r.some(x=>x.type==='exit'&&x.id==='s1'));
});

test('busca produto por código, nome e código de barras',()=>{
  assert.ok(searchAll(fixture,'Laranja').some(x=>x.type==='product'));
  assert.ok(searchAll(fixture,'789123').some(x=>x.type==='product'));
  assert.ok(searchAll(fixture,'100').some(x=>x.type==='product'));
});

test('busca cliente por nome e CNPJ',()=>{
  assert.ok(searchAll(fixture,'Mercado Avenida').some(x=>x.type==='customer'));
  assert.ok(searchAll(fixture,'12345678').some(x=>x.type==='customer'));
});

test('busca entrada, backlog, lote e fornecedor',()=>{
  assert.ok(searchAll(fixture,'9001').some(x=>x.type==='entry'));
  assert.ok(searchAll(fixture,'Uva 900').some(x=>x.type==='backlog'));
  assert.ok(searchAll(fixture,'L20260819').some(x=>x.type==='lot'));
  assert.ok(searchAll(fixture,'Fábrica Life').some(x=>x.type==='supplier'));
});
