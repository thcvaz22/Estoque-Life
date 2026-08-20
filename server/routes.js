/* ============================================================
   SERVER/ROUTES.JS — API REST genérica
   A partir da Etapa 3, este CRUD genérico só permite ESCRITA
   para coleções "cadastro simples" (products, meta). Todas as
   operações que mexem em estoque (entradas, saídas, backlog,
   perdas, inventário, ajustes, lotes) vivem em stockRoutes.js,
   usando o serviço em services/inventoryService.js — nunca aqui.
   Leitura (GET) continua disponível para todas as coleções,
   incluindo "lots" (que agora é tabela relacional própria).
   ============================================================ */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, Data, STORES, isValidStore, isGenericWritable, DATA_DIR } = require('./db');
const { getLanUrls } = require('./network');
const svc = require('./services/inventoryService');
const { createDatabaseBackup } = require('./cloudBackup');
const { searchAll } = require('./globalSearch');

const router = express.Router();
const SYSTEM_VERSION = '17.1.0-neon-primary-render-free-aion-1.1';
const { getCloudPersistenceStatus } = require('./cloudPersistence');


function isAdministrator(req) {
  return !!(req.authUser && (String(req.authUser.username || '').toLowerCase() === 'admin' || req.authUser.perfil === 'Administrador'));
}
function requireAdministratorRoute(req, res, next) {
  if (!isAdministrator(req)) {
    return res.status(403).json({ error: 'Acesso restrito à conta Administrador.', code: 'ADMIN_REQUIRED' });
  }
  next();
}

function requireManagerRoute(req, res, next) {
  if (!req.authUser || req.authUser.perfil !== 'Gerente') {
    return res.status(403).json({ error: 'Acesso negado — permissão de gerente necessária.', code: 'MANAGER_REQUIRED' });
  }
  next();
}

function currentUser(req) {
  const u = req.authUser;
  if (!u) return 'Usuário não autenticado';
  return u.auditLabel || `${u.nome} (${u.username})`;
}

function appendHistory(entry) {
  const row = { id: genId('hist'), timestamp: new Date().toISOString(), ...entry };
  Data.upsert('history', row.id, row);
  return row;
}

router.param('store', (req, res, next, store) => {
  if (!isValidStore(store)) return res.status(404).json({ error: 'Coleção desconhecida: ' + store });
  next();
});

router.get('/health', (req, res) => {
  const httpsPort = Number(process.env.HTTPS_PORT || 4443);
  const cloudMode = String(process.env.CLOUD_MODE||'').toLowerCase()==='true' || !!process.env.RENDER;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || (cloudMode ? `${req.protocol}://${req.get('host')}` : null);
  res.json({ ok: true, time: new Date().toISOString(), systemVersion: SYSTEM_VERSION, cloudMode, storage: cloudMode ? 'neon-primary+ephemeral-sqlite-cache' : 'sqlite-local', cloudPersistence: getCloudPersistenceStatus(), publicBaseUrl, sellerUrl: publicBaseUrl ? publicBaseUrl.replace(/\/$/,'') + '/vendas/' : null, lanUrls: cloudMode ? [] : getLanUrls(httpsPort, 'https') });
});

/* ---------- Lotes: leitura direta da tabela relacional ---------- */
router.get('/lots', (req, res) => {
  res.json(svc.listAllLots());
});
router.get('/lots/:id', (req, res) => {
  const lot = db.prepare('SELECT * FROM lots WHERE id = ?').get(req.params.id);
  if (!lot) return res.status(404).json({ error: 'não encontrado' });
  res.json(lot);
});


/* ---------- Busca global unificada ---------- */
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const lots = db.prepare('SELECT * FROM lots').all();
  const results = searchAll({
    products: Data.all('products'),
    customers: Data.all('customers'),
    orders: Data.all('orders'),
    invoices: Data.all('fiscalInvoices'),
    entries: Data.all('entries'),
    exits: Data.all('exits'),
    backlog: Data.all('backlog'),
    suppliers: Data.all('suppliers'),
    lots
  }, q);
  res.json(results);
});

