/* ============================================================
   NEON MIRROR — espelho assíncrono de segurança para a v16.3

   A operação continua transacional no SQLite local/persistente (modelo
   já validado do Life). Em nuvem, o SQLite fica obrigatoriamente em
   /var/data (disco persistente do Render) e este serviço replica o estado
   para o Neon em segundo plano.

   O espelho NÃO participa da transação operacional e nunca bloqueia uma
   venda/entrada por indisponibilidade temporária do Neon. A migração para
   PostgreSQL como banco operacional principal será feita na v17, após a
   implantação de produção estar estável.
   ============================================================ */
const { db } = require('./db');
const { neonEnabled, getNeonPool } = require('./neon');

const DOC_STORES = ['products','entries','exits','backlog','losses','inventories','history','meta','customers','suppliers','priceTables','orders','shippingManifests','costHistory','fiscalInvoices'];
const INTERVAL_MS = Math.max(60000, Number(process.env.NEON_MIRROR_INTERVAL_MS || 300000));
let timer = null;
let running = false;
let status = {
  enabled: false,
  running: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastCounts: null,
  intervalMs: INTERVAL_MS
};

function enabled(){
  return String(process.env.NEON_MIRROR_ENABLED || '').toLowerCase() === 'true' && neonEnabled();
}

async function mirrorDocStore(client, store){
  const rows = db.prepare(`SELECT id,json,updatedAt FROM ${store}`).all();
  for (const r of rows) {
    await client.query(
      `INSERT INTO ${store} (id,json,updatedAt) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET json=EXCLUDED.json, updatedAt=EXCLUDED.updatedAt`,
      [r.id, r.json, r.updatedAt]
    );
  }
  return rows.length;
}

async function mirrorSimpleTable(client, table, cols){
  let rows=[];
  try { rows=db.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all(); }
  catch { return 0; }
  for(const r of rows){
    const vals=cols.map(c=>r[c]);
    const params=cols.map((_,i)=>'$'+(i+1)).join(',');
    const updates=cols.filter(c=>c!=='id').map(c=>`${c}=EXCLUDED.${c}`).join(',');
    await client.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${params}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
      vals
    );
  }
  return rows.length;
}

async function runNeonMirror(reason='interval'){
  if(!enabled()){
    status.enabled=false;
    return { skipped:true, reason:'disabled-or-no-database-url' };
  }
  if(running) return { skipped:true, reason:'already-running' };
  running=true;
  status.enabled=true;
  status.running=true;
  status.lastAttemptAt=new Date().toISOString();
  const counts={};
  const pool=getNeonPool();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    for(const store of DOC_STORES) counts[store]=await mirrorDocStore(client,store);

    const lots=db.prepare('SELECT * FROM lots').all();
    for(const r of lots){
      await client.query(
        `INSERT INTO lots (id,productId,lote,fabricacao,validade,quantidadeDisponivel,quantidadeBloqueada,localizacao,updatedAt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(id) DO UPDATE SET productId=EXCLUDED.productId,lote=EXCLUDED.lote,fabricacao=EXCLUDED.fabricacao,
         validade=EXCLUDED.validade,quantidadeDisponivel=EXCLUDED.quantidadeDisponivel,
         quantidadeBloqueada=EXCLUDED.quantidadeBloqueada,localizacao=EXCLUDED.localizacao,updatedAt=EXCLUDED.updatedAt`,
        [r.id,r.productId,r.lote,r.fabricacao,r.validade,r.quantidadeDisponivel,r.quantidadeBloqueada,r.localizacao,r.updatedAt]
      );
    }
    counts.lots=lots.length;
    counts.operations=await mirrorSimpleTable(client,'operations',['id','result','createdAt']);
    counts.stock_reservations=await mirrorSimpleTable(client,'stock_reservations',['id','orderId','productId','quantity','status','createdAt','updatedAt']);
    counts.users=await mirrorSimpleTable(client,'users',['id','username','nome','perfil','passwordSalt','passwordHash','ativo','createdAt','updatedAt']);

    await client.query('COMMIT');
    status.lastSuccessAt=new Date().toISOString();
    status.lastError=null;
    status.lastCounts=counts;
    console.log(`[Neon mirror] ${reason}: sincronização concluída.`);
    return { ok:true, counts };
  }catch(err){
    try{ await client.query('ROLLBACK'); }catch{}
    status.lastError=String(err.message || err);
    console.error('[Neon mirror] falha:', status.lastError);
    return { ok:false, error:status.lastError };
  }finally{
    client.release();
    running=false;
    status.running=false;
  }
}

function scheduleNeonMirror(){
  status.enabled=enabled();
  if(!status.enabled){
    console.log('[Neon mirror] desativado (configure DATABASE_URL + NEON_MIRROR_ENABLED=true).');
    return;
  }
  if(timer) return;
  setTimeout(()=>runNeonMirror('startup'), 20000);
  timer=setInterval(()=>runNeonMirror('interval'), INTERVAL_MS);
  if(typeof timer.unref === 'function') timer.unref();
}

function getNeonMirrorStatus(){ return { ...status }; }

module.exports={ runNeonMirror, scheduleNeonMirror, getNeonMirrorStatus };
