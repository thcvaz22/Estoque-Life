const { Pool } = require('pg');

let pool = null;

function neonEnabled(){
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

function getNeonPool(){
  if(!neonEnabled()) throw new Error('DATABASE_URL não configurada.');
  if(!pool){
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.NEON_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    pool.on('error', (err)=>console.error('[Neon] erro em conexão ociosa:', err.message));
  }
  return pool;
}

async function neonHealth(){
  if(!neonEnabled()) return { enabled:false, ok:false, reason:'DATABASE_URL ausente' };
  const db=getNeonPool();
  const r=await db.query('select current_database() as database, now() as now');
  return { enabled:true, ok:true, database:r.rows[0]?.database, now:r.rows[0]?.now };
}

module.exports={ neonEnabled, getNeonPool, neonHealth };
