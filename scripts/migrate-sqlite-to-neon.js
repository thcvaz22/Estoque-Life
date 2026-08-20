/* Migração controlada do SQLite legado para Neon PostgreSQL.
   Execute somente depois que o schema v16 estiver aplicado no Neon.
   Requer DATABASE_URL e acesso ao arquivo SQLite atual. */
const path=require('path');
const fs=require('fs');
const Database=require('better-sqlite3');
const { getNeonPool }=require('../server/neon');

const DATA_DIR=process.env.LIFESUCOS_DATA_DIR || path.join(__dirname,'..','data');
const DB_PATH=process.env.SQLITE_SOURCE_PATH || path.join(DATA_DIR,'lifesucos.db');
const DOC_STORES=['products','entries','exits','backlog','losses','inventories','history','meta','customers','suppliers','priceTables','orders','shippingManifests','costHistory','fiscalInvoices'];

async function upsertDocs(pg, sqlite, store){
  const rows=sqlite.prepare(`SELECT id,json,updatedAt FROM ${store}`).all();
  for(const r of rows){
    await pg.query(`INSERT INTO ${store} (id,json,updatedAt) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET json=EXCLUDED.json, updatedAt=EXCLUDED.updatedAt`,[r.id,r.json,r.updatedAt]);
  }
  return rows.length;
}

(async()=>{
  if(!fs.existsSync(DB_PATH)) throw new Error(`SQLite não encontrado: ${DB_PATH}`);
  const sqlite=new Database(DB_PATH,{readonly:true,fileMustExist:true});
  const pool=getNeonPool();
  const client=await pool.connect();
  const counts={};
  try{
    await client.query('BEGIN');
    for(const s of DOC_STORES) counts[s]=await upsertDocs(client,sqlite,s);

    const lots=sqlite.prepare('SELECT * FROM lots').all();
    for(const r of lots){
      await client.query(`INSERT INTO lots (id,productId,lote,fabricacao,validade,quantidadeDisponivel,quantidadeBloqueada,localizacao,updatedAt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET productId=EXCLUDED.productId,lote=EXCLUDED.lote,fabricacao=EXCLUDED.fabricacao,validade=EXCLUDED.validade,quantidadeDisponivel=EXCLUDED.quantidadeDisponivel,quantidadeBloqueada=EXCLUDED.quantidadeBloqueada,localizacao=EXCLUDED.localizacao,updatedAt=EXCLUDED.updatedAt`,[r.id,r.productId,r.lote,r.fabricacao,r.validade,r.quantidadeDisponivel,r.quantidadeBloqueada,r.localizacao,r.updatedAt]);
    }
    counts.lots=lots.length;

    const simpleTables={
      operations:['id','result','createdAt'],
      stock_reservations:['id','orderId','productId','quantity','status','createdAt','updatedAt'],
      users:['id','username','nome','perfil','passwordSalt','passwordHash','ativo','createdAt','updatedAt']
    };
    for(const [table,cols] of Object.entries(simpleTables)){
      let rows=[];
      try{ rows=sqlite.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all(); }catch{ rows=[]; }
      for(const r of rows){
        const vals=cols.map(c=>r[c]);
        const params=cols.map((_,i)=>'$'+(i+1)).join(',');
        const updates=cols.filter(c=>c!=='id').map(c=>`${c}=EXCLUDED.${c}`).join(',');
        await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${params}) ON CONFLICT (id) DO UPDATE SET ${updates}`,vals);
      }
      counts[table]=rows.length;
    }
    await client.query('COMMIT');
    console.log('Migração concluída:', counts);
  }catch(e){
    await client.query('ROLLBACK');
    throw e;
  }finally{
    client.release();
    sqlite.close();
    await pool.end();
  }
})().catch(e=>{ console.error('Migração falhou:',e); process.exit(1); });
