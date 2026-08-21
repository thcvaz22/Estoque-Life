/* ============================================================
   SERVER/DB.JS — camada de persistência em SQLite
   Mudança da Etapa 3: "lots" deixou de ser um JSON genérico e
   virou tabela relacional de verdade, com CHECK (>= 0) nas
   colunas de quantidade — o banco em si recusa qualquer escrita
   que resultasse em estoque negativo, além da validação em
   inventoryService.js. Demais coleções continuam como
   documento JSON (id, json, updatedAt), que é suficiente para
   elas (não têm o mesmo risco de concorrência sobre quantidade).
   ============================================================ */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const CLOUD_MODE = String(process.env.CLOUD_MODE || '').toLowerCase() === 'true' || !!process.env.RENDER;
// v17: em nuvem o SQLite é somente cache transacional efêmero. A persistência
// autoritativa fica no Neon; por isso não dependemos de disco pago no Render.
const DATA_DIR = process.env.LIFESUCOS_DATA_DIR || (CLOUD_MODE ? path.join(os.tmpdir(), 'life-sucos') : path.join(__dirname, '..', 'data'));
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'lifesucos.db');
const isNewDatabase = !fs.existsSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// v18: no servidor local priorizamos durabilidade a alguns milissegundos de
// desempenho. FULL reduz o risco de perder commits já confirmados em uma
// queda abrupta de energia/SO. Na nuvem efêmera, o Neon continua sendo a
// persistência durável e NORMAL evita fsync desnecessário no cache.
db.pragma(`synchronous = ${CLOUD_MODE ? 'NORMAL' : 'FULL'}`);
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// Coleções "documento" — CRUD genérico simples ainda faz sentido para elas
// como LEITURA. Escrita genérica só é permitida para as marcadas em
// GENERIC_WRITABLE (products, meta) — as demais só podem ser alteradas
// pelos endpoints de server/stockRoutes.js (server/services/inventoryService.js),
// dentro de transação, com FEFO/validação/histórico.
const STORES = ['products', 'entries', 'exits', 'backlog', 'losses', 'inventories', 'history', 'meta', 'customers', 'suppliers', 'priceTables', 'orders', 'shippingManifests', 'costHistory', 'fiscalInvoices'];
const GENERIC_WRITABLE = ['products', 'meta', 'customers', 'suppliers'];

for (const store of STORES) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${store} (id TEXT PRIMARY KEY, json TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
}

const LOTS_DDL = `CREATE TABLE lots (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  lote TEXT NOT NULL,
  fabricacao TEXT,
  validade TEXT,
  quantidadeDisponivel INTEGER NOT NULL DEFAULT 0 CHECK (quantidadeDisponivel >= 0),
  quantidadeBloqueada INTEGER NOT NULL DEFAULT 0 CHECK (quantidadeBloqueada >= 0),
  localizacao TEXT,
  updatedAt TEXT NOT NULL
)`;