/* ---------- Histórico administrativo: somente Administrador ---------- */
router.get('/history', requireAdministratorRoute, (req, res) => {
  res.json(Data.all('history').sort((a,b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))));
});
router.put('/lots/:id', (req, res) => {
  res.status(403).json({ error: 'Lotes não podem ser alterados diretamente. Use "Fazer ajuste de estoque" (POST /api/stock/adjust) ou edite os dados do lote em PUT /api/stock/lots/:id/meta.' });
});
router.delete('/lots/:id', (req, res) => {
  res.status(403).json({ error: 'Lotes não podem ser excluídos diretamente.' });
});

/* ---------- Histórico: só é possível ANEXAR (nunca editar/apagar) ---------- */
function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
router.post('/history', (req, res) => {
  const b = req.body || {};
  const entry = appendHistory({
    usuario: currentUser(req),
    tipo: b.tipo || null, produtoId: b.produtoId || null, produtoNome: b.produtoNome || null,
    quantidade: b.quantidade ?? null, lote: b.lote || null, nf: b.nf || null, motivo: b.motivo || null, observacoes: b.observacoes || null
  });
  res.json(entry);
});

/* ---------- Produtos: bloquear exclusão física se já houve movimentação ---------- */
function productHasMovement(productId) {
  const lot = db.prepare('SELECT 1 FROM lots WHERE productId = ? LIMIT 1').get(productId);
  if (lot) return true;
  const inJson = (store, test) => Data.all(store).some(test);
  if (inJson('entries', e => (e.itens || []).some(i => i.produtoId === productId))) return true;
  if (inJson('exits', e => (e.nfs || []).some(nf => (nf.itens || []).some(i => i.produtoId === productId)))) return true;
  if (inJson('losses', l => l.produtoId === productId)) return true;
  if (inJson('backlog', b => b.produtoId === productId)) return true;
  if (inJson('history', h => h.produtoId === productId && !['cadastro_produto', 'edicao_produto'].includes(h.tipo))) return true;
  return false;
}
router.delete('/products/:id', (req, res) => {
  const product = Data.get('products', req.params.id);
  if (!product) return res.status(404).json({ error: 'não encontrado' });
  if (productHasMovement(req.params.id)) {
    return res.status(409).json({ error: 'Este produto já tem movimentações registradas e não pode ser excluído. Use "Desativar" para removê-lo das novas operações mantendo o histórico.' });
  }
  Data.remove('products', req.params.id);
  appendHistory({ usuario: currentUser(req), tipo: 'exclusao', produtoId: product.id, produtoNome: product.nome, motivo: 'Produto excluído (sem movimentações anteriores)' });
  res.status(204).end();
});

/* ---------- Backup completo (com metadados de versão) ---------- */
router.get('/backup', requireManagerRoute, (req, res) => {
  const dump = { version: 6, systemVersion: SYSTEM_VERSION, createdAt: new Date().toISOString() };
  for (const store of STORES) dump[store] = Data.all(store);
  dump.fiscalInvoices = (dump.fiscalInvoices || []).map(inv => {
    const copy = { ...inv };
    try { if (inv.pdfPath && fs.existsSync(inv.pdfPath)) copy.pdfBase64 = fs.readFileSync(inv.pdfPath).toString('base64'); } catch {}
    try { if (inv.xmlPath && fs.existsSync(inv.xmlPath)) copy.xmlBase64 = fs.readFileSync(inv.xmlPath).toString('base64'); } catch {}
    return copy;
  });
  dump.lots = svc.listAllLots();
  // v6: preserva usuários e hashes de senha para migração segura à nuvem.
  // Sessões NÃO são exportadas: todo usuário precisa autenticar novamente após restaurar.
  dump.authUsers = db.prepare(`SELECT id, username, nome, perfil, passwordSalt, passwordHash, ativo, createdAt, updatedAt FROM users ORDER BY createdAt ASC`).all();
  res.json(dump);
});

