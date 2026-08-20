/* ============================================================
   SERVER/TEST/USERS-PERMISSIONS.TEST.JS
   Gestão de usuários e permissões Gerente x Operador.
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let dataDir, server, base, adminCookie, operatorCookie;

function cookieFrom(res) {
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

async function login(username, password) {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return { res, cookie: cookieFrom(res), body: await res.json().catch(() => null) };
}

async function request(pathname, { method = 'GET', cookie = adminCookie, body } = {}) {
  const headers = cookie ? { Cookie: cookie } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + pathname, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesucos-users-test-'));
  process.env.LIFESUCOS_DATA_DIR = dataDir;
  for (const mod of ['../db', '../auth', '../app', '../routes', '../stockRoutes', '../services/inventoryService']) {
    try { delete require.cache[require.resolve(mod)]; } catch {}
  }
  const { createApp } = require('../app');
  server = http.createServer(createApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const admin = await login('admin', 'TestAdmin-v15-Only');
  assert.equal(admin.res.status, 200);
  adminCookie = admin.cookie;
  const operador = await login('operador', 'TestOperator-v15-Only');
  assert.equal(operador.res.status, 200);
  operatorCookie = operador.cookie;
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Operador não consegue listar nem cadastrar usuários', async () => {
  const list = await request('/api/users', { cookie: operatorCookie });
  assert.equal(list.status, 403);
  assert.match(list.body.error, /gerente/i);

  const create = await request('/api/users', {
    method: 'POST', cookie: operatorCookie,
    body: { nome: 'Tentativa', username: 'tentativa', password: '123456', perfil: 'Gerente' }
  });
  assert.equal(create.status, 403);
});

test('Gerente cadastra novo operador e ação aparece no histórico', async () => {
  const created = await request('/api/users', {
    method: 'POST', body: { nome: 'João Operador', username: 'joao', password: 'senha123', perfil: 'Operador' }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.username, 'joao');
  assert.equal(created.body.perfil, 'Operador');
  assert.equal(created.body.ativo, true);
  assert.equal('passwordHash' in created.body, false);

  const history = await request('/api/history');
  const row = history.body.find(h => h.tipo === 'usuario_cadastrado' && String(h.produtoNome).includes('João Operador'));
  assert.ok(row, 'deveria registrar cadastro do usuário no histórico');
  assert.equal(row.usuario, 'Administrador (admin)');
});

test('novo operador consegue entrar, mas continua sem permissão administrativa', async () => {
  const joao = await login('joao', 'senha123');
  assert.equal(joao.res.status, 200);
  assert.equal(joao.body.user.perfil, 'Operador');
  const users = await request('/api/users', { cookie: joao.cookie });
  assert.equal(users.status, 403);
});

test('Gerente edita usuário e redefine senha; senha antiga deixa de funcionar', async () => {
  const list = await request('/api/users');
  const joao = list.body.find(u => u.username === 'joao');
  assert.ok(joao);

  const edit = await request(`/api/users/${joao.id}`, {
    method: 'PUT', body: { nome: 'João da Silva', username: 'joao.silva', perfil: 'Operador' }
  });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.username, 'joao.silva');

  const reset = await request(`/api/users/${joao.id}/reset-password`, {
    method: 'POST', body: { password: 'novasenha789' }
  });
  assert.equal(reset.status, 200);

  const oldLogin = await login('joao.silva', 'senha123');
  assert.equal(oldLogin.res.status, 401);
  const newLogin = await login('joao.silva', 'novasenha789');
  assert.equal(newLogin.res.status, 200);
});

test('desativar usuário impede login sem apagar histórico; reativar restaura acesso', async () => {
  const list = await request('/api/users');
  const joao = list.body.find(u => u.username === 'joao.silva');

  const deact = await request(`/api/users/${joao.id}/deactivate`, { method: 'POST', body: {} });
  assert.equal(deact.status, 200);
  assert.equal(deact.body.ativo, false);

  const denied = await login('joao.silva', 'novasenha789');
  assert.equal(denied.res.status, 401);

  const history = await request('/api/history');
  assert.ok(history.body.some(h => h.tipo === 'usuario_desativado' && String(h.produtoNome).includes('João da Silva')));

  const react = await request(`/api/users/${joao.id}/activate`, { method: 'POST', body: {} });
  assert.equal(react.status, 200);
  assert.equal(react.body.ativo, true);
  const allowed = await login('joao.silva', 'novasenha789');
  assert.equal(allowed.res.status, 200);
});

test('Operador não acessa backup/restauração nem ajuste manual de estoque', async () => {
  const backup = await request('/api/backup', { cookie: operatorCookie });
  assert.equal(backup.status, 403);

  const restore = await request('/api/restore', { method: 'POST', cookie: operatorCookie, body: { version: 3, products: [] } });
  assert.equal(restore.status, 403);

  const adjust = await request('/api/stock/adjust', {
    method: 'POST', cookie: operatorCookie,
    body: { lotId: 'qualquer', tipo: 'entrada', quantidade: 1, motivo: 'teste' }
  });
  assert.equal(adjust.status, 403);
});

test('Gerente não consegue desativar a própria conta nem remover o último Gerente', async () => {
  const list = await request('/api/users');
  const admin = list.body.find(u => u.username === 'admin');
  assert.ok(admin);

  const selfDeactivate = await request(`/api/users/${admin.id}/deactivate`, { method: 'POST', body: {} });
  assert.equal(selfDeactivate.status, 409);

  const demote = await request(`/api/users/${admin.id}`, {
    method: 'PUT', body: { nome: admin.nome, username: admin.username, perfil: 'Operador' }
  });
  assert.equal(demote.status, 409);
  assert.match(demote.body.error, /último gerente/i);
});
