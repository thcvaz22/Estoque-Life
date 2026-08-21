const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..','..');
const read=(p)=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('v18 possui outbox persistente, journal redundante e carga inicial segura',()=>{
  const s=read('server/hybridSync.js');
  assert.match(s,/CREATE TABLE IF NOT EXISTS sync_outbox/);
  assert.match(s,/aion-sync-journal\.ndjson/);
  assert.match(s,/initial-sync-required/);
  assert.match(s,/local_to_cloud/);
  assert.match(s,/cloud_to_local/);
});

test('pareamento não persiste token bruto na nuvem',()=>{
  const s=read('server/hybridSync.js');
  assert.match(s,/tokenHash:sha256\(token\)/);
  assert.match(s,/randomBytes\(48\)/);
  assert.match(s,/attempts>=8/);
});

test('Life Vendas possui IndexedDB e fila offline de pedidos/clientes',()=>{
  const s=read('seller-public/offline-sync.js');
  assert.match(s,/indexedDB\.open/);
  assert.match(s,/\/api\/commercial\/orders/);
  assert.match(s,/\/api\/commercial\/customers/);
  assert.match(s,/aguardando_sincronizacao/);
  assert.match(s,/addEventListener\('online'/);
});
