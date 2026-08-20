/* ============================================================
   SERVER/REMOTEQUERIES.JS — dados do Painel do Gerente
   Abre o MESMO arquivo data/lifesucos.db, mas numa conexão
   separada em modo { readonly: true } — o SQLite recusa
   fisicamente qualquer tentativa de escrita nessa conexão,
   nem que houvesse um bug aqui. O SQLite (modo WAL, já ligado
   pelo server/db.js principal) suporta múltiplos leitores ao
   mesmo tempo que o processo principal escreve, sem conflito.
   Este arquivo NÃO importa services/inventoryService.js nem
   nada que grave dados — de propósito.
   ============================================================ */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { todayLocalISO } = require('./time');

const DATA_DIR = process.env.LIFESUCOS_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'lifesucos.db');

let _db = null;
function getReadonlyDb() {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) throw new Error('Banco de dados ainda não existe (o servidor principal precisa ter rodado ao menos uma vez).');
  _db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return _db;
}

function allDocs(store) {
  const db = getReadonlyDb();
  return db.prepare(`SELECT json FROM ${store}`).all().map(r => JSON.parse(r.json));
}
function allLots() {
  const db = getReadonlyDb();
  return db.prepare(`SELECT * FROM lots`).all();
}

function daysUntil(dateISO) {
  if (!dateISO) return null;
  const target = new Date(dateISO + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

/* Monta o resumo inteiro do painel numa única chamada — é o que
   o frontend do gerente busca a cada atualização (15-30s). */
function buildManagerSummary() {
  const products = allDocs('products').filter(p => p.ativo !== false);
  const lots = allLots();
  const exits = allDocs('exits');
  const backlog = allDocs('backlog');
  const losses = allDocs('losses');
  const history = allDocs('history');

  const byProduct = {};
  for (const l of lots) {
    if (!byProduct[l.productId]) byProduct[l.productId] = { disponivel: 0, bloqueado: 0 };
    byProduct[l.productId].disponivel += l.quantidadeDisponivel;
    byProduct[l.productId].bloqueado += l.quantidadeBloqueada;
  }

  let estoqueDisponivel = 0, estoqueBloqueado = 0;
  const estoqueBaixo = [];
  const produtosZerados = [];
  for (const p of products) {
    const s = byProduct[p.id] || { disponivel: 0, bloqueado: 0 };
    estoqueDisponivel += s.disponivel;
    estoqueBloqueado += s.bloqueado;
    if (s.disponivel === 0) produtosZerados.push({ nome: p.nome });
    else if (s.disponivel < (p.estoqueMinimo || 0)) estoqueBaixo.push({ nome: p.nome, disponivel: s.disponivel, minimo: p.estoqueMinimo });
  }

  const produtoPorId = Object.fromEntries(products.map(p => [p.id, p]));
  const proximosVencimento = lots
    .filter(l => l.validade && l.quantidadeDisponivel > 0)
    .map(l => ({ produto: produtoPorId[l.productId] ? produtoPorId[l.productId].nome : '—', lote: l.lote, validade: l.validade, dias: daysUntil(l.validade), quantidade: l.quantidadeDisponivel }))
    .filter(l => l.dias !== null && l.dias <= 30)
    .sort((a, b) => a.dias - b.dias)
    .slice(0, 15);

  const backlogPendente = backlog.filter(b => b.status === 'bloqueado');

  const motoristasEmRota = exits
    .filter(e => e.status === 'em_rota')
    .map(e => ({ motorista: e.motorista, cliente: e.cliente, placa: e.placa, horarioSaida: e.horarioSaida, nfs: e.nfs.map(n => n.numero) }));

  let nfsPendentes = 0;
  for (const e of exits) for (const nf of e.nfs) if (nf.status !== 'entregue') nfsPendentes++;

  const entregasConcluidas = exits.filter(e => e.status === 'concluida').length;

  const today = todayLocalISO();
  const avariasRecentes = losses
    .slice()
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''))
    .slice(0, 10)
    .map(l => ({ produto: l.produtoNome, quantidade: l.quantidade, motivo: l.motivo, data: l.data }));
  const totalAvarias30d = losses.filter(l => (daysUntil(l.data) ?? -999) >= -30).reduce((a, l) => a + Number(l.quantidade || 0), 0);

  const ultimasMovimentacoes = history
    .slice()
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, 20)
    .map(h => ({ timestamp: h.timestamp, tipo: h.tipo, produto: h.produtoNome, quantidade: h.quantidade, usuario: h.usuario, motivo: h.motivo }));

  return {
    geradoEm: new Date().toISOString(),
    estoqueDisponivel, estoqueBloqueado,
    estoqueBaixo, produtosZerados, proximosVencimento,
    backlogPendente: { total: backlogPendente.length, unidades: backlogPendente.reduce((a, b) => a + Number(b.quantidade || 0), 0), itens: backlogPendente.slice(0, 15).map(b => ({ produto: b.produtoNome, quantidade: b.quantidade, cliente: b.cliente, nf: b.nf, motivo: b.motivo })) },
    motoristasEmRota, nfsPendentes, entregasConcluidas,
    avarias: { total30d: totalAvarias30d, recentes: avariasRecentes },
    ultimasMovimentacoes
  };
}

module.exports = { buildManagerSummary };
