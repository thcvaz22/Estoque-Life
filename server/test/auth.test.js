/* ============================================================
   SERVER/TEST/AUTH.TEST.JS
   Cobre login, proteção das rotas operacionais, logout e o ponto
   mais importante de auditoria: o responsável é definido pela
   sessão do servidor, nunca por um campo enviado pelo frontend.
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let dataDir, server, base;

function cookieFrom(res) {
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

async function login(username, password) {
  return fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesucos-auth-test-'));
  process.env.LIFESUCOS_DATA_DIR = dataDir;
  for (const mod of ['../db', '../auth', '../app', '../routes', '../stockRoutes', '../services/inventoryService']) {
    try { delete require.cache[require.resolve(mod)]; } catch {}
  }
  const { createApp } = require('../app');
  server = http.createServer(createApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('rotas operacionais exigem autenticação, mas health continua público', async () => {
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  const products = await fetch(base + '/api/products');
  assert.equal(products.status, 401);
  const stock = await fetch(base + '/api/stock/lots');
  assert.equal(stock.status, 401);
});

test('usuários padrão entram com as credenciais solicitadas', async () => {
  const admin = await login('admin', 'TestAdmin-v15-Only');
  assert.equal(admin.status, 200);
  const adminBody = await admin.json();
  assert.equal(adminBody.user.perfil, 'Gerente');
  assert.ok(cookieFrom(admin));

  const operador = await login('operador', 'TestOperator-v15-Only');
  assert.equal(operador.status, 200);
  const opBody = await operador.json();
  assert.equal(opBody.user.perfil, 'Operador');
  assert.ok(cookieFrom(operador));
});

test('senha incorreta é rejeitada com mensagem de autenticação', async () => {
  const res = await login('operador', 'senha-errada');
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.match(body.error, /senha|usuário/i);
});

test('sessão identifica automaticamente quem criou a movimentação e impede spoof de usuário', async () => {
  const auth = await login('operador', 'TestOperator-v15-Only');
  const cookie = cookieFrom(auth);

  const product = { id: 'auth_prod_1', nome: 'Produto Auditoria', ativo: true };
  const put = await fetch(base + '/api/products/' + product.id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(product)
  });
  assert.equal(put.status, 200);

  const entry = await fetch(base + '/api/stock/entries', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      fornecedor: 'Fornecedor Teste', usuario: 'usuario_falso', responsavel: 'outra_pessoa',
      itens: [{ produtoId: product.id, quantidade: 10, lote: 'AUTH1' }]
    })
  });
  assert.equal(entry.status, 200);
  const entryBody = await entry.json();
  assert.equal(entryBody.responsavel, 'Operador (operador)');

  const history = await fetch(base + '/api/history', { headers: { Cookie: cookie } });
  const rows = await history.json();
  const movement = rows.find(h => h.produtoId === product.id && h.tipo === 'entrada');
  assert.ok(movement);
  assert.equal(movement.usuario, 'Operador (operador)');
  assert.notEqual(movement.usuario, 'usuario_falso');
});

test('logout invalida a sessão operacional', async () => {
  const auth = await login('admin', 'TestAdmin-v15-Only');
  const cookie = cookieFrom(auth);
  const before = await fetch(base + '/api/products', { headers: { Cookie: cookie } });
  assert.equal(before.status, 200);

  const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(logout.status, 200);

  const after = await fetch(base + '/api/products', { headers: { Cookie: cookie } });
  assert.equal(after.status, 401);
});