function ensureLotsTable() {
  const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='lots'`).get();
  if (!tableExists) {
    db.exec(LOTS_DDL);
  } else {
    const cols = db.prepare(`PRAGMA table_info(lots)`).all().map(c => c.name);
    const isOldJsonSchema = cols.includes('json') && !cols.includes('productId');
    if (isOldJsonSchema) {
      // Migração do schema da Etapa 2 (lots como JSON genérico) para a
      // tabela relacional da Etapa 3. Os dados antigos são preservados
      // em "lots_old_backup" por segurança (nunca apagados automaticamente).
      const oldRows = db.prepare('SELECT json FROM lots').all().map(r => JSON.parse(r.json));
      db.exec('ALTER TABLE lots RENAME TO lots_old_backup');
      db.exec(LOTS_DDL);
      const insert = db.prepare(`INSERT INTO lots (id, productId, lote, fabricacao, validade, quantidadeDisponivel, quantidadeBloqueada, localizacao, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const now = new Date().toISOString();
      for (const l of oldRows) {
        if (!l.id || !l.productId) continue;
        insert.run(
          l.id, l.productId, l.lote || 'SEM-LOTE', l.fabricacao || null, l.validade || null,
          Math.max(0, Number(l.quantidadeDisponivel) || 0), Math.max(0, Number(l.quantidadeBloqueada) || 0),
          l.localizacao || '', now
        );
      }
      console.log(`   [migração] ${oldRows.length} lote(s) migrado(s) do formato antigo para a nova tabela relacional.`);
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lots_product ON lots(productId)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lots_validade ON lots(validade)`);
}
ensureLotsTable();

// Fila de idempotência: cada operação crítica pode informar um operationId;
// se o mesmo operationId chegar de novo (duplo clique, retry de rede), o
// resultado salvo é devolvido em vez de repetir a operação.
db.exec(`CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, result TEXT NOT NULL, createdAt TEXT NOT NULL)`);

// Reservas comerciais: impedem que dois vendedores comprometam o mesmo estoque.
db.exec(`CREATE TABLE IF NOT EXISTS stock_reservations (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL,
  productId TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_reservations_product ON stock_reservations(productId, status)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_reservations_order ON stock_reservations(orderId, status)`);


function isValidStore(store) {
  return STORES.includes(store);
}
function isGenericWritable(store) {
  return GENERIC_WRITABLE.includes(store);
}

const _cache = { all: {}, one: {}, upsert: {}, del: {}, clear: {} };
function stmt(cacheKey, store, sql) {
  const bucket = _cache[cacheKey];
  if (!bucket[store]) bucket[store] = db.prepare(sql);
  return bucket[store];
}

// CRUD genérico sobre coleções "documento" (products, entries, exits,
// backlog, losses, inventories, history, meta). Continua existindo para
// LEITURA de todas elas, e para ESCRITA apenas das GENERIC_WRITABLE.
const Data = {
  all(store) {
    const rows = stmt('all', store, `SELECT json FROM ${store} ORDER BY updatedAt ASC`).all();
    return rows.map(r => JSON.parse(r.json));
  },
  get(store, id) {
    const row = stmt('one', store, `SELECT json FROM ${store} WHERE id = ?`).get(id);
    return row ? JSON.parse(row.json) : null;
  },
  upsert(store, id, obj) {
    const now = new Date().toISOString();
    stmt('upsert', store, `INSERT INTO ${store} (id, json, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, updatedAt = excluded.updatedAt`).run(id, JSON.stringify(obj), now);
    return obj;
  },
  remove(store, id) {
    stmt('del', store, `DELETE FROM ${store} WHERE id = ?`).run(id);
    return true;
  },
  clear(store) {
    stmt('clear', store, `DELETE FROM ${store}`).run();
  }
};

function seedIfNewDatabase() {
  const { makeCatalog, productNameWithVolume, volumeToMl } = require('./catalog');
  const now = new Date().toISOString();
  const existing = Data.all('products');
  const byCode = new Map(existing.filter(p => p.codigoInterno).map(p => [String(p.codigoInterno), p]));
  let inserted = 0;
  // Garante o catálogo oficial também ao atualizar uma instalação existente,
  // sem sobrescrever cadastros que o usuário já tenha editado.
  for (const p of makeCatalog(now)) {
    if (byCode.has(String(p.codigoInterno))) continue;
    Data.upsert('products', p.id, p);
    inserted++;
  }
  if (inserted) console.log(`   [catálogo] ${inserted} produto(s) Life Sucos adicionado(s), todos com estoque inicial zerado.`);

  // v17.1 — padronização visual do catálogo. O código/ID do produto nunca é
  // alterado: apenas acrescentamos a litragem convertida para ml ao nome dos
  // produtos oficiais já existentes. Isso preserva lotes, estoque, histórico,
  // preços e pedidos vinculados por produtoId.
  const officialByCode = new Map(makeCatalog(now).map(p => [String(p.codigoInterno), p]));
  let renamedWithMl = 0;
  for (const current of existing) {
    const official = officialByCode.get(String(current.codigoInterno || ''));
    if (!official) continue;
    const desiredName = productNameWithVolume(current.nome || official.nome, official.volume);
    const desiredMl = volumeToMl(official.volume);
    let changed = false;
    if (desiredName && current.nome !== desiredName) { current.nome = desiredName; changed = true; }
    if (desiredMl && Number(current.volumeMl || 0) !== desiredMl) { current.volumeMl = desiredMl; changed = true; }
    if (changed) { Data.upsert('products', current.id, current); renamedWithMl++; }
  }
  if (renamedWithMl) console.log(`   [catálogo v17.1] ${renamedWithMl} produto(s) padronizado(s) com volume em ml no nome.`);

  // Aproveita dados já existentes para montar catálogos simples de clientes
  // e fornecedores usados pela AION IA e pelos campos com sugestão automática.
  const customerNames = new Set();
  for (const e of Data.all('exits')) {
    if (e.cliente) customerNames.add(String(e.cliente).trim());
    for (const nf of (e.nfs || [])) if (nf.cliente) customerNames.add(String(nf.cliente).trim());
  }
  const supplierNames = new Set(Data.all('entries').map(e => String(e.fornecedor || '').trim()).filter(Boolean));

  const customerExisting = new Set(Data.all('customers').map(x => String(x.nome || '').trim().toLowerCase()));
  const supplierExisting = new Set(Data.all('suppliers').map(x => String(x.nome || '').trim().toLowerCase()));
  let cInserted = 0, sInserted = 0;
  for (const nome of customerNames) {
    if (!nome || customerExisting.has(nome.toLowerCase())) continue;
    const id = `cli_seed_${Buffer.from(nome).toString('hex').slice(0,16)}`;
    Data.upsert('customers', id, { id, nome, ativo:true, origem:'histórico', criadoEm:now });
    customerExisting.add(nome.toLowerCase()); cInserted++;
  }
  for (const nome of supplierNames) {
    if (!nome || supplierExisting.has(nome.toLowerCase())) continue;
    const id = `forn_seed_${Buffer.from(nome).toString('hex').slice(0,16)}`;
    Data.upsert('suppliers', id, { id, nome, ativo:true, origem:'histórico', criadoEm:now });
    supplierExisting.add(nome.toLowerCase()); sInserted++;
  }
  if (cInserted || sInserted) console.log(`   [cadastros] ${cInserted} cliente(s) e ${sInserted} fornecedor(es) aproveitados do histórico.`);

  // v18.1 — pré-cadastro das carteiras enviadas pela Life. Os registros
  // entram incompletos e NÃO ficam disponíveis para pedido até a operação
  // complementar os dados e aprovar/classificar o cliente.
  const { CUSTOMER_PORTFOLIOS } = require('./preseedV18_1');
  const byCustomerName = new Map(Data.all('customers').map(c => [String(c.nome || c.nomeFantasia || c.razaoSocial || '').trim().toLowerCase(), c]));
  let preRegistered = 0, enriched = 0;
  for (const portfolio of CUSTOMER_PORTFOLIOS) {
    const seller = db.prepare(`SELECT id,username,nome,perfil,ativo FROM users
      WHERE perfil='Vendedor' AND ativo=1 AND (username=? COLLATE NOCASE OR nome=? COLLATE NOCASE)
      ORDER BY CASE WHEN username=? COLLATE NOCASE THEN 0 ELSE 1 END LIMIT 1`)
      .get(portfolio.sellerUsername, portfolio.sellerName, portfolio.sellerUsername);
    if (!seller) {
      console.warn(`   [v18.1] Vendedor não encontrado para carteira: ${portfolio.sellerName}`);
      continue;
    }
    for (const item of portfolio.customers) {
      const key = String(item.nome || '').trim().toLowerCase();
      if (!key) continue;
      const existingCustomer = byCustomerName.get(key);
      if (existingCustomer) {
        let changed = false;
        if (!existingCustomer.vendedorId) {
          existingCustomer.vendedorId = seller.id;
          existingCustomer.vendedorNome = seller.nome;
          changed = true;
        }
        if (!existingCustomer.ultimaCompra || String(item.ultimaCompra) > String(existingCustomer.ultimaCompra)) {
          existingCustomer.ultimaCompra = item.ultimaCompra;
          changed = true;
        }
        if (!existingCustomer.origemCarteira) {
          existingCustomer.origemCarteira = 'relatorio_ultimo_pedido_2026-08-20';
          changed = true;
        }
        if (changed) {
          Data.upsert('customers', existingCustomer.id, existingCustomer);
          enriched++;
        }
        continue;
      }

      const id = 'cli_pre_' + crypto.createHash('sha256')
        .update(`${portfolio.sellerUsername}|${item.nome}`,'utf8').digest('hex').slice(0,24);
      const customer = {
        id,
        nome: item.nome,
        nomeFantasia: item.nome,
        razaoSocial: '',
        cnpj: '',
        inscricaoEstadual: '',
        telefone: '',
        whatsapp: '',
        email: '',
        endereco: '',
        bairro: '',
        cidade: '',
        uf: '',
        regiao: '',
        fornecedor: '',
        observacoes: 'Pré-cadastro criado a partir do relatório de último pedido. Aguardando dados cadastrais complementares.',
        vendedorId: seller.id,
        vendedorNome: seller.nome,
        ultimaCompra: item.ultimaCompra,
        statusAprovacao: 'pre_cadastro',
        classificacao: null,
        tabelaPrecoId: null,
        cadastroIncompleto: true,
        dadosPendentes: ['cnpj','contato','endereco','classificacao','tabelaPreco'],
        ativo: true,
        origem: 'relatorio_ultimo_pedido',
        origemCarteira: 'relatorio_ultimo_pedido_2026-08-20',
        criadoEm: now,
        criadoPor: 'Importação v18.1'
      };
      Data.upsert('customers', id, customer);
      byCustomerName.set(key, customer);
      preRegistered++;
    }
  }
  if (preRegistered || enriched) console.log(`   [v18.1] ${preRegistered} cliente(s) pré-cadastrado(s); ${enriched} cadastro(s) existente(s) enriquecido(s).`);

  // Tabelas comerciais padrão. Os preços começam zerados e podem ser
  // preenchidos pela equipe comercial sem recriar a estrutura.
  const existingTables = Data.all('priceTables');
  const tableNames = new Set(existingTables.map(t => String(t.nome || '').toLowerCase()));
  for (const nome of ['Tabela 01', 'Tabela 02', 'Tabela 03']) {
    if (tableNames.has(nome.toLowerCase())) continue;
    const id = `price_${nome.replace(/\D/g,'') || 'base'}`;
    Data.upsert('priceTables', id, { id, nome, tipo:'padrao', ativo:true, precos:{}, criadoEm:now, atualizadoEm:now });
  }

  // Cadastros legados passam a ser tratados como aprovados para não bloquear
  // a operação já existente. Novos cadastros do app de vendas entram pendentes.
  for (const c of Data.all('customers')) {
    let changed = false;
    if (!c.statusAprovacao) { c.statusAprovacao = 'aprovado'; changed = true; }
    if (!c.classificacao && c.statusAprovacao !== 'pre_cadastro') { c.classificacao = 'Verde'; changed = true; }
    if (c.ativo === undefined) { c.ativo = true; changed = true; }
    if (changed) Data.upsert('customers', c.id, c);
  }

}

module.exports = { db, Data, STORES, GENERIC_WRITABLE, isValidStore, isGenericWritable, isNewDatabase, DB_PATH, DATA_DIR, seedIfNewDatabase };
