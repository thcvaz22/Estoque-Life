/* ============================================================
   MIGRAÇÃO DEFINITIVA SQLITE -> NEON — Life Sucos v17

   Use no PC que contém o banco real da empresa.
   Requer:
     DATABASE_URL=<segredo Neon>
     opcional: SQLITE_SOURCE_PATH=C:\...\lifesucos.db

   O script NÃO apaga o SQLite. Ele lê em modo readonly, faz upsert no Neon,
   inclui usuários/lotes/reservas/idempotência e também arquivos gerenciados
   (fotos, XML e PDF) na tabela attachments.
   ============================================================ */
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const Database=require('better-sqlite3');
const { getNeonPool }=require('../server/neon');

const DEFAULT_DATA_DIR=path.join(__dirname,'..','data');
const DB_PATH=process.env.SQLITE_SOURCE_PATH || path.join(DEFAULT_DATA_DIR,'lifesucos.db');
const SOURCE_DATA_DIR=path.dirname(DB_PATH);
const DOC_STORES=['products','entries','exits','backlog','losses','inventories','history','meta','customers','suppliers','priceTables','orders','shippingManifests','costHistory','fiscalInvoices'];
const DOC_TABLE={
  products:'products',entries:'entries',exits:'exits',backlog:'backlog',losses:'losses',inventories:'inventories',history:'history',meta:'meta',
  customers:'customers',suppliers:'suppliers',priceTables:'pricetables',orders:'orders',shippingManifests:'shippingmanifests',costHistory:'costhistory',fiscalInvoices:'fiscalinvoices'
};

async function upsertDocs(pg, sqlite, store){
  let rows=[];
  try{ rows=sqlite.prepare(`SELECT id,json,updatedAt FROM ${store}`).all(); }catch{ rows=[]; }
  const table=DOC_TABLE[store];
  for(const r of rows){
    await pg.query(`INSERT INTO ${table} (id,json,updatedat) VALUES ($1,$2,$3)
      ON CONFLICT (id) DO UPDATE SET json=EXCLUDED.json, updatedat=EXCLUDED.updatedat`,[r.id,r.json,r.updatedAt]);
  }
  return rows.length;
}