router.get('/backup/sqlite', requireManagerRoute, async (req, res) => {
  try {
    const file = await createDatabaseBackup('download');
    return res.download(file, `lifesucos-${new Date().toLocaleDateString('sv-SE')}.db`);
  } catch (err) {
    return res.status(500).json({ error: 'Falha ao gerar backup SQLite: ' + err.message });
  }
});

/* ---------- Restauração — validada antes, transacional depois ---------- */
function validateBackupShape(body) {
  if (!body || typeof body !== 'object') return 'Arquivo de backup vazio ou inválido.';
  if (!('version' in body)) return 'Arquivo de backup sem informação de versão — pode ser de um formato muito antigo ou incompatível.';
  const knownKeys = [...STORES, 'lots'];
  if ('authUsers' in body && !Array.isArray(body.authUsers)) return 'Campo "authUsers" do backup deveria ser uma lista.';
  const hasAnyKnownArray = knownKeys.some(k => Array.isArray(body[k]));
  if (!hasAnyKnownArray) return 'Arquivo de backup não contém nenhuma coleção reconhecida.';
  for (const key of knownKeys) {
    if (key in body && !Array.isArray(body[key])) return `Campo "${key}" do backup deveria ser uma lista.`;
  }
  return null;
}
router.post('/restore', requireManagerRoute, (req, res) => {
  const body = req.body || {};
  const problem = validateBackupShape(body);
  if (problem) return res.status(400).json({ error: problem });

  try {
    const run = db.transaction(() => {
      for (const store of STORES) {
        if (!Array.isArray(body[store])) continue;
        Data.clear(store);
        for (const row of body[store]) {
          const pk = row && (row.id ?? row.key);
          if (!pk) continue;
          const payload = { ...row };
          if (store === 'fiscalInvoices') {
            const dir = path.join(DATA_DIR, 'fiscal', String(pk));
            try {
              fs.mkdirSync(dir, { recursive: true });
              if (payload.pdfBase64) { payload.pdfPath = path.join(dir, 'danfe.pdf'); fs.writeFileSync(payload.pdfPath, Buffer.from(payload.pdfBase64, 'base64')); }
              if (payload.xmlBase64) { payload.xmlPath = path.join(dir, 'nfe.xml'); fs.writeFileSync(payload.xmlPath, Buffer.from(payload.xmlBase64, 'base64')); }
            } catch {}
            delete payload.pdfBase64; delete payload.xmlBase64;
          }
          Data.upsert(store, String(pk), payload);
        }
      }
      if (Array.isArray(body.lots)) {
        db.exec('DELETE FROM lots');
        const insert = db.prepare(`INSERT INTO lots (id, productId, lote, fabricacao, validade, quantidadeDisponivel, quantidadeBloqueada, localizacao, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)`);
        const now = new Date().toISOString();
        for (const l of body.lots) {
          if (!l.id || !l.productId) continue;
          insert.run(l.id, l.productId, l.lote || 'SEM-LOTE', l.fabricacao || null, l.validade || null,
            Math.max(0, Number(l.quantidadeDisponivel) || 0), Math.max(0, Number(l.quantidadeBloqueada) || 0), l.localizacao || '', l.updatedAt || now);
        }
      }
      if (Array.isArray(body.authUsers)) {
        const rows = body.authUsers.filter(u => u && u.id && u.username && u.nome && u.perfil && u.passwordSalt && u.passwordHash);
        if (!rows.some(u => u.perfil === 'Gerente' && Number(u.ativo) === 1)) {
          throw Object.assign(new Error('O backup não possui nenhum Gerente ativo; restauração cancelada para evitar bloqueio de acesso.'), { status: 400 });
        }
        for (const u of rows) {
          if (!/^[a-f0-9]{16,}$/i.test(String(u.passwordSalt)) || !/^[a-f0-9]{128}$/i.test(String(u.passwordHash))) {
            throw Object.assign(new Error(`Credencial inválida no usuário ${u.username}; restauração cancelada.`), { status: 400 });
          }
        }
        db.prepare('DELETE FROM sessions').run();
        db.prepare('DELETE FROM users').run();
        const insertUser = db.prepare(`INSERT INTO users (id,username,nome,perfil,passwordSalt,passwordHash,ativo,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)`);
        const now = new Date().toISOString();
        for (const u of rows) insertUser.run(String(u.id), String(u.username), String(u.nome), String(u.perfil), String(u.passwordSalt), String(u.passwordHash), Number(u.ativo) ? 1 : 0, u.createdAt || now, u.updatedAt || now);
      }
    });
    run();
    appendHistory({ usuario: currentUser(req), tipo: 'restauracao_backup', motivo: 'Backup restaurado pelo usuário autenticado' });
    res.json({ ok: true, requiresRelogin: Array.isArray(body.authUsers) });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Falha ao restaurar: ' + err.message + ' — nenhum dado foi alterado (a restauração é tudo-ou-nada).' });
  }
});

