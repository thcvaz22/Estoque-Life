/* ============================================================
   SERVER/TEST/INVENTORY.TEST.JS
   Roda com: npm test  (usa o test runner nativo do Node, sem
   dependência extra). Sobe o servidor real numa porta efêmera,
   com um banco SQLite temporário isolado (nunca toca em data/).

   Cobre os cenários mais críticos pedidos na Etapa 3:
   entrada simples, saída simples/múltiplos itens, FEFO, saída
   sem estoque, atomicidade, retorno total/parcial por NF,
   reentrega, liberação, perda, inventário com divergência,
   NF-e duplicada, produto inexistente, produto desativado,
   concorrência real (duas saídas simultâneas) e idempotência.
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let server, baseUrl, dataDir, authCookie;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesucos-test-'));
  process.env.LIFESUCOS_DATA_DIR = dataDir;
  for (const mod of ['../db', '../auth', '../app', '../routes', '../stockRoutes', '../services/inventoryService']) {
    try { delete require.cache[require.resolve(mod)]; } catch {}
  }
  const { createApp } = require('../app');
  const app = createApp();
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'operador', password: 'TestOperator-v15-Only' }) });
  assert.equal(login.status, 200, 'login do operador para os testes deveria funcionar');
  authCookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(authCookie, 'login deveria devolver cookie de sessão');
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function get(p) {
  const res = await fetch(baseUrl + p, { headers: { Cookie: authCookie } });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function post(p, payload) {
  const res = await fetch(baseUrl + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: authCookie }, body: JSON.stringify(payload || {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function put(p, payload) {
  const res = await fetch(baseUrl + p, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: authCookie }, body: JSON.stringify(payload || {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function del(p) {
  const res = await fetch(baseUrl + p, { method: 'DELETE', headers: { Cookie: authCookie } });
  return { status: res.status };
}

async function createTestProduct(nome) {
  const id = 'test_' + Math.random().toString(36).slice(2, 10);
  const { status } = await put(`/api/products/${id}`, { id, nome, ativo: true, estoqueMinimo: 5 });
  assert.equal(status, 200);
  return id;
}
async function stockOf(productId, bucket = 'quantidadeDisponivel') {
  const { body: lots } = await get('/api/lots');
  return lots.filter(l => l.productId === productId).reduce((a, l) => a + l[bucket], 0);
}

test('entrada simples cria lote e soma ao estoque disponível', async () => {
  const prod = await createTestProduct('Produto Entrada Simples');
  const { status, body } = await post('/api/stock/entries', {
    fornecedor: 'Fornecedor A', data: '2026-01-01',
    itens: [{ produtoId: prod, quantidade: 30, lote: 'L1' }]
  });
  assert.equal(status, 200);
  assert.equal(body.itens[0].quantidade, 30);
  assert.equal(await stockOf(prod), 30);
});

test('entrada com múltiplos lotes soma corretamente', async () => {
  const prod = await createTestProduct('Produto Multi-Lote');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 10, lote: 'A' }] });
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 15, lote: 'B' }] });
  assert.equal(await stockOf(prod), 25);
});

test('saída simples baixa o estoque disponível', async () => {
  const prod = await createTestProduct('Produto Saída Simples');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 20 }] });
  const { status } = await post('/api/stock/exits', { motorista: 'M', cliente: 'C', nfs: [{ numero: '1', itens: [{ produtoId: prod, quantidade: 8 }] }] });
  assert.equal(status, 200);
  assert.equal(await stockOf(prod), 12);
});

test('saída sem estoque suficiente é rejeitada (409) e nada muda', async () => {
  const prod = await createTestProduct('Produto Sem Estoque');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 5 }] });
  const { status, body } = await post('/api/stock/exits', { motorista: 'M', cliente: 'C', nfs: [{ numero: '1', itens: [{ produtoId: prod, quantidade: 100 }] }] });
  assert.equal(status, 409);
  assert.match(body.error, /insuficiente/i);
  assert.equal(await stockOf(prod), 5);
});

test('saída com múltiplos produtos e falha em um deles não baixa NADA (atomicidade)', async () => {
  const prodA = await createTestProduct('Atomicidade A');
  const prodB = await createTestProduct('Atomicidade B');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prodA, quantidade: 20 }] });
  // prodB fica sem estoque nenhum
  const { status } = await post('/api/stock/exits', {
    motorista: 'M', cliente: 'C',
    nfs: [{ numero: '1', itens: [{ produtoId: prodA, quantidade: 10 }, { produtoId: prodB, quantidade: 5 }] }]
  });
  assert.equal(status, 409);
  assert.equal(await stockOf(prodA), 20, 'produto A não deveria ter sido tocado');
  assert.equal(await stockOf(prodB), 0);
});

test('FEFO: consome primeiro o lote que vence mais cedo', async () => {
  const prod = await createTestProduct('Produto FEFO');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 10, lote: 'VENCE-TARDE', validade: '2099-01-01' }] });
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 10, lote: 'VENCE-CEDO', validade: '2090-01-01' }] });
  const { body: exit } = await post('/api/stock/exits', { motorista: 'M', cliente: 'C', nfs: [{ numero: '1', itens: [{ produtoId: prod, quantidade: 10 }] }] });
  const consumido = exit.nfs[0].itens[0].lotesConsumidos;
  assert.equal(consumido.length, 1);
  assert.equal(consumido[0].lote, 'VENCE-CEDO');
});

test('lote vencido nunca é usado em saída normal', async () => {
  const prod = await createTestProduct('Produto Vencido');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 10, lote: 'VENCIDO', validade: '2020-01-01' }] });
  const { status, body } = await post('/api/stock/exits', { motorista: 'M', cliente: 'C', nfs: [{ numero: '1', itens: [{ produtoId: prod, quantidade: 5 }] }] });
  assert.equal(status, 409, 'não deveria conseguir vender, pois o único lote está vencido');
});

test('retorno TOTAL de uma NF vira backlog e bloqueia o estoque', async () => {
  const prod = await createTestProduct('Retorno Total');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 10 }] });
  const { body: exit } = await post('/api/stock/exits', { motorista: 'M', cliente: 'C', nfs: [{ numero: 'RT1', itens: [{ produtoId: prod, quantidade: 10 }] }] });
  const { status } = await post('/api/stock/backlog/return', { exitId: exit.id, motivo: 'teste', retornos: [{ nfNumero: 'RT1', produtoId: prod, quantidade: 10 }] });
  assert.equal(status, 200);
  assert.equal(await stockOf(prod, 'quantidadeDisponivel'), 0);
  assert.equal(await stockOf(prod, 'quantidadeBloqueada'), 10);
});

test('retorno PARCIAL distribui exatamente pelos lotes originais (soma sempre bate)', async () => {
  const prod = await createTestProduct('Retorno Parcial');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 6, lote: 'L1', validade: '2090-01-01' }] });
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 4, lote: 'L2', validade: '2091-01-01' }] });
  const { body: exit } = await post('/api/stock/exits', { motorista: 'M', cliente: 'C', nfs: [{ numero: 'RP1', itens: [{ produtoId: prod, quantidade: 10 }] }] });
  const { status, body: backlogs } = await post('/api/stock/backlog/return', { exitId: exit.id, motivo: 'parcial', retornos: [{ nfNumero: 'RP1', produtoId: prod, quantidade: 5 }] });
  assert.equal(status, 200);
  const somaDevolvida = backlogs.reduce((a, b) => a + b.quantidade, 0);
  const somaLotes = backlogs.reduce((a, b) => a + b.lotesConsumidos.reduce((x, l) => x + l.quantidade, 0), 0);
  assert.equal(somaDevolvida, 5);
  assert.equal(somaLotes, 5);
});

test('retorno por NF: só a NF selecionada vira backlog, a outra continua entregue', async () => {
  const prodA = await createTestProduct('NF Teste A');
  const prodB = await createTestProduct('NF Teste B');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prodA, quantidade: 10 }] });
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prodB, quantidade: 20 }] });
  const { body: exit } = await post('/api/stock/exits', {
    motorista: 'M', cliente: 'C',
    nfs: [{ numero: '100', itens: [{ produtoId: prodA, quantidade: 10 }] }, { numero: '101', itens: [{ produtoId: prodB, quantidade: 20 }] }]
  });
  await post('/api/stock/backlog/return', { exitId: exit.id, motivo: 'teste', retornos: [{ nfNumero: '101', produtoId: prodB, quantidade: 20 }] });
  const { body: exitDepois } = await get(`/api/exits/${exit.id}`);
  const nf100 = exitDepois.nfs.find(n => n.numero === '100');
  const nf101 = exitDepois.nfs.find(n => n.numero === '101');
  assert.equal(nf100.status, 'entregue');
  assert.equal(nf101.status, 'pendente');
});

test('reentrega baixa o BLOQUEADO e não mexe no disponível', async () => {
  const prod = await createTestProduct('Reentrega Teste');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 20 }] });
  const { body: exit } = await post('/api/stock/exits', { motorista: 'M', cliente: 'C', nfs: [{ numero: '1', itens: [{ produtoId: prod, quantidade: 10 }] }] });
  const { body: backlogs } = await post('/api/stock/backlog/return', { exitId: exit.id, motivo: 't', retornos: [{ nfNumero: '1', produtoId: prod, quantidade: 10 }] });
  const dispAntes = await stockOf(prod, 'quantidadeDisponivel');
  const { status } = await post('/api/stock/backlog/redelivery', { backlogIds: [backlogs[0].id], motorista: 'M2' });
  assert.equal(status, 200);
  assert.equal(await stockOf(prod, 'quantidadeDisponivel'), dispAntes, 'disponível não deveria mudar na reentrega');
  assert.equal(await stockOf(prod, 'quantidadeBloqueada'), 0);
});

test('liberação de backlog baixa o bloqueado SEM aumentar o disponível', async () => {
  const prod = await createTestProduct('Liberacao Teste');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 20 }] });
  const { body: exit } = await post('/api/stock/exits', { motorista: 'M', cliente: 'C', nfs: [{ numero: '1', itens: [{ produtoId: prod, quantidade: 10 }] }] });
  const { body: backlogs } = await post('/api/stock/backlog/return', { exitId: exit.id, motivo: 't', retornos: [{ nfNumero: '1', produtoId: prod, quantidade: 10 }] });
  const dispAntes = await stockOf(prod, 'quantidadeDisponivel');
  const { status } = await post('/api/stock/backlog/release', { backlogIds: [backlogs[0].id], motivo: 'baixa' });
  assert.equal(status, 200);
  assert.equal(await stockOf(prod, 'quantidadeDisponivel'), dispAntes);
  assert.equal(await stockOf(prod, 'quantidadeBloqueada'), 0);
});

test('perda registra e baixa do estoque disponível', async () => {
  const prod = await createTestProduct('Perda Teste');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 15 }] });
  const { status } = await post('/api/stock/losses', { produtoId: prod, quantidade: 5, motivo: 'Produto quebrado' });
  assert.equal(status, 200);
  assert.equal(await stockOf(prod), 10);
});

test('inventário com divergência gera ajuste identificado (rastreável no histórico)', async () => {
  const prod = await createTestProduct('Inventario Teste');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 10 }] });
  const { status, body: inv } = await post('/api/stock/inventory-adjustment', {
    itens: [{ produtoId: prod, esperadoDisponivel: 10, contadoDisponivel: 7, esperadoBloqueado: 0, contadoBloqueado: 0 }]
  });
  assert.equal(status, 200);
  assert.equal(await stockOf(prod), 7);
  const { body: history } = await get('/api/history');
  const registro = history.find(h => h.tipo === 'inventario' && h.produtoNome === 'Inventario Teste');
  assert.ok(registro, 'deveria existir um registro de histórico do tipo inventario');
  assert.ok(registro.observacoes.includes(inv.id), 'o histórico deveria referenciar o ID do inventário de origem');
});

test('inventário com SOBRA (contado maior que o esperado) cria lote de ajuste identificado', async () => {
  const prod = await createTestProduct('Inventario Sobra');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 5 }] });
  const { status, body: inv } = await post('/api/stock/inventory-adjustment', {
    itens: [{ produtoId: prod, esperadoDisponivel: 5, contadoDisponivel: 9, esperadoBloqueado: 0, contadoBloqueado: 0 }]
  });
  assert.equal(status, 200);
  assert.equal(await stockOf(prod), 9);
  const { body: lots } = await get('/api/lots');
  const ajuste = lots.find(l => l.productId === prod && l.lote.includes(inv.id.slice(-6).toUpperCase()));
  assert.ok(ajuste, 'o lote de sobra deveria referenciar o inventário de origem no próprio código do lote');
});

test('NF-e com a mesma chave não pode ser importada duas vezes', async () => {
  const prod = await createTestProduct('NFe Duplicada');
  const payload = { fornecedor: 'F', chaveNFe: 'CHAVE-UNICA-TESTE', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 5 }] };
  const r1 = await post('/api/stock/entries', payload);
  const r2 = await post('/api/stock/entries', { ...payload, itens: [{ produtoId: prod, quantidade: 999 }] });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 409);
  assert.equal(await stockOf(prod), 5, 'a segunda tentativa não deveria ter alterado nada');
});

test('produto desativado não pode ser excluído fisicamente após ter movimentação', async () => {
  const prod = await createTestProduct('Produto Desativado');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 5 }] });
  const { status: statusDeact } = await post(`/api/stock/products/${prod}/deactivate`, {});
  assert.equal(statusDeact, 200);
  const { status: statusDel } = await del(`/api/products/${prod}`);
  assert.equal(statusDel, 409);
});

test('idempotência: mesma operationId enviada duas vezes só executa uma vez', async () => {
  const prod = await createTestProduct('Idempotencia Teste');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 50 }] });
  const opId = 'op-teste-fixo-' + prod;
  const r1 = await post('/api/stock/losses', { operationId: opId, produtoId: prod, quantidade: 3, motivo: 'Produto quebrado' });
  const r2 = await post('/api/stock/losses', { operationId: opId, produtoId: prod, quantidade: 3, motivo: 'Produto quebrado' });
  assert.equal(r1.body.id, r2.body.id, 'deveria devolver o mesmo resultado, não criar de novo');
  assert.equal(await stockOf(prod), 47, 'só deveria ter baixado uma vez (50-3), não duas (50-6)');
});

test('estoque nunca fica negativo mesmo tentando saída maior que o disponível', async () => {
  const prod = await createTestProduct('Nunca Negativo');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 10 }] });
  await post('/api/stock/exits', { motorista: 'M', cliente: 'C', nfs: [{ numero: '1', itens: [{ produtoId: prod, quantidade: 999 }] }] });
  const estoque = await stockOf(prod);
  assert.ok(estoque >= 0, `estoque não pode ser negativo, era ${estoque}`);
  assert.equal(estoque, 10);
});

test('CONCORRÊNCIA: duas saídas simultâneas de 15 num estoque de 20 — só uma pode ter sucesso', async () => {
  const prod = await createTestProduct('Concorrencia Teste');
  await post('/api/stock/entries', { fornecedor: 'F', data: '2026-01-01', itens: [{ produtoId: prod, quantidade: 20 }] });

  const [r1, r2] = await Promise.all([
    post('/api/stock/exits', { motorista: 'A', cliente: 'C', nfs: [{ numero: 'CC1', itens: [{ produtoId: prod, quantidade: 15 }] }] }),
    post('/api/stock/exits', { motorista: 'B', cliente: 'C', nfs: [{ numero: 'CC2', itens: [{ produtoId: prod, quantidade: 15 }] }] })
  ]);

  const sucessos = [r1, r2].filter(r => r.status === 200).length;
  const falhas = [r1, r2].filter(r => r.status === 409).length;
  assert.equal(sucessos, 1, 'exatamente uma das duas deveria ter sucesso');
  assert.equal(falhas, 1, 'exatamente uma das duas deveria falhar com estoque insuficiente');
  assert.equal(await stockOf(prod), 5);
});

test('CRUD genérico bloqueia escrita direta em coleções críticas (lots, exits, entries...)', async () => {
  const r1 = await put('/api/lots/algum-id', { quantidadeDisponivel: 99999 });
  assert.equal(r1.status, 403);
  const r2 = await put('/api/exits/algum-id', {});
  assert.equal(r2.status, 403);
  const r3 = await put('/api/history/algum-id', {});
  assert.equal(r3.status, 403);
});

test('backup/restore: restauração inválida não apaga os dados existentes', async () => {
  const before = await get('/api/backup');
  const r = await post('/api/restore', { lots: 'não deveria ser uma string' });
  assert.equal(r.status, 400);
  const after = await get('/api/backup');
  assert.equal(after.body.products.length, before.body.products.length);
});
