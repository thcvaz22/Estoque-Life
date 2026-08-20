/* ============================================================
   CLOUD PERSISTENCE — v17

   No Render Free o filesystem e efêmero. O Neon PostgreSQL passa a ser a
   fonte persistente/autoritativa da operação. O SQLite continua existindo
   apenas como cache transacional local da instância Node para preservar as
   regras síncronas e já validadas de FEFO, estoque e idempotência.

   Garantias:
   - ao iniciar em nuvem, o cache SQLite é reconstruído a partir do Neon;
   - toda resposta de escrita da API aguarda a confirmação do snapshot no Neon;
   - exclusões também são sincronizadas (não apenas upserts);
   - fotos, XMLs e PDFs gerenciados pelo sistema são persistidos no Neon;
   - falhas de sincronização deixam a operação marcada para retry e a API
     responde 503 em vez de afirmar que a gravação foi confirmada;
   - SIGTERM tenta uma última sincronização antes de encerrar.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, STORES, DATA_DIR } = require('./db');
const { neonEnabled, getNeonPool } = require('./neon');

const CLOUD_MODE = String(process.env.CLOUD_MODE || '').toLowerCase() === 'true' || !!process.env.RENDER;
const DOC_TABLE = Object.freeze({
  products: 'products',
  entries: 'entries',
  exits: 'exits',
  backlog: 'backlog',
  losses: 'losses',
  inventories: 'inventories',
  history: 'history',
  meta: 'meta',
  customers: 'customers',
  suppliers: 'suppliers',
  priceTables: 'pricetables',
  orders: 'orders',
  shippingManifests: 'shippingmanifests',
  costHistory: 'costhistory',
  fiscalInvoices: 'fiscalinvoices'
});

const MANAGED_FILE_ROOTS = ['nf-photos', 'fiscal'];
const RETRY_MS = Math.max(3000, Number(process.env.NEON_RETRY_MS || 5000));
const BATCH_SIZE = 100;

let chain = Promise.resolve();
let retryTimer = null;
let dirty = false;
let state = {
  enabled: CLOUD_MODE && neonEnabled(),
  mode: CLOUD_MODE ? 'neon-primary+ephemeral-sqlite-cache' : 'sqlite-local',
  restoring: false,
  restoredAt: null,
  lastFlushAt: null,
  lastAttemptAt: null,
  lastError: null,
  dirty: false,
  lastReason: null,
  lastCounts: null
};

function cloudPersistenceEnabled() {
  return CLOUD_MODE && neonEnabled();
}

function getCloudPersistenceStatus() {
  return { ...state, dirty };
}

function qmarks(n) { return Array.from({ length: n }, (_, i) => '$' + (i + 1)); }
function chunks(rows, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function managedFilesSnapshot() {
  const rows = [];
  for (const root of MANAGED_FILE_ROOTS) {
    const base = path.join(DATA_DIR, root);
    if (!fs.existsSync(base)) continue;
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else if (st.isFile()) {
          const relativePath = path.relative(DATA_DIR, full).split(path.sep).join('/');
          const data = fs.readFileSync(full);
          rows.push({
            id: 'att_' + crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 32),
            relativePath,
            mimeType: inferMime(relativePath),
            sha256: crypto.createHash('sha256').update(data).digest('hex'),
            data,
            updatedAt: st.mtime.toISOString()
          });
        }
      }
    };
    walk(base);
  }
  return rows;
}

function inferMime(name) {
  const ext = path.extname(name).toLowerCase();
  return ({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic',
    '.pdf': 'application/pdf', '.xml': 'application/xml', '.txt': 'text/plain'
  })[ext] || 'application/octet-stream';
}

function safeManagedPath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return null;
  if (!MANAGED_FILE_ROOTS.some(root => normalized === root || normalized.startsWith(root + '/'))) return null;
  const full = path.resolve(DATA_DIR, normalized);
  const root = path.resolve(DATA_DIR) + path.sep;
  if (!full.startsWith(root)) return null;
  return full;
}

function localSnapshot() {
  const docs = {};
  for (const store of STORES) {
    docs[store] = db.prepare(`SELECT id, json, updatedAt FROM ${store} ORDER BY updatedAt ASC`).all();
  }
  return {
    docs,
    lots: db.prepare('SELECT * FROM lots').all(),
    operations: db.prepare('SELECT id, result, createdAt FROM operations').all(),
    reservations: db.prepare('SELECT id, orderId, productId, quantity, status, createdAt, updatedAt FROM stock_reservations').all(),
    users: db.prepare('SELECT id, username, nome, perfil, passwordSalt, passwordHash, ativo, createdAt, updatedAt FROM users').all(),
    attachments: managedFilesSnapshot()
  };
}

async function syncExactIds(client, table, ids) {
  if (!ids.length) {
    await client.query(`DELETE FROM ${table}`);
    return;
  }
  await client.query(`DELETE FROM ${table} WHERE NOT (id = ANY($1::text[]))`, [ids]);
}

async function syncDocs(client, store, rows) {
  const table = DOC_TABLE[store];
  if (!table) throw new Error(`Store sem mapeamento PostgreSQL: ${store}`);
  await syncExactIds(client, table, rows.map(r => r.id));
  for (const part of chunks(rows)) {
    const vals = [];
    const groups = [];
    for (const r of part) {
      const base = vals.length;
      vals.push(r.id, r.json, r.updatedAt);
      groups.push(`($${base + 1},$${base + 2},$${base + 3})`);
    }
    await client.query(
      `INSERT INTO ${table} (id,json,updatedat) VALUES ${groups.join(',')}
       ON CONFLICT (id) DO UPDATE SET json=EXCLUDED.json, updatedat=EXCLUDED.updatedat`, vals
    );
  }
  return rows.length;
}

async function syncLots(client, rows) {
  await syncExactIds(client, 'lots', rows.map(r => r.id));
  for (const part of chunks(rows, 50)) {
    const vals = [], groups = [];
    for (const r of part) {
      const base = vals.length;
      vals.push(r.id, r.productId, r.lote, r.fabricacao, r.validade, Number(r.quantidadeDisponivel || 0), Number(r.quantidadeBloqueada || 0), r.localizacao || '', r.updatedAt);
      groups.push(`(${qmarks(9).map((_, i) => '$' + (base + i + 1)).join(',')})`);
    }
    await client.query(
      `INSERT INTO lots (id,productid,lote,fabricacao,validade,quantidadedisponivel,quantidadebloqueada,localizacao,updatedat)
       VALUES ${groups.join(',')}
       ON CONFLICT (id) DO UPDATE SET productid=EXCLUDED.productid,lote=EXCLUDED.lote,fabricacao=EXCLUDED.fabricacao,
       validade=EXCLUDED.validade,quantidadedisponivel=EXCLUDED.quantidadedisponivel,quantidadebloqueada=EXCLUDED.quantidadebloqueada,
       localizacao=EXCLUDED.localizacao,updatedat=EXCLUDED.updatedat`, vals
    );
  }
  return rows.length;
}

async function syncOperations(client, rows) {
  await syncExactIds(client, 'operations', rows.map(r => r.id));
  for (const part of chunks(rows)) {
    const vals = [], groups = [];
    for (const r of part) {
      const base = vals.length; vals.push(r.id, r.result, r.createdAt);
      groups.push(`($${base+1},$${base+2},$${base+3})`);
    }
    await client.query(`INSERT INTO operations (id,result,createdat) VALUES ${groups.join(',')}
      ON CONFLICT(id) DO UPDATE SET result=EXCLUDED.result,createdat=EXCLUDED.createdat`, vals);
  }
  return rows.length;
}

async function syncReservations(client, rows) {
  await syncExactIds(client, 'stock_reservations', rows.map(r => r.id));
  for (const part of chunks(rows, 75)) {
    const vals = [], groups = [];
    for (const r of part) {
      const base = vals.length; vals.push(r.id, r.orderId, r.productId, Number(r.quantity || 0), r.status, r.createdAt, r.updatedAt);
      groups.push(`(${Array.from({length:7},(_,i)=>'$'+(base+i+1)).join(',')})`);
    }
    await client.query(`INSERT INTO stock_reservations (id,orderid,productid,quantity,status,createdat,updatedat) VALUES ${groups.join(',')}
      ON CONFLICT(id) DO UPDATE SET orderid=EXCLUDED.orderid,productid=EXCLUDED.productid,quantity=EXCLUDED.quantity,
      status=EXCLUDED.status,createdat=EXCLUDED.createdat,updatedat=EXCLUDED.updatedat`, vals);
  }
  return rows.length;
}

async function syncUsers(client, rows) {
  // sessions possui FK para users; limpamos primeiro porque a v17 usa sessão
  // stateless assinada e não precisa persistir linhas dessa tabela.
  try { await client.query('DELETE FROM sessions'); } catch (_) {}
  await syncExactIds(client, 'users', rows.map(r => r.id));
  for (const part of chunks(rows, 50)) {
    const vals = [], groups = [];
    for (const r of part) {
      const base = vals.length;
      vals.push(r.id, r.username, r.nome, r.perfil, r.passwordSalt, r.passwordHash, Number(r.ativo || 0), r.createdAt, r.updatedAt);
      groups.push(`(${Array.from({length:9},(_,i)=>'$'+(base+i+1)).join(',')})`);
    }
    await client.query(`INSERT INTO users (id,username,nome,perfil,passwordsalt,passwordhash,ativo,createdat,updatedat) VALUES ${groups.join(',')}
      ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,nome=EXCLUDED.nome,perfil=EXCLUDED.perfil,
      passwordsalt=EXCLUDED.passwordsalt,passwordhash=EXCLUDED.passwordhash,ativo=EXCLUDED.ativo,
      createdat=EXCLUDED.createdat,updatedat=EXCLUDED.updatedat`, vals);
  }
  return rows.length;
}

async function syncAttachments(client, rows) {
  const exists = await client.query("SELECT to_regclass('public.attachments') AS table_name");
  if (!exists.rows[0]?.table_name) throw new Error('Schema v17 incompleto no Neon: tabela attachments ausente.');
  const remote = await client.query('SELECT id, relative_path, sha256 FROM attachments');
  const localIds = rows.map(r => r.id);
  await syncExactIds(client, 'attachments', localIds);
  const byId = new Map(remote.rows.map(r => [r.id, r]));
  let changed = 0;
  for (const r of rows) {
    const old = byId.get(r.id);
    if (old && old.sha256 === r.sha256 && old.relative_path === r.relativePath) continue;
    await client.query(`INSERT INTO attachments (id,relative_path,mime_type,sha256,data,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(id) DO UPDATE SET relative_path=EXCLUDED.relative_path,mime_type=EXCLUDED.mime_type,
      sha256=EXCLUDED.sha256,data=EXCLUDED.data,updated_at=EXCLUDED.updated_at`,
      [r.id, r.relativePath, r.mimeType, r.sha256, r.data, r.updatedAt]);
    changed++;
  }
  return { count: rows.length, changed };
}

async function doFlush(reason = 'mutation') {
  if (!cloudPersistenceEnabled()) return { skipped: true };
  const snapshot = localSnapshot();
  state.lastAttemptAt = new Date().toISOString();
  state.lastReason = reason;
  const pool = getNeonPool();
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query('BEGIN');
    for (const store of STORES) counts[store] = await syncDocs(client, store, snapshot.docs[store]);
    counts.lots = await syncLots(client, snapshot.lots);
    counts.operations = await syncOperations(client, snapshot.operations);
    counts.stock_reservations = await syncReservations(client, snapshot.reservations);
    counts.users = await syncUsers(client, snapshot.users);
    counts.attachments = await syncAttachments(client, snapshot.attachments);
    await client.query('COMMIT');
    dirty = false;
    state.lastFlushAt = new Date().toISOString();
    state.lastError = null;
    state.lastCounts = counts;
    return { ok: true, counts };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    dirty = true;
    state.lastError = err.message;
    scheduleRetry();
    throw err;
  } finally {
    client.release();
  }
}

function flushToNeon(reason = 'mutation') {
  if (!cloudPersistenceEnabled()) return Promise.resolve({ skipped: true });
  const run = chain.then(() => doFlush(reason), () => doFlush(reason));
  chain = run.catch(() => {});
  return run;
}

function queueCloudFlush(reason = 'background') {
  dirty = true;
  state.dirty = true;
  flushToNeon(reason).catch(err => console.error(`[neon-primary] ${reason}:`, err.message));
}

function scheduleRetry() {
  if (retryTimer || !cloudPersistenceEnabled()) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!dirty) return;
    flushToNeon('automatic-retry').catch(err => console.error('[neon-primary] retry:', err.message));
  }, RETRY_MS);
  if (retryTimer.unref) retryTimer.unref();
}

async function restoreFromNeon() {
  if (!CLOUD_MODE) return { skipped: true, reason: 'local mode' };
  if (!neonEnabled()) throw new Error('DATABASE_URL é obrigatório no modo nuvem v17.');
  state.enabled = true;
  state.restoring = true;
  const pool = getNeonPool();
  const client = await pool.connect();
  const snapshot = { docs: {}, lots: [], operations: [], reservations: [], users: [], attachments: [] };
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const store of STORES) {
      const table = DOC_TABLE[store];
      const { rows } = await client.query(`SELECT id,json,updatedat AS "updatedAt" FROM ${table} ORDER BY updatedat ASC`);
      snapshot.docs[store] = rows;
    }
    snapshot.lots = (await client.query(`SELECT id,productid AS "productId",lote,fabricacao,validade,
      quantidadedisponivel AS "quantidadeDisponivel",quantidadebloqueada AS "quantidadeBloqueada",
      localizacao,updatedat AS "updatedAt" FROM lots`)).rows;
    snapshot.operations = (await client.query(`SELECT id,result,createdat AS "createdAt" FROM operations`)).rows;
    snapshot.reservations = (await client.query(`SELECT id,orderid AS "orderId",productid AS "productId",quantity,status,
      createdat AS "createdAt",updatedat AS "updatedAt" FROM stock_reservations`)).rows;
    snapshot.users = (await client.query(`SELECT id,username,nome,perfil,passwordsalt AS "passwordSalt",passwordhash AS "passwordHash",
      ativo,createdat AS "createdAt",updatedat AS "updatedAt" FROM users`)).rows;
    const attachmentSchema = await client.query("SELECT to_regclass('public.attachments') AS table_name");
    if (!attachmentSchema.rows[0]?.table_name) throw new Error('Schema v17 incompleto no Neon: tabela attachments ausente.');
    snapshot.attachments = (await client.query(`SELECT id,relative_path AS "relativePath",mime_type AS "mimeType",sha256,data,
      updated_at AS "updatedAt" FROM attachments ORDER BY relative_path`)).rows;
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    state.lastError = err.message;
    throw err;
  } finally {
    client.release();
  }

  const tx = db.transaction(() => {
    // cloudPersistence é carregado antes de auth.js no boot; portanto criamos
    // a tabela users defensivamente antes de restaurar as contas do Neon.
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, nome TEXT NOT NULL, perfil TEXT NOT NULL,
      passwordSalt TEXT NOT NULL, passwordHash TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )`);
    try { db.prepare('DELETE FROM sessions').run(); } catch (_) {}
    for (const store of STORES) db.prepare(`DELETE FROM ${store}`).run();
    db.prepare('DELETE FROM stock_reservations').run();
    db.prepare('DELETE FROM operations').run();
    db.prepare('DELETE FROM lots').run();
    db.prepare('DELETE FROM users').run();

    for (const store of STORES) {
      const ins = db.prepare(`INSERT INTO ${store} (id,json,updatedAt) VALUES (?,?,?)`);
      for (const r of snapshot.docs[store] || []) ins.run(r.id, r.json, r.updatedAt);
    }
    const lotIns = db.prepare(`INSERT INTO lots (id,productId,lote,fabricacao,validade,quantidadeDisponivel,quantidadeBloqueada,localizacao,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const r of snapshot.lots) lotIns.run(r.id,r.productId,r.lote,r.fabricacao,r.validade,Number(r.quantidadeDisponivel||0),Number(r.quantidadeBloqueada||0),r.localizacao||'',r.updatedAt);
    const opIns = db.prepare('INSERT INTO operations (id,result,createdAt) VALUES (?,?,?)');
    for (const r of snapshot.operations) opIns.run(r.id,r.result,r.createdAt);
    const resIns = db.prepare(`INSERT INTO stock_reservations (id,orderId,productId,quantity,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)`);
    for (const r of snapshot.reservations) resIns.run(r.id,r.orderId,r.productId,Number(r.quantity||0),r.status,r.createdAt,r.updatedAt);

    const userIns = db.prepare(`INSERT INTO users (id,username,nome,perfil,passwordSalt,passwordHash,ativo,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const r of snapshot.users) userIns.run(r.id,r.username,r.nome,r.perfil,r.passwordSalt,r.passwordHash,Number(r.ativo||0),r.createdAt,r.updatedAt);
  });
  tx();

  for (const root of MANAGED_FILE_ROOTS) {
    const dir = path.join(DATA_DIR, root);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  for (const a of snapshot.attachments) {
    const target = safeManagedPath(a.relativePath);
    if (!target) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data));
  }

  state.restoring = false;
  state.restoredAt = new Date().toISOString();
  state.lastError = null;
  state.lastCounts = {
    docs: Object.fromEntries(STORES.map(s => [s, (snapshot.docs[s] || []).length])),
    lots: snapshot.lots.length,
    operations: snapshot.operations.length,
    stock_reservations: snapshot.reservations.length,
    users: snapshot.users.length,
    attachments: snapshot.attachments.length
  };
  dirty = false;
  return { ok: true, counts: state.lastCounts };
}

module.exports = {
  cloudPersistenceEnabled,
  getCloudPersistenceStatus,
  restoreFromNeon,
  flushToNeon,
  queueCloudFlush
};
