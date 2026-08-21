const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let dataDir, server, base, cookie;

async function login() {
  const r = await fetch(base + '/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:'admin',password:'TestAdmin-v15-Only'}) });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function post(url, body) {
  return fetch(base + url, { method:'POST', headers:{'Content-Type':'application/json',Cookie:cookie}, body:JSON.stringify(body) });
}

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesucos-aion-test-'));
  process.env.LIFESUCOS_DATA_DIR = dataDir;
  for (const mod of ['../db','../auth','../app','../routes','../stockRoutes','../aionRoutes','../services/inventoryService']) {
    try { delete require.cache[require.resolve(mod)]; } catch {}
  }
  const { createApp } = require('../app');
  server = http.createServer(createApp());
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await login();
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (dataDir) fs.rmSync(dataDir,{recursive:true,force:true});
});

test('AION IA exige sessão', async () => {
  const r = await fetch(base + '/api/aion/catalogs');
  assert.equal(r.status,401);
});

test('cadastra cliente com confirmação via endpoint dedicado', async () => {
  const r = await post('/api/aion/master/customer',{nome:'Cliente IA',cnpj:'00.000.000/0001-00'});
  assert.equal(r.status,200);
  const b = await r.json();
  assert.equal(b.item.nome,'Cliente IA');
  const list = await fetch(base + '/api/aion/catalogs',{headers:{Cookie:cookie}}).then(x=>x.json());
  assert.ok(list.customers.some(x=>x.nome==='Cliente IA'));
});

test('pedido em linguagem natural vira rascunho, não baixa estoque', async () => {
  const r = await post('/api/aion/ask',{message:'novo pedido cliente Condor JK NF 123 código 100 2 fardos'});
  assert.equal(r.status,200);
  const b = await r.json();
  assert.equal(b.action.type,'open_exit');
  assert.equal(b.action.draft.nfs[0].numero,'123');
  assert.equal(b.action.draft.nfs[0].itens[0].quantidade,2);
  const exits = await fetch(base + '/api/exits',{headers:{Cookie:cookie}}).then(x=>x.json());
  assert.equal(exits.length,0);
});

test('gera especificação de relatório por cliente', async () => {
  const r = await post('/api/aion/ask',{message:'relatório por clientes este mês em PDF'});
  assert.equal(r.status,200);
  const b = await r.json();
  assert.equal(b.action.type,'report');
  assert.match(b.action.report.title,/Cliente/i);
  assert.ok(Array.isArray(b.action.report.rows));
});


test('AION converte unidades em fardos usando cadastro real do produto', async () => {
  const r = await post('/api/aion/ask',{message:'48 unidades do código 100 dão quantos fardos?'});
  assert.equal(r.status,200); const b=await r.json();
  assert.match(b.reply,/2 fardos/i); assert.match(b.reply,/24 un\./i);
  assert.equal(b.source,'local-calculator');
});

test('AION responde continuação de conversão usando memória curta', async () => {
  const history=[{role:'user',content:'48 unidades do código 100 dão quantos fardos?'},{role:'assistant',content:'48 unidades = 2 fardos.'}];
  const r = await post('/api/aion/ask',{message:'e em pallets?',history});
  assert.equal(r.status,200); const b=await r.json();
  assert.equal(b.source,'local-calculator'); assert.match(b.reply,/pallet/i);
});
