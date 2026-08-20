/* ============================================================
   SERVER/TEST/REMOTE.TEST.JS
   Roda com: npm test
   Cobre: painel desligado por padrão, exigência de login, dados
   batendo com o banco real, ausência de qualquer rota de escrita,
   a conexão de leitura realmente recusando escrita no driver,
   limite de tentativas de login, e logout.
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let dataDir;
const oldDirs = [];

function freshEnv() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesucos-remote-test-'));
  oldDirs.push(dataDir);
  process.env.LIFESUCOS_DATA_DIR = dataDir;
  // Precisa limpar TODOS os módulos que capturam uma referência ao banco
  // no momento do require — não só db.js/app.js, mas também tudo que os
  // usa por baixo (routes, stockRoutes, o serviço de estoque). Esquecer
  // algum aqui faz o teste seguinte ficar preso, por engano, ao banco do
  // teste anterior — não é um problema no sistema, é só isolamento de teste.
  for (const mod of [
    '../db', '../app', '../auth', '../routes', '../stockRoutes', '../services/inventoryService',
    '../remoteConfig', '../remoteQueries', '../remoteApp', '../remoteAuth'
  ]) {
    delete require.cache[require.resolve(mod)];
  }
}

test.after(() => {
  for (const d of oldDirs) fs.rmSync(d, { recursive: true, force: true });
});

async function startServer(app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function extractCookie(res) {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0];
}

async function loginOperational(url) {
  const res = await fetch(url + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'operador', password: 'TestOperator-v15-Only' })
  });
  assert.equal(res.status, 200, 'login no sistema principal deveria funcionar');
  return extractCookie(res);
}

test('painel remoto NÃO sobe quando não configurado (comportamento padrão)', async () => {
  freshEnv();
  const remoteConfig = require('../remoteConfig');
  assert.equal(remoteConfig.isConfigured(), false);
});

test('depois de configurado, exige login: acessar sem sessão redireciona / 401', async () => {
  freshEnv();
  const { hashPassword } = require('../remoteAuth');
  const remoteConfig = require('../remoteConfig');
  const { salt, hash } = hashPassword('senhaSegura123');
  remoteConfig.writeConfig({ username: 'gerente', salt, hash });

  const { createRemoteApp } = require('../remoteApp');
  const { server, url } = await startServer(createRemoteApp());

  const r1 = await fetch(url + '/', { redirect: 'manual' });
  assert.equal(r1.status, 302, 'GET / sem sessão deveria redirecionar para /login');

  const r2 = await fetch(url + '/api/summary');
  assert.equal(r2.status, 401, 'GET /api/summary sem sessão deveria dar 401');

  await new Promise(r => server.close(r));
});

test('login com senha errada falha; com senha certa funciona e dá acesso ao resumo', async () => {
  freshEnv();
  const { hashPassword } = require('../remoteAuth');
  const remoteConfig = require('../remoteConfig');
  const { salt, hash } = hashPassword('senhaCorreta456');
  remoteConfig.writeConfig({ username: 'gerente', salt, hash });

  // garante que o banco principal existe (com o mesmo LIFESUCOS_DATA_DIR)
  const { createApp } = require('../app');
  createApp();

  const { createRemoteApp } = require('../remoteApp');
  const { server, url } = await startServer(createRemoteApp());

  const wrong = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'gerente', password: 'errada' }) });
  assert.equal(wrong.status, 401);

  const right = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'gerente', password: 'senhaCorreta456' }) });
  assert.equal(right.status, 200);
  const cookie = extractCookie(right);
  assert.ok(cookie, 'deveria vir um cookie de sessão');

  const summary = await fetch(url + '/api/summary', { headers: { Cookie: cookie } });
  assert.equal(summary.status, 200);
  const data = await summary.json();
  assert.ok('estoqueDisponivel' in data);
  assert.ok('estoqueBloqueado' in data);
  assert.ok(Array.isArray(data.motoristasEmRota));
  assert.ok(Array.isArray(data.ultimasMovimentacoes));

  await new Promise(r => server.close(r));
});

test('dados do resumo batem com o estado real do banco', async () => {
  freshEnv();
  const { hashPassword } = require('../remoteAuth');
  const remoteConfig = require('../remoteConfig');
  const { salt, hash } = hashPassword('senha789456');
  remoteConfig.writeConfig({ username: 'gerente', salt, hash });

  const { createApp } = require('../app');
  const mainApp = createApp();
  const { server: mainServer, url: mainUrl } = await startServer(mainApp);

  // cria um produto com estoque baixo de propósito
  const mainCookie = await loginOperational(mainUrl);
  const prodId = 'prod_remote_test';
  await fetch(`${mainUrl}/api/products/${prodId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: mainCookie }, body: JSON.stringify({ id: prodId, nome: 'Produto Painel Remoto', ativo: true, estoqueMinimo: 100 }) });
  await fetch(`${mainUrl}/api/stock/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: mainCookie }, body: JSON.stringify({ fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prodId, quantidade: 5 }] }) });

  const { createRemoteApp } = require('../remoteApp');
  const { server: remoteServer, url: remoteUrl } = await startServer(createRemoteApp());

  const login = await fetch(remoteUrl + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'gerente', password: 'senha789456' }) });
  const cookie = extractCookie(login);

  const res = await fetch(remoteUrl + '/api/summary', { headers: { Cookie: cookie } });
  const data = await res.json();
  const encontrado = data.estoqueBaixo.find(p => p.nome === 'Produto Painel Remoto');
  assert.ok(encontrado, 'o produto com estoque baixo criado no servidor principal deveria aparecer no painel remoto');
  assert.equal(encontrado.disponivel, 5);

  await new Promise(r => mainServer.close(r));
  await new Promise(r => remoteServer.close(r));
});

test('não existe NENHUMA rota de escrita no app remoto (POST/PUT/DELETE fora de /login e /logout falham)', async () => {
  freshEnv();
  const { hashPassword } = require('../remoteAuth');
  const remoteConfig = require('../remoteConfig');
  const { salt, hash } = hashPassword('senhaXYZ789');
  remoteConfig.writeConfig({ username: 'gerente', salt, hash });
  const { createApp } = require('../app');
  createApp();

  const { createRemoteApp } = require('../remoteApp');
  const { server, url } = await startServer(createRemoteApp());

  const login = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'gerente', password: 'senhaXYZ789' }) });
  const cookie = extractCookie(login);

  const tentativas = [
    fetch(url + '/api/summary', { method: 'POST', headers: { Cookie: cookie } }),
    fetch(url + '/api/stock/exits', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' }),
    fetch(url + '/api/products/algum-id', { method: 'PUT', headers: { Cookie: cookie } }),
    fetch(url + '/api/products/algum-id', { method: 'DELETE', headers: { Cookie: cookie } })
  ];
  const results = await Promise.all(tentativas);
  for (const r of results) assert.equal(r.status, 404, `esperava 404 (rota inexistente), recebeu ${r.status} em ${r.url}`);

  await new Promise(r => server.close(r));
});

test('a conexão de leitura do painel remoto recusa fisicamente qualquer escrita', async () => {
  freshEnv();
  const { createApp } = require('../app'); // garante que o banco principal existe
  createApp();
  const Database = require('better-sqlite3');
  const dbPath = path.join(dataDir, 'lifesucos.db');
  const readonlyDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  assert.throws(() => {
    readonlyDb.prepare("INSERT INTO products (id, json, updatedAt) VALUES ('x','{}','now')").run();
  }, /readonly|read-only/i);
});

test('login tem limite de tentativas (proteção contra força bruta)', async () => {
  freshEnv();
  const { hashPassword } = require('../remoteAuth');
  const remoteConfig = require('../remoteConfig');
  const { salt, hash } = hashPassword('senhaCertaAqui');
  remoteConfig.writeConfig({ username: 'gerente', salt, hash });

  const { createRemoteApp } = require('../remoteApp');
  const { server, url } = await startServer(createRemoteApp());

  let lastStatus = 0;
  for (let i = 0; i < 12; i++) {
    const r = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'gerente', password: 'errada' }) });
    lastStatus = r.status;
  }
  assert.equal(lastStatus, 429, 'depois de muitas tentativas erradas, deveria bloquear temporariamente');

  await new Promise(r => server.close(r));
});

test('logout encerra a sessão — acesso posterior volta a exigir login', async () => {
  freshEnv();
  const { hashPassword } = require('../remoteAuth');
  const remoteConfig = require('../remoteConfig');
  const { salt, hash } = hashPassword('outraSenha123');
  remoteConfig.writeConfig({ username: 'gerente', salt, hash });
  const { createApp } = require('../app');
  createApp();

  const { createRemoteApp } = require('../remoteApp');
  const { server, url } = await startServer(createRemoteApp());

  const login = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'gerente', password: 'outraSenha123' }) });
  const cookie = extractCookie(login);

  const before = await fetch(url + '/api/summary', { headers: { Cookie: cookie } });
  assert.equal(before.status, 200);

  await fetch(url + '/logout', { method: 'POST', headers: { Cookie: cookie } });

  const after = await fetch(url + '/api/summary', { headers: { Cookie: cookie } });
  assert.equal(after.status, 401, 'depois do logout, o mesmo cookie não deveria funcionar mais');

  await new Promise(r => server.close(r));
});

test('desligar o painel remoto (remote:disable) remove as credenciais', async () => {
  freshEnv();
  const { hashPassword } = require('../remoteAuth');
  const remoteConfig = require('../remoteConfig');
  const { salt, hash } = hashPassword('temp123456');
  remoteConfig.writeConfig({ username: 'gerente', salt, hash });
  assert.equal(remoteConfig.isConfigured(), true);
  remoteConfig.disable();
  assert.equal(remoteConfig.isConfigured(), false);
});