/* ---------- CRUD genérico (products, meta = escrita; demais = só leitura) ---------- */
router.get('/:store', (req, res) => {
  if (req.params.store === 'history' && !isAdministrator(req)) return res.status(403).json({ error: 'Acesso restrito à conta Administrador.', code: 'ADMIN_REQUIRED' });
  res.json(Data.all(req.params.store));
});

router.get('/:store/:id', (req, res) => {
  if (req.params.store === 'history' && !isAdministrator(req)) return res.status(403).json({ error: 'Acesso restrito à conta Administrador.', code: 'ADMIN_REQUIRED' });
  const obj = Data.get(req.params.store, req.params.id);
  if (obj === null) return res.status(404).json({ error: 'não encontrado' });
  res.json(obj);
});

router.put('/:store/:id', (req, res) => {
  if (req.params.store === 'meta' && (!req.authUser || req.authUser.perfil !== 'Gerente')) {
    return res.status(403).json({ error: 'Acesso negado — permissão de gerente necessária para alterar configurações.', code: 'MANAGER_REQUIRED' });
  }
  if (!isGenericWritable(req.params.store)) {
    return res.status(403).json({ error: `A coleção "${req.params.store}" não pode ser alterada diretamente. Use os endpoints específicos em /api/stock/*.` });
  }
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'corpo inválido' });
  const before = Data.get(req.params.store, req.params.id);
  const payload = { ...req.body };
  if (['products', 'customers', 'suppliers'].includes(req.params.store)) {
    payload.ultimoAlteradoPor = currentUser(req);
    payload.responsavel = currentUser(req);
  }
  const saved = Data.upsert(req.params.store, req.params.id, payload);
  if (req.params.store === 'products') {
    appendHistory({
      usuario: currentUser(req),
      tipo: before ? 'edicao_produto' : 'cadastro_produto',
      produtoId: saved.id || req.params.id,
      produtoNome: saved.nome || '',
      motivo: before ? 'Produto alterado' : 'Produto cadastrado'
    });
  }
  if (req.params.store === 'customers') {
    appendHistory({
      usuario: currentUser(req),
      tipo: before ? 'edicao_cliente' : 'cadastro_cliente',
      motivo: `${before ? 'Cliente alterado' : 'Cliente cadastrado'}: ${saved.nome || saved.razaoSocial || saved.id}`
    });
  }
  if (req.params.store === 'suppliers') {
    appendHistory({
      usuario: currentUser(req),
      tipo: before ? 'edicao_fornecedor' : 'cadastro_fornecedor',
      motivo: `${before ? 'Fornecedor alterado' : 'Fornecedor cadastrado'}: ${saved.nome || saved.razaoSocial || saved.id}`
    });
  }
  res.json(saved);
});

router.delete('/:store/:id', (req, res) => {
  if (req.params.store === 'meta' && (!req.authUser || req.authUser.perfil !== 'Gerente')) {
    return res.status(403).json({ error: 'Acesso negado — permissão de gerente necessária para alterar configurações.', code: 'MANAGER_REQUIRED' });
  }
  if (!isGenericWritable(req.params.store)) {
    return res.status(403).json({ error: `A coleção "${req.params.store}" não pode ser alterada diretamente.` });
  }
  Data.remove(req.params.store, req.params.id);
  res.status(204).end();
});

module.exports = router;