function collectAttachments(){
  const roots=['nf-photos','fiscal'];
  const out=[];
  for(const root of roots){
    const base=path.join(SOURCE_DATA_DIR,root);
    if(!fs.existsSync(base)) continue;
    const walk=(dir)=>{
      for(const name of fs.readdirSync(dir)){
        const full=path.join(dir,name); const st=fs.statSync(full);
        if(st.isDirectory()) walk(full);
        else if(st.isFile()){
          const relativePath=path.relative(SOURCE_DATA_DIR,full).split(path.sep).join('/');
          const data=fs.readFileSync(full);
          out.push({
            id:'att_'+crypto.createHash('sha256').update(relativePath).digest('hex').slice(0,32),
            relativePath,
            mimeType:inferMime(relativePath),
            sha256:crypto.createHash('sha256').update(data).digest('hex'),
            data,
            updatedAt:st.mtime.toISOString()
          });
        }
      }
    };
    walk(base);
  }
  return out;
}
function inferMime(name){
  const ext=path.extname(name).toLowerCase();
  return ({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.heic':'image/heic','.pdf':'application/pdf','.xml':'application/xml','.txt':'text/plain'})[ext]||'application/octet-stream';
}

(async()=>{
  if(!String(process.env.DATABASE_URL||'').trim()) throw new Error('Defina DATABASE_URL no ambiente antes de executar.');
  if(!fs.existsSync(DB_PATH)) throw new Error(`SQLite não encontrado: ${DB_PATH}`);
  console.log('Lendo SQLite em modo somente leitura:',DB_PATH);
  const sqlite=new Database(DB_PATH,{readonly:true,fileMustExist:true});
  const pool=getNeonPool();
  const client=await pool.connect();
  const counts={};
  try{
    await client.query('BEGIN');
    for(const s of DOC_STORES) counts[s]=await upsertDocs(client,sqlite,s);

    let lots=[]; try{lots=sqlite.prepare('SELECT * FROM lots').all();}catch{}
    for(const r of lots){
      await client.query(`INSERT INTO lots (id,productid,lote,fabricacao,validade,quantidadedisponivel,quantidadebloqueada,localizacao,updatedat)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(id) DO UPDATE SET productid=EXCLUDED.productid,lote=EXCLUDED.lote,fabricacao=EXCLUDED.fabricacao,
        validade=EXCLUDED.validade,quantidadedisponivel=EXCLUDED.quantidadedisponivel,quantidadebloqueada=EXCLUDED.quantidadebloqueada,
        localizacao=EXCLUDED.localizacao,updatedat=EXCLUDED.updatedat`,
        [r.id,r.productId,r.lote,r.fabricacao,r.validade,r.quantidadeDisponivel,r.quantidadeBloqueada,r.localizacao,r.updatedAt]);
    }
    counts.lots=lots.length;

    let operations=[]; try{operations=sqlite.prepare('SELECT id,result,createdAt FROM operations').all();}catch{}
    for(const r of operations) await client.query(`INSERT INTO operations (id,result,createdat) VALUES ($1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET result=EXCLUDED.result,createdat=EXCLUDED.createdat`,[r.id,r.result,r.createdAt]);
    counts.operations=operations.length;

    let reservations=[]; try{reservations=sqlite.prepare('SELECT id,orderId,productId,quantity,status,createdAt,updatedAt FROM stock_reservations').all();}catch{}
    for(const r of reservations) await client.query(`INSERT INTO stock_reservations (id,orderid,productid,quantity,status,createdat,updatedat)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET orderid=EXCLUDED.orderid,productid=EXCLUDED.productid,
      quantity=EXCLUDED.quantity,status=EXCLUDED.status,createdat=EXCLUDED.createdat,updatedat=EXCLUDED.updatedat`,
      [r.id,r.orderId,r.productId,r.quantity,r.status,r.createdAt,r.updatedAt]);
    counts.stock_reservations=reservations.length;

    let users=[]; try{users=sqlite.prepare('SELECT id,username,nome,perfil,passwordSalt,passwordHash,ativo,createdAt,updatedAt FROM users').all();}catch{}
    for(const r of users) await client.query(`INSERT INTO users (id,username,nome,perfil,passwordsalt,passwordhash,ativo,createdat,updatedat)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,nome=EXCLUDED.nome,
      perfil=EXCLUDED.perfil,passwordsalt=EXCLUDED.passwordsalt,passwordhash=EXCLUDED.passwordhash,ativo=EXCLUDED.ativo,
      createdat=EXCLUDED.createdat,updatedat=EXCLUDED.updatedat`,
      [r.id,r.username,r.nome,r.perfil,r.passwordSalt,r.passwordHash,r.ativo,r.createdAt,r.updatedAt]);
    counts.users=users.length;

    const attachments=collectAttachments();
    for(const a of attachments){
      await client.query(`INSERT INTO attachments (id,relative_path,mime_type,sha256,data,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET relative_path=EXCLUDED.relative_path,mime_type=EXCLUDED.mime_type,
        sha256=EXCLUDED.sha256,data=EXCLUDED.data,updated_at=EXCLUDED.updated_at`,
        [a.id,a.relativePath,a.mimeType,a.sha256,a.data,a.updatedAt]);
    }
    counts.attachments=attachments.length;

    await client.query(`INSERT INTO app_migrations (id,appliedat,description) VALUES ($1,CURRENT_TIMESTAMP::text,$2)
      ON CONFLICT(id) DO UPDATE SET appliedat=EXCLUDED.appliedat,description=EXCLUDED.description`,
      ['v17-data-migration','Dados SQLite reais migrados para Neon para operação v17']);

    await client.query('COMMIT');

    const checks={};
    for(const [label,table] of Object.entries({...DOC_TABLE,lots:'lots',operations:'operations',stock_reservations:'stock_reservations',users:'users',attachments:'attachments'})){
      const r=await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      checks[label]=r.rows[0]?.n||0;
    }
    console.log('\nMigração concluída com sucesso.');
    console.log('Lidos do SQLite:',counts);
    console.log('Totais atuais no Neon:',checks);
    console.log('\nNÃO apague o SQLite original. Mantenha-o como contingência até a homologação final.');
  }catch(e){
    try{await client.query('ROLLBACK');}catch{}
    throw e;
  }finally{
    client.release();
    sqlite.close();
    await pool.end();
  }
})().catch(e=>{ console.error('\nMigração falhou:',e); process.exit(1); });
