const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { parsePackingListText } = require('../ocr/parsePackingListText');
const { parseInvoiceText } = require('../ocr/parseInvoiceText');
const { matchOneItem } = require('../ocr/matchProducts');

test('parser de romaneio separa duas NFs com seus produtos', () => {
  const text = `ROMANEIO 7788\nMOTORISTA: JOAO SILVA\nPLACA: ABC1D23\nNF 10255 - MERCADO ALFA\n7891000100103 SUCO LARANJA 1L UN 20\nNF 10256 - MERCADO BETA\n7891000100202 SUCO UVA 1L UN 10`;
  const r = parsePackingListText(text);
  assert.equal(r.romaneioNumero, '7788');
  assert.equal(r.motorista, 'JOAO SILVA');
  assert.equal(r.placa, 'ABC1D23');
  assert.equal(r.nfs.length, 2);
  assert.equal(r.nfs[0].numero, '10255');
  assert.equal(r.nfs[0].itens[0].quantidade, 20);
  assert.equal(r.nfs[1].numero, '10256');
  assert.equal(r.nfs[1].itens[0].quantidade, 10);
});

test('parser de NF extrai item, NF e fornecedor de texto OCR', () => {
  const text = `Emitente: LIFE INDUSTRIA LTDA\nNF 12345\n7891000100103 SUCO LARANJA 1L UN 50\nLOTE L123\nVAL 20/09/2026`;
  const r = parseInvoiceText(text);
  assert.equal(r.nf, '12345');
  assert.ok(r.fornecedor);
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].quantidade, 50);
});

test('match de produto reconhece EAN e não cria produto desconhecido', () => {
  const products = [{ id: 'p1', nome: 'Suco Laranja 1L', codigoBarras: '7891000100103', ativo: true }];
  const ok = matchOneItem({ ean: '7891000100103', descricao: 'SUCO LARANJA' }, products);
  assert.equal(ok.produtoId, 'p1');
  const unknown = matchOneItem({ ean: '0000000000000', descricao: 'PRODUTO TOTALMENTE DESCONHECIDO' }, products);
  assert.equal(unknown.produtoId, null);
});

test('endpoint de romaneio com OCR falso gera só prévia e não cria saída', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesucos-ocr-test-'));
  process.env.LIFESUCOS_DATA_DIR = dataDir;
  for (const mod of ['../db', '../auth', '../app', '../routes', '../stockRoutes', '../services/inventoryService']) { try { delete require.cache[require.resolve(mod)]; } catch {} }
  const fakeOcr = async () => ({ text: `ROMANEIO 99\nMOTORISTA: TESTE\nPLACA: ABC1D23\nNF 500 - CLIENTE TESTE\n7891000100103 SUCO LARANJA 1L UN 3`, confidence: .95 });
  const { createApp } = require('../app');
  const server = http.createServer(createApp({ ocrEngine: fakeOcr }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username:'operador', password:'TestOperator-v15-Only' }) });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  await fetch(base + '/api/products/p1', { method: 'PUT', headers: { 'Content-Type':'application/json', Cookie: cookie }, body: JSON.stringify({ id:'p1', nome:'Suco Laranja 1L', codigoBarras:'7891000100103', ativo:true }) });
  const before = await (await fetch(base + '/api/exits', { headers:{ Cookie: cookie } })).json();
  const image = Buffer.from('imagem-falsa').toString('base64');
  const res = await fetch(base + '/api/ocr/analyze-romaneio', { method:'POST', headers:{'Content-Type':'application/json', Cookie: cookie}, body:JSON.stringify({ imagens:[{base64:image,mimeType:'image/jpeg'}] }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.nfs[0].numero, '500');
  assert.equal(body.nfs[0].itens[0].produtoId, 'p1');
  const after = await (await fetch(base + '/api/exits', { headers:{ Cookie: cookie } })).json();
  assert.equal(after.length, before.length, 'OCR não pode criar saída antes da confirmação');
});
