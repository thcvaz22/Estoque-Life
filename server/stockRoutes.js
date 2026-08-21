/* ============================================================
   SERVER/STOCKROUTES.JS — endpoints dedicados de estoque
   Camada fina: valida a presença de um usuário, extrai o corpo
   da requisição e chama o serviço. Toda a regra de negócio real
   está em services/inventoryService.js.
   ============================================================ */

const express = require('express');
const svc = require('./services/inventoryService');
const { Data } = require('./db');

const router = express.Router();

function currentUser(req) {
  const u = req.authUser;
  if (!u) return 'Usuário não autenticado';
  return u.auditLabel || `${u.nome} (${u.username})`;
}


function requireManager(req, res, next) {
  if (!req.authUser || req.authUser.perfil !== 'Gerente') {
    return res.status(403).json({ error: 'Acesso negado — permissão de gerente necessária para ajuste manual de estoque.', code: 'MANAGER_REQUIRED' });
  }
  next();
}

function handle(fn) {
  return (req, res) => {
    try {
      const result = fn(req);
      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[stock] erro interno:', err);
      res.status(status).json({ error: err.message || 'Erro interno.' });
    }
  };
}

router.post('/entries', handle((req) => {
  const b = req.body || {};
  return svc.createEntry({ ...b, usuario: currentUser(req) });
}));

router.post('/exits', handle((req) => {
  const b = req.body || {};
  return svc.createExit({ ...b, usuario: currentUser(req), ignoreReservations: !!req.isSyncReplay });
}));

router.post('/exits/:id/conclude', handle((req) => {
  return svc.concludeExit({ exitId: req.params.id, usuario: currentUser(req) });
}));

router.post('/backlog/return', handle((req) => {
  const b = req.body || {};
  return svc.returnToBacklog({ ...b, usuario: currentUser(req) });
}));

router.post('/backlog/redelivery', handle((req) => {
  const b = req.body || {};
  return svc.redeliverBacklog({ ...b, usuario: currentUser(req) });
}));

router.post('/backlog/release', handle((req) => {
  const b = req.body || {};
  return svc.releaseBacklog({ ...b, usuario: currentUser(req) });
}));

router.post('/losses', handle((req) => {
  const b = req.body || {};
  return svc.createLoss({ ...b, usuario: currentUser(req) });
}));

router.post('/inventory-adjustment', handle((req) => {
  const b = req.body || {};
  return svc.createInventoryAdjustment({ ...b, usuario: currentUser(req) });
}));

router.post('/adjust', requireManager, handle((req) => {
  const b = req.body || {};
  return svc.adjustStock({ ...b, usuario: currentUser(req) });
}));

router.put('/lots/:id/meta', handle((req) => {
  const b = req.body || {};
  return svc.updateLotMeta({ ...b, lotId: req.params.id, usuario: currentUser(req) });
}));

router.get('/lots', handle(() => svc.listAllLots()));

router.get('/available/:productId', handle((req) => ({ productId: req.params.productId, disponivel: svc.computeAvailable(req.params.productId) })));

/* Produtos: desativar em vez de excluir quando já houve movimentação */
router.post('/products/:id/deactivate', handle((req) => {
  const product = Data.get('products', req.params.id);
  if (!product) throw svc.httpError(404, 'Produto não encontrado.');
  product.ativo = false;
  product.ultimoAlteradoPor = currentUser(req);
  Data.upsert('products', product.id, product);
  svc.recordHistory({ tipo: 'edicao_produto', usuario: currentUser(req), produtoId: product.id, produtoNome: product.nome, motivo: 'Produto desativado' });
  return product;
}));
router.post('/products/:id/activate', handle((req) => {
  const product = Data.get('products', req.params.id);
  if (!product) throw svc.httpError(404, 'Produto não encontrado.');
  product.ativo = true;
  product.ultimoAlteradoPor = currentUser(req);
  Data.upsert('products', product.id, product);
  svc.recordHistory({ tipo: 'edicao_produto', usuario: currentUser(req), produtoId: product.id, produtoNome: product.nome, motivo: 'Produto reativado' });
  return product;
}));

module.exports = router;
