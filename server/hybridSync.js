/* ============================================================
   AION SYNC — v18.0

   Operação híbrida Life Sucos:
   - depósito trabalha no servidor local mesmo sem internet/Render;
   - toda mutação local entra em uma outbox persistente;
   - quando a nuvem volta, as operações são reproduzidas no cloud com
     idempotência e só então o estado consolidado é baixado novamente;
   - vendedor remoto continua na nuvem e o servidor local recebe o estado
     consolidado nas sincronizações seguintes;
   - pareamento usa código temporário + token de dispositivo (token bruto
     nunca é salvo no Neon, apenas SHA-256).
   ============================================================ */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const { db, Data, STORES, DATA_DIR } = require('./db');
const { nowUTCISOString, todayLocalISO } = require('./time');
const { queueCloudFlush, cloudPersistenceEnabled } = require('./cloudPersistence');

const CLOUD_MODE = String(process.env.CLOUD_MODE || '').toLowerCase() === 'true' || !!process.env.RENDER;
const SYNC_INTERVAL_MS = Math.max(3000, Number(process.env.LIFE_SYNC_INTERVAL_MS || 7000));
const DEVICE_FILE = path.join(DATA_DIR, 'aion-sync-device.json');
const SYNC_JOURNAL = path.join(DATA_DIR, 'aion-sync-journal.ndjson');
const FILE_ROOTS = ['nf-photos', 'fiscal'];
const SYNC_BACKUP_DIR = path.join(DATA_DIR,'backups','aion-sync');
const SYNC_BACKUP_RETENTION_DAYS = Math.max(7, Number(process.env.LIFE_SYNC_BACKUP_RETENTION_DAYS || 30));
const MAX_PUSH_PER_CYCLE = 80;

let syncTimer = null;
let syncRunning = false;
let lastSyncError = null;
let lastCloudOnlineAt = null;
let lastRunAt = null;
let lastSnapshotAt = null;

function sha256(v){ return crypto.createHash('sha256').update(v).digest('hex'); }
function randomToken(){ return crypto.randomBytes(48).toString('base64url'); }
function randomId(prefix='sync'){ return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`; }
function json(v){ return JSON.stringify(v ?? null); }
function parseJson(v, fallback=null){ try{return JSON.parse(v);}catch{return fallback;} }

function ensureSyncTables(){
  db.exec(`CREATE TABLE IF NOT EXISTS sync_outbox (
    id TEXT PRIMARY KEY,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    body TEXT,
    actor TEXT,
    createdAt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    lastAttemptAt TEXT,
    lastError TEXT,
    syncedAt TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_created ON sync_outbox(status,createdAt)`);
  db.exec(`CREATE TABLE IF NOT EXISTS sync_replayed (
    id TEXT PRIMARY KEY,
    statusCode INTEGER NOT NULL,
    response TEXT,
    appliedAt TEXT NOT NULL,
    deviceId TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS sync_file_state (
    relativePath TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    uploadedAt TEXT NOT NULL
  )`);
}
ensureSyncTables();

function readDeviceConfig(){
  try{
    if(!fs.existsSync(DEVICE_FILE)) return { deviceId: randomId('device'), deviceName: process.env.COMPUTERNAME || 'Servidor Life Local', cloudUrl:'', token:'', pairedAt:null, initialSyncComplete:false, secondaryBackupDir:'' };
    const d=JSON.parse(fs.readFileSync(DEVICE_FILE,'utf8'));
    return { deviceId:d.deviceId||randomId('device'), deviceName:d.deviceName||process.env.COMPUTERNAME||'Servidor Life Local', cloudUrl:String(d.cloudUrl||'').replace(/\/$/,''), token:d.token||'', pairedAt:d.pairedAt||null, initialSyncComplete:!!d.initialSyncComplete, lastSyncAt:d.lastSyncAt||null, secondaryBackupDir:String(d.secondaryBackupDir||'') };
  }catch{
    return { deviceId: randomId('device'), deviceName: process.env.COMPUTERNAME || 'Servidor Life Local', cloudUrl:'', token:'', pairedAt:null, initialSyncComplete:false, secondaryBackupDir:'' };
  }
}
function writeDeviceConfig(cfg){
  fs.mkdirSync(path.dirname(DEVICE_FILE),{recursive:true});
  fs.writeFileSync(DEVICE_FILE,JSON.stringify(cfg,null,2),'utf8');
  try{if(process.platform!=='win32')fs.chmodSync(DEVICE_FILE,0o600);}catch{}
  return cfg;
}
function ensureDeviceConfig(){
  const cfg=readDeviceConfig();
  if(!fs.existsSync(DEVICE_FILE)) writeDeviceConfig(cfg);
  return cfg;
}

function sanitizeActor(u){
  if(!u) return {id:'unknown',nome:'Usuário local',username:'local',perfil:'Operador',auditLabel:'Usuário local'};
  let perfil=['Gerente','Operador','Vendedor','Administrador'].includes(u.perfil)?u.perfil:'Operador';
  if(perfil==='Administrador')perfil='Gerente';
  return {id:u.id||'local',nome:u.nome||'Usuário local',username:u.username||'local',perfil,auditLabel:u.auditLabel||`${u.nome||'Usuário'} (${u.username||'local'})`};
}

function durableJournal(event){
  try{
    fs.mkdirSync(path.dirname(SYNC_JOURNAL),{recursive:true});
    const line=JSON.stringify({at:nowUTCISOString(),...event})+'\n';
    const fd=fs.openSync(SYNC_JOURNAL,'a');
    try{fs.writeSync(fd,line);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const sec=readDeviceConfig().secondaryBackupDir;
    if(sec){try{fs.mkdirSync(sec,{recursive:true});const sf=path.join(sec,'aion-sync-journal.ndjson');const sfd=fs.openSync(sf,'a');try{fs.writeSync(sfd,line);fs.fsyncSync(sfd);}finally{fs.closeSync(sfd);}}catch(err){console.warn('[aion-sync] Backup secundário do journal indisponível:',err.message);}}
  }catch(err){console.warn('[aion-sync] Não foi possível gravar journal redundante:',err.message);}
}
function recoverOutboxFromJournal(){
  try{
    if(!fs.existsSync(SYNC_JOURNAL)) return 0;
    const state=new Map();
    for(const line of fs.readFileSync(SYNC_JOURNAL,'utf8').split(/\r?\n/)){
      if(!line.trim())continue;let e;try{e=JSON.parse(line);}catch{continue;}if(!e.id)continue;
      if(e.event==='queued')state.set(e.id,e);else if(['synced','superseded','cancelled'].includes(e.event))state.delete(e.id);
    }
    let restored=0;
    for(const [id,e] of state){
      const exists=db.prepare('SELECT id FROM sync_outbox WHERE id=?').get(id);if(exists)continue;
      db.prepare(`INSERT INTO sync_outbox(id,method,path,body,actor,createdAt,status,attempts,lastError) VALUES(?,?,?,?,?,?,'retry',0,?)`)
        .run(id,e.method,e.path,json(e.body||{}),json(e.actor||{}),e.createdAt||e.at||nowUTCISOString(),'Recuperada do journal redundante após reinício/recuperação');restored++;
    }
    if(restored)console.warn(`[aion-sync] ${restored} operação(ões) recuperada(s) do journal redundante.`);
    return restored;
  }catch(err){console.warn('[aion-sync] Falha ao recuperar journal:',err.message);return 0;}
}
recoverOutboxFromJournal();
function compactJournalIfNeeded(){
  try{
    if(!fs.existsSync(SYNC_JOURNAL)||fs.statSync(SYNC_JOURNAL).size<50*1024*1024)return;
    const rows=db.prepare(`SELECT id,method,path,body,actor,createdAt FROM sync_outbox WHERE status IN ('pending','retry','conflict') ORDER BY createdAt`).all();
    const tmp=SYNC_JOURNAL+'.tmp';
    const lines=rows.map(r=>JSON.stringify({at:nowUTCISOString(),event:'queued',id:r.id,method:r.method,path:r.path,body:parseJson(r.body,{}),actor:parseJson(r.actor,{}),createdAt:r.createdAt})).join('\n');
    fs.writeFileSync(tmp,lines+(lines?'\n':''),'utf8');fs.renameSync(tmp,SYNC_JOURNAL);
  }catch(err){console.warn('[aion-sync] Falha ao compactar journal:',err.message);}
}

function queueMutation({id,method,path:requestPath,body,actor}){
  const opId=id||randomId('syncop');
  const createdAt=nowUTCISOString(); const safeActor=sanitizeActor(actor); const normalizedMethod=String(method||'POST').toUpperCase();
  db.prepare(`INSERT OR IGNORE INTO sync_outbox(id,method,path,body,actor,createdAt,status,attempts)
    VALUES(?,?,?,?,?,?,'pending',0)`).run(opId,normalizedMethod,requestPath,json(body||{}),json(safeActor),createdAt);
  durableJournal({event:'queued',id:opId,method:normalizedMethod,path:requestPath,body:body||{},actor:safeActor,createdAt});
  return opId;
}

function captureLocalMutations(){
  return (req,res,next)=>{
    if(CLOUD_MODE || req.isSyncReplay) return next();
    const mutating=['POST','PUT','PATCH','DELETE'].includes(req.method);
    const p=req.originalUrl.split('?')[0];
    const passwordChange = p === '/api/auth/change-password';
    if(!mutating || !p.startsWith('/api/') || (p.startsWith('/api/auth/') && !passwordChange) || p.startsWith('/api/sync/') || p.startsWith('/api/aion/') || p.startsWith('/api/ocr/') || p==='/api/restore' || p.startsWith('/api/backup')) return next();

    const opId=req.headers['x-life-sync-operation-id'] || randomId('syncop');
    req.headers['x-life-sync-operation-id']=opId;
    if(p.startsWith('/api/stock/') && req.body && typeof req.body==='object' && !req.body.operationId) req.body.operationId=opId;

    const originalJson=res.json.bind(res);
    let captured=false;
    res.json=function syncCapture(body){
      if(!captured && res.statusCode<400){
        captured=true;
        try{
          if(p.startsWith('/api/users') || passwordChange){
            const users=db.prepare(`SELECT id,username,nome,perfil,passwordSalt,passwordHash,ativo,createdAt,updatedAt FROM users`).all();
            queueMutation({id:opId,method:'POST',path:'/api/sync/users/merge',body:{users},actor:req.authUser});
          }else queueMutation({id:opId,method:req.method,path:p,body:req.body||{},actor:req.authUser});
        }catch(err){ console.error('[aion-sync] Falha ao gravar outbox local:',err.message); }
      }
      return originalJson(body);
    };
    next();
  };
}

function updateStockConflictMeta(){
  try{
    const today=todayLocalISO();
    const reservedRows=db.prepare(`SELECT productId,COALESCE(SUM(quantity),0) AS reserved FROM stock_reservations WHERE status='active' GROUP BY productId`).all();
    const conflicts=[];
    for(const r of reservedRows){
      const physical=Number(db.prepare(`SELECT COALESCE(SUM(quantidadeDisponivel),0) AS q FROM lots WHERE productId=? AND (validade IS NULL OR validade>=?)`).get(r.productId,today)?.q||0);
      const reserved=Number(r.reserved||0); if(reserved<=physical)continue;
      const orderIds=db.prepare(`SELECT DISTINCT orderId FROM stock_reservations WHERE productId=? AND status='active'`).all(r.productId).map(x=>x.orderId);
      const product=Data.get('products',r.productId)||{};
      conflicts.push({productId:r.productId,produtoNome:product.nome||r.productId,fisico:physical,reservado:reserved,falta:reserved-physical,orderIds});
    }
    if(conflicts.length){
      Data.upsert('meta','aion_sync_stock_conflicts',{id:'aion_sync_stock_conflicts',generatedAt:nowUTCISOString(),conflicts,status:'attention'});
    }else Data.remove('meta','aion_sync_stock_conflicts');
    return conflicts;
  }catch(err){console.warn('[aion-sync] Falha ao verificar conflitos de reserva:',err.message);return[];}
}

function cloudReplayIdempotency(){
  return (req,res,next)=>{
    const mutating=['POST','PUT','PATCH','DELETE'].includes(req.method);
    const p=req.originalUrl.split('?')[0];
    if(!req.isSyncReplay || !mutating || p.startsWith('/api/sync/')) return next();
    const opId=String(req.headers['x-life-sync-operation-id']||'').trim();
    if(!opId) return res.status(400).json({error:'Operação de sincronização sem ID.',code:'SYNC_OPERATION_ID_REQUIRED'});
    const replayKey=`syncreplay:${opId}`;
    const old=db.prepare('SELECT result FROM operations WHERE id=?').get(replayKey);
    if(old){
      const cached=parseJson(old.result,{});
      res.statusCode=Number(cached.statusCode||200);
      return res.json(cached.body??{});
    }
    const originalJson=res.json.bind(res);
    let stored=false;
    res.json=function replayStore(body){
      if(!stored && res.statusCode<400){
        stored=true;
        if(p.startsWith('/api/stock/')) updateStockConflictMeta();
        db.prepare(`INSERT OR IGNORE INTO operations(id,result,createdAt) VALUES(?,?,?)`)
          .run(replayKey,json({statusCode:res.statusCode,body,deviceId:req.syncDevice?.deviceId||req.syncDevice?.id||''}),nowUTCISOString());
      }
      return originalJson(body);
    };
    next();
  };
}

function deviceRecords(){
  return Data.all('meta').filter(x=>String(x.id||'').startsWith('sync_device_') && x.ativo!==false);
}
function findDeviceByToken(token){
  if(!token) return null;
  const h=sha256(token);
  return deviceRecords().find(d=>d.tokenHash===h)||null;
}
function syncDeviceAuthMiddleware(req,res,next){
  const auth=String(req.headers.authorization||'');
  if(!auth.startsWith('Bearer ')) return next();
  const token=auth.slice(7).trim();
  const device=findDeviceByToken(token);
  if(!device) return next();
  req.syncDevice=device;
  req.isSyncReplay=true;
  let actor=null;
  try{
    const raw=String(req.headers['x-life-sync-actor']||'');
    if(raw) actor=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
  }catch{}
  req.authUser=sanitizeActor(actor||{id:`sync_${device.deviceId}`,nome:`AION Sync · ${device.nome}`,username:'aion-sync',perfil:'Gerente',auditLabel:`AION Sync · ${device.nome}`});
  next();
}

function validDeviceRequest(req){ return !!req.syncDevice; }
function requireSyncDevice(req,res,next){ if(!validDeviceRequest(req)) return res.status(401).json({error:'Dispositivo AION Sync não autorizado.',code:'SYNC_DEVICE_REQUIRED'}); next(); }

function generatePairingCode(actor){
  const code=String(Math.floor(100000+Math.random()*900000));
  const id='sync_pairing_current';
  const row={id,codeHash:sha256(code),expiresAt:new Date(Date.now()+10*60*1000).toISOString(),createdAt:nowUTCISOString(),createdBy:actor?.auditLabel||actor?.nome||'Gerente',attempts:0};
  Data.upsert('meta',id,row);
  if(cloudPersistenceEnabled()) queueCloudFlush('sync-pairing-code');
  return {code,expiresAt:row.expiresAt};
}
function exchangePairingCode({code,deviceId,deviceName}){
  const pairing=Data.get('meta','sync_pairing_current');
  const invalid=!pairing || !pairing.codeHash || Date.now()>Date.parse(pairing.expiresAt||0) || sha256(String(code||''))!==pairing.codeHash;
  if(invalid){
    if(pairing){
      pairing.attempts=Number(pairing.attempts||0)+1;
      if(pairing.attempts>=8) Data.remove('meta','sync_pairing_current'); else Data.upsert('meta','sync_pairing_current',pairing);
      if(cloudPersistenceEnabled()) queueCloudFlush('sync-pairing-failed');
    }
    const e=new Error(pairing?.attempts>=8?'Código bloqueado após tentativas inválidas. Gere um novo código.':'Código de pareamento inválido ou expirado. Gere um novo código no sistema em nuvem.'); e.status=400; throw e;
  }
  const token=randomToken();
  const id=`sync_device_${deviceId}`;
  const row={id,deviceId,nome:String(deviceName||'Servidor Life Local'),tokenHash:sha256(token),ativo:true,pairedAt:nowUTCISOString(),lastSeenAt:null};
  Data.upsert('meta',id,row);
  Data.remove('meta','sync_pairing_current');
  if(cloudPersistenceEnabled()) queueCloudFlush('sync-device-paired');
  return {token,deviceId,row};
}

function snapshotState(){
  const docs={};
  for(const store of STORES){
    const rows=db.prepare(`SELECT id,json,updatedAt FROM ${store} ORDER BY updatedAt ASC`).all();
    docs[store]=store==='meta' ? rows.filter(r=>!String(r.id).startsWith('sync_device_') && !String(r.id).startsWith('sync_pairing_')) : rows;
  }
  const users=db.prepare(`SELECT id,username,nome,perfil,passwordSalt,passwordHash,ativo,createdAt,updatedAt FROM users`).all();
  return {
    generatedAt:nowUTCISOString(),
    docs,
    lots:db.prepare('SELECT * FROM lots').all(),
    operations:db.prepare('SELECT id,result,createdAt FROM operations').all(),
    reservations:db.prepare('SELECT id,orderId,productId,quantity,status,createdAt,updatedAt FROM stock_reservations').all(),
    users
  };
}

function applyAuthoritativeSnapshot(snapshot){
  if(!snapshot || !snapshot.docs) throw new Error('Snapshot da nuvem inválido.');
  const tx=db.transaction(()=>{
    for(const store of STORES){
      if(store==='meta'){
        db.prepare(`DELETE FROM meta WHERE id NOT LIKE 'sync_device_%' AND id NOT LIKE 'sync_pairing_%'`).run();
      }else db.prepare(`DELETE FROM ${store}`).run();
      const ins=db.prepare(`INSERT INTO ${store}(id,json,updatedAt) VALUES(?,?,?)`);
      for(const r of snapshot.docs[store]||[]) ins.run(r.id,r.json,r.updatedAt);
    }
    db.prepare('DELETE FROM lots').run();
    const li=db.prepare(`INSERT INTO lots(id,productId,lote,fabricacao,validade,quantidadeDisponivel,quantidadeBloqueada,localizacao,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)`);
    for(const r of snapshot.lots||[]) li.run(r.id,r.productId,r.lote,r.fabricacao,r.validade,Number(r.quantidadeDisponivel||0),Number(r.quantidadeBloqueada||0),r.localizacao||'',r.updatedAt);
    db.prepare('DELETE FROM operations').run();
    const oi=db.prepare(`INSERT INTO operations(id,result,createdAt) VALUES(?,?,?)`);
    for(const r of snapshot.operations||[]) oi.run(r.id,r.result,r.createdAt);
    db.prepare('DELETE FROM stock_reservations').run();
    const ri=db.prepare(`INSERT INTO stock_reservations(id,orderId,productId,quantity,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)`);
    for(const r of snapshot.reservations||[]) ri.run(r.id,r.orderId,r.productId,Number(r.quantity||0),r.status,r.createdAt,r.updatedAt);
    if(Array.isArray(snapshot.users)){
      db.prepare('DELETE FROM users').run();
      const ui=db.prepare(`INSERT INTO users(id,username,nome,perfil,passwordSalt,passwordHash,ativo,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)`);
      for(const r of snapshot.users) ui.run(r.id,r.username,r.nome,r.perfil,r.passwordSalt,r.passwordHash,Number(r.ativo||0),r.createdAt,r.updatedAt);
    }
  });
  tx();
  lastSnapshotAt=nowUTCISOString();
}

function writeSyncBackup(label,snapshot){
  try{
    fs.mkdirSync(SYNC_BACKUP_DIR,{recursive:true});
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const safe=String(label||'snapshot').replace(/[^a-z0-9_-]+/gi,'-').slice(0,40);
    const file=path.join(SYNC_BACKUP_DIR,`${stamp}_${safe}.json.gz`);
    fs.writeFileSync(file,zlib.gzipSync(Buffer.from(JSON.stringify(snapshot),'utf8'),{level:6}));
    const cutoff=Date.now()-SYNC_BACKUP_RETENTION_DAYS*86400000;
    for(const name of fs.readdirSync(SYNC_BACKUP_DIR)){
      const full=path.join(SYNC_BACKUP_DIR,name);try{if(fs.statSync(full).isFile()&&fs.statSync(full).mtimeMs<cutoff)fs.unlinkSync(full);}catch{}
    }
    const sec=readDeviceConfig().secondaryBackupDir;
    if(sec){try{const dir=path.join(sec,'snapshots');fs.mkdirSync(dir,{recursive:true});fs.copyFileSync(file,path.join(dir,path.basename(file)));}catch(err){console.warn('[aion-sync] Snapshot secundário indisponível:',err.message);}}
    return file;
  }catch(err){console.warn('[aion-sync] Backup de snapshot não pôde ser criado:',err.message);return null;}
}

function managedFiles(){
  const out=[];
  for(const root of FILE_ROOTS){
    const base=path.join(DATA_DIR,root); if(!fs.existsSync(base)) continue;
    const walk=(dir)=>{for(const name of fs.readdirSync(dir)){const full=path.join(dir,name);const st=fs.statSync(full);if(st.isDirectory())walk(full);else if(st.isFile()){const rel=path.relative(DATA_DIR,full).split(path.sep).join('/');const data=fs.readFileSync(full);out.push({relativePath:rel,sha256:sha256(data),data,mimeType:inferMime(rel)});}}};
    walk(base);
  }
  return out;
}
function inferMime(name){const ext=path.extname(name).toLowerCase();return ({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.pdf':'application/pdf','.xml':'application/xml'})[ext]||'application/octet-stream';}
function safeManagedPath(rel){const n=String(rel||'').replace(/\\/g,'/').replace(/^\/+/, '');if(!n||n.includes('..')||!FILE_ROOTS.some(r=>n===r||n.startsWith(r+'/')))return null;const full=path.resolve(DATA_DIR,n);if(!full.startsWith(path.resolve(DATA_DIR)+path.sep))return null;return full;}

async function cloudFetch(cfg,pathname,opt={}){
  const headers={...(opt.headers||{}),Authorization:`Bearer ${cfg.token}`,'X-Life-Sync-Device':cfg.deviceId};
  return fetch(`${cfg.cloudUrl}${pathname}`,{...opt,headers});
}

async function pullCloudFiles(cfg){
  const r=await cloudFetch(cfg,'/api/sync/attachments/list',{cache:'no-store'});
  if(!r.ok) throw new Error(`Falha ao listar anexos da nuvem (HTTP ${r.status}).`);
  const remote=await r.json();
  const localByPath=new Map(managedFiles().map(f=>[f.relativePath,f]));
  for(const meta of remote.files||[]){
    const local=localByPath.get(meta.relativePath);
    if(local && local.sha256===meta.sha256) continue;
    const fr=await cloudFetch(cfg,`/api/sync/attachments/file?path=${encodeURIComponent(meta.relativePath)}`,{cache:'no-store'});
    if(!fr.ok) throw new Error(`Falha ao baixar anexo ${meta.relativePath} (HTTP ${fr.status}).`);
    const out=await fr.json(); const data=Buffer.from(String(out.dataBase64||''),'base64');
    if(!data.length || sha256(data)!==meta.sha256) throw new Error(`Anexo ${meta.relativePath} chegou corrompido.`);
    const target=safeManagedPath(meta.relativePath); if(!target) continue;
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);
    db.prepare(`INSERT INTO sync_file_state(relativePath,sha256,uploadedAt) VALUES(?,?,?) ON CONFLICT(relativePath) DO UPDATE SET sha256=excluded.sha256,uploadedAt=excluded.uploadedAt`).run(meta.relativePath,meta.sha256,nowUTCISOString());
  }
}

async function uploadPendingFiles(cfg){
  for(const f of managedFiles()){
    const old=db.prepare('SELECT sha256 FROM sync_file_state WHERE relativePath=?').get(f.relativePath);
    if(old?.sha256===f.sha256) continue;
    const res=await cloudFetch(cfg,'/api/sync/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({relativePath:f.relativePath,mimeType:f.mimeType,sha256:f.sha256,dataBase64:f.data.toString('base64')})});
    if(!res.ok) throw new Error(`Falha ao sincronizar arquivo ${f.relativePath}: HTTP ${res.status}`);
    db.prepare(`INSERT INTO sync_file_state(relativePath,sha256,uploadedAt) VALUES(?,?,?) ON CONFLICT(relativePath) DO UPDATE SET sha256=excluded.sha256,uploadedAt=excluded.uploadedAt`).run(f.relativePath,f.sha256,nowUTCISOString());
  }
}

async function pushOutbox(cfg){
  const rows=db.prepare(`SELECT * FROM sync_outbox WHERE status IN ('pending','retry') ORDER BY createdAt ASC LIMIT ?`).all(MAX_PUSH_PER_CYCLE);
  for(const row of rows){
    const actor=parseJson(row.actor,{});
    const headers={'Content-Type':'application/json','X-Life-Sync-Operation-Id':row.id,'X-Life-Sync-Actor':Buffer.from(JSON.stringify(actor),'utf8').toString('base64url')};
    let res;
    try{res=await cloudFetch(cfg,row.path,{method:row.method,headers,body:['GET','HEAD'].includes(row.method)?undefined:(row.body||'{}')});}
    catch(err){
      db.prepare(`UPDATE sync_outbox SET status='retry',attempts=attempts+1,lastAttemptAt=?,lastError=? WHERE id=?`).run(nowUTCISOString(),err.message,row.id);
      throw err;
    }
    let responseText=''; try{responseText=await res.text();}catch{}
    if(res.ok){
      db.prepare(`UPDATE sync_outbox SET status='synced',attempts=attempts+1,lastAttemptAt=?,lastError=NULL,syncedAt=? WHERE id=?`).run(nowUTCISOString(),nowUTCISOString(),row.id);
      durableJournal({event:'synced',id:row.id});
      continue;
    }
    const detail=parseJson(responseText,{});
    const message=detail?.error||`HTTP ${res.status}`;
    if(res.status>=400 && res.status<500){
      db.prepare(`UPDATE sync_outbox SET status='conflict',attempts=attempts+1,lastAttemptAt=?,lastError=? WHERE id=?`).run(nowUTCISOString(),message,row.id);
      durableJournal({event:'conflict',id:row.id,error:message});
      const e=new Error(`Conflito de sincronização: ${message}`);e.code='SYNC_CONFLICT';throw e;
    }
    db.prepare(`UPDATE sync_outbox SET status='retry',attempts=attempts+1,lastAttemptAt=?,lastError=? WHERE id=?`).run(nowUTCISOString(),message,row.id);
    throw new Error(message);
  }
}

async function pullSnapshot(cfg){
  const res=await cloudFetch(cfg,'/api/sync/snapshot',{cache:'no-store'});
  if(!res.ok) throw new Error(`Não foi possível baixar o estado da nuvem (HTTP ${res.status}).`);
  const snap=await res.json();
  writeSyncBackup('local-before-cloud-apply',snapshotState());
  writeSyncBackup('cloud-received',snap);
  applyAuthoritativeSnapshot(snap);
}

async function runLocalSync(reason='timer'){
  if(CLOUD_MODE || syncRunning) return {skipped:true};
  const cfg=ensureDeviceConfig();
  if(!cfg.cloudUrl || !cfg.token) return {skipped:true,reason:'not-paired'};
  if(!cfg.initialSyncComplete) return {skipped:true,reason:'initial-sync-required'};
  syncRunning=true; lastRunAt=nowUTCISOString();
  try{
    const ping=await cloudFetch(cfg,'/api/sync/ping',{cache:'no-store'});
    if(!ping.ok) throw new Error(`Nuvem indisponível (HTTP ${ping.status}).`);
    lastCloudOnlineAt=nowUTCISOString();
    await pushOutbox(cfg);
    const conflicts=db.prepare(`SELECT COUNT(*) AS n FROM sync_outbox WHERE status='conflict'`).get().n;
    const pending=db.prepare(`SELECT COUNT(*) AS n FROM sync_outbox WHERE status IN ('pending','retry')`).get().n;
    if(Number(conflicts)>0) throw Object.assign(new Error('Existem conflitos pendentes que precisam de revisão.'),{code:'SYNC_CONFLICT'});
    if(Number(pending)===0){
      await uploadPendingFiles(cfg);
      await pullSnapshot(cfg);
      await pullCloudFiles(cfg);
    }
    cfg.lastSyncAt=nowUTCISOString(); writeDeviceConfig(cfg);
    lastSyncError=null;compactJournalIfNeeded();
    return {ok:true,reason};
  }catch(err){ lastSyncError=err.message; return {ok:false,error:err.message,code:err.code||null}; }
  finally{ syncRunning=false; }
}

function startLocalSyncLoop(){
  if(CLOUD_MODE || syncTimer) return;
  syncTimer=setInterval(()=>runLocalSync('timer').catch(()=>{}),SYNC_INTERVAL_MS);
  if(syncTimer.unref)syncTimer.unref();
  setTimeout(()=>runLocalSync('startup').catch(()=>{}),1500).unref?.();
}

function localStatus(){
  const cfg=ensureDeviceConfig();
  const counts={};
  for(const status of ['pending','retry','conflict','synced']) counts[status]=Number(db.prepare('SELECT COUNT(*) AS n FROM sync_outbox WHERE status=?').get(status).n||0);
  return {
    mode:CLOUD_MODE?'cloud':'local-primary',
    paired:!!(cfg.cloudUrl&&cfg.token),initialSyncComplete:!!cfg.initialSyncComplete,initialSyncRequired:!!(cfg.cloudUrl&&cfg.token&&!cfg.initialSyncComplete),
    deviceId:cfg.deviceId,deviceName:cfg.deviceName,cloudUrl:cfg.cloudUrl||'',secondaryBackupDir:cfg.secondaryBackupDir||'',
    running:syncRunning,counts,lastRunAt,lastCloudOnlineAt,lastSnapshotAt,lastError:lastSyncError,lastSyncAt:cfg.lastSyncAt||null,
    intervalMs:SYNC_INTERVAL_MS
  };
}

function createSyncRouter(){
  const router=express.Router();

  router.get('/ping',(req,res)=>{
    if(CLOUD_MODE && !req.syncDevice) return res.status(401).json({error:'Dispositivo não pareado.'});
    if(req.syncDevice){ req.syncDevice.lastSeenAt=nowUTCISOString(); Data.upsert('meta',req.syncDevice.id,req.syncDevice); if(cloudPersistenceEnabled()) queueCloudFlush('sync-device-seen'); }
    res.json({ok:true,mode:CLOUD_MODE?'cloud':'local',time:nowUTCISOString()});
  });

  // Endpoint público de troca do código temporário por token do dispositivo.
  router.post('/pair',(req,res)=>{
    if(!CLOUD_MODE) return res.status(400).json({error:'O pareamento deve ser concluído contra o servidor em nuvem.'});
    try{
      const out=exchangePairingCode({code:req.body?.code,deviceId:req.body?.deviceId||randomId('device'),deviceName:req.body?.deviceName||'Servidor Life Local'});
      res.status(201).json({token:out.token,deviceId:out.deviceId,pairedAt:out.row.pairedAt});
    }catch(err){res.status(err.status||500).json({error:err.message});}
  });

  router.post('/pairing-code',(req,res)=>{
    if(!req.authUser || !['Gerente','Administrador'].includes(req.authUser.perfil)) return res.status(403).json({error:'Apenas gerente pode gerar código de pareamento.'});
    if(!CLOUD_MODE) return res.status(400).json({error:'Gere o código no sistema em nuvem.'});
    res.json(generatePairingCode(req.authUser));
  });

  router.get('/snapshot',requireSyncDevice,(req,res)=>res.json(snapshotState()));

  router.post('/initial-snapshot',requireSyncDevice,(req,res)=>{
    if(!CLOUD_MODE) return res.status(400).json({error:'A carga inicial deve ser enviada ao servidor em nuvem.'});
    const snap=req.body?.snapshot;
    if(!snap?.docs) return res.status(400).json({error:'Snapshot inicial inválido.'});
    try{
      applyAuthoritativeSnapshot(snap);
      const marker={id:`sync_initial_${req.syncDevice.deviceId}`,deviceId:req.syncDevice.deviceId,direction:'local_to_cloud',appliedAt:nowUTCISOString()};
      Data.upsert('meta',marker.id,marker);
      res.json({ok:true,appliedAt:marker.appliedAt});
    }catch(err){res.status(500).json({error:'Falha ao aplicar carga inicial: '+err.message});}
  });

  router.post('/users/merge',requireSyncDevice,(req,res)=>{
    const users=Array.isArray(req.body?.users)?req.body.users:[];
    if(!users.length) return res.status(400).json({error:'Nenhum usuário recebido para sincronização.'});
    try{
      const run=db.transaction(()=>{
        const up=db.prepare(`INSERT INTO users(id,username,nome,perfil,passwordSalt,passwordHash,ativo,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET username=excluded.username,nome=excluded.nome,perfil=excluded.perfil,passwordSalt=excluded.passwordSalt,passwordHash=excluded.passwordHash,ativo=excluded.ativo,createdAt=excluded.createdAt,updatedAt=excluded.updatedAt
          WHERE excluded.updatedAt >= users.updatedAt`);
        for(const u of users){if(!u.id||!u.username||!u.passwordSalt||!u.passwordHash)continue;up.run(u.id,u.username,u.nome,u.perfil,u.passwordSalt,u.passwordHash,Number(u.ativo||0),u.createdAt,u.updatedAt);}
      });run();res.json({ok:true,count:users.length});
    }catch(err){res.status(409).json({error:'Não foi possível mesclar usuários: '+err.message});}
  });

  router.get('/attachments/list',requireSyncDevice,(req,res)=>{
    const files=managedFiles().map(f=>({relativePath:f.relativePath,sha256:f.sha256,mimeType:f.mimeType,size:f.data.length}));
    res.json({files});
  });
  router.get('/attachments/file',requireSyncDevice,(req,res)=>{
    const target=safeManagedPath(req.query.path); if(!target||!fs.existsSync(target)) return res.status(404).json({error:'Arquivo não encontrado.'});
    const data=fs.readFileSync(target);res.json({relativePath:String(req.query.path),sha256:sha256(data),dataBase64:data.toString('base64'),mimeType:inferMime(target)});
  });

  router.post('/attachments',requireSyncDevice,(req,res)=>{
    const b=req.body||{}; const target=safeManagedPath(b.relativePath); if(!target) return res.status(400).json({error:'Caminho de arquivo não permitido.'});
    const data=Buffer.from(String(b.dataBase64||''),'base64'); if(!data.length) return res.status(400).json({error:'Arquivo vazio.'});
    const actual=sha256(data); if(b.sha256&&b.sha256!==actual) return res.status(400).json({error:'Hash do arquivo não confere.'});
    fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,data); res.status(201).json({ok:true,relativePath:b.relativePath,sha256:actual});
  });

  router.get('/status',(req,res)=>{
    if(CLOUD_MODE){
      if(!req.authUser) return res.status(401).json({error:'Autenticação necessária.'});
      return res.json({mode:'cloud',devices:deviceRecords().map(d=>({deviceId:d.deviceId,nome:d.nome,ativo:d.ativo!==false,pairedAt:d.pairedAt,lastSeenAt:d.lastSeenAt||null})),cloudPersistence:cloudPersistenceEnabled()});
    }
    if(!req.authUser) return res.status(401).json({error:'Autenticação necessária.'});
    res.json(localStatus());
  });

  router.post('/local/config',(req,res)=>{
    if(CLOUD_MODE) return res.status(400).json({error:'Configuração exclusiva do servidor local.'});
    if(!req.authUser || !['Gerente','Administrador'].includes(req.authUser.perfil)) return res.status(403).json({error:'Apenas gerente pode alterar o AION Sync.'});
    const cfg=ensureDeviceConfig();
    if(req.body?.deviceName!==undefined)cfg.deviceName=String(req.body.deviceName||'Servidor Life Local').trim();
    if(req.body?.secondaryBackupDir!==undefined){
      const dir=String(req.body.secondaryBackupDir||'').trim();
      if(dir){try{fs.mkdirSync(dir,{recursive:true});fs.accessSync(dir,fs.constants.W_OK);}catch(err){return res.status(400).json({error:'A pasta de backup secundário não está acessível para gravação: '+err.message});}}
      cfg.secondaryBackupDir=dir;
    }
    writeDeviceConfig(cfg);res.json({ok:true,status:localStatus()});
  });

  router.post('/local/pair',async(req,res)=>{
    if(CLOUD_MODE) return res.status(400).json({error:'Use esta ação somente no servidor local.'});
    if(!req.authUser || !['Gerente','Administrador'].includes(req.authUser.perfil)) return res.status(403).json({error:'Apenas gerente pode parear o servidor local.'});
    const cloudUrl=String(req.body?.cloudUrl||'').trim().replace(/\/$/,''); const code=String(req.body?.code||'').trim();
    if(!/^https?:\/\//i.test(cloudUrl)||!code) return res.status(400).json({error:'Informe URL da nuvem e código de pareamento.'});
    const cfg=ensureDeviceConfig(); cfg.cloudUrl=cloudUrl; cfg.deviceName=String(req.body?.deviceName||cfg.deviceName||'Servidor Life Local').trim();
    try{
      const r=await fetch(`${cloudUrl}/api/sync/pair`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,deviceId:cfg.deviceId,deviceName:cfg.deviceName})});
      const out=await r.json().catch(()=>({})); if(!r.ok) return res.status(r.status).json({error:out.error||`Falha no pareamento (HTTP ${r.status}).`});
      cfg.token=out.token;cfg.pairedAt=out.pairedAt||nowUTCISOString();cfg.initialSyncComplete=false;writeDeviceConfig(cfg);lastSyncError=null;
      res.json({ok:true,deviceId:cfg.deviceId,deviceName:cfg.deviceName,cloudUrl:cfg.cloudUrl,pairedAt:cfg.pairedAt});
    }catch(err){res.status(503).json({error:'Não foi possível alcançar o servidor em nuvem: '+err.message});}
  });

  router.post('/local/initial-sync',async(req,res)=>{
    if(CLOUD_MODE) return res.status(400).json({error:'Ação exclusiva do servidor local.'});
    if(!req.authUser || !['Gerente','Administrador'].includes(req.authUser.perfil)) return res.status(403).json({error:'Apenas gerente pode definir a carga inicial.'});
    const cfg=ensureDeviceConfig();
    if(!cfg.cloudUrl||!cfg.token) return res.status(400).json({error:'Pareie o servidor local primeiro.'});
    const direction=String(req.body?.direction||'');
    try{
      if(direction==='cloud_to_local'){
        await pullSnapshot(cfg);
        await pullCloudFiles(cfg);
        // Ao escolher a nuvem como fonte inicial, operações locais antigas não
        // podem ser reaplicadas depois. O backup criado em pullSnapshot mantém
        // uma cópia para recuperação manual, mas a fila é marcada como superada.
        const superseded=db.prepare(`SELECT id FROM sync_outbox WHERE status IN ('pending','retry','conflict')`).all();
        db.prepare(`UPDATE sync_outbox SET status='superseded',lastError='Substituída pela carga inicial da nuvem' WHERE status IN ('pending','retry','conflict')`).run();
        for(const x of superseded)durableJournal({event:'superseded',id:x.id});
      }else if(direction==='local_to_cloud'){
        // Guardamos os dois lados antes da primeira carga. Assim uma escolha
        // equivocada ainda deixa cópias independentes para recuperação manual.
        try{const before=await cloudFetch(cfg,'/api/sync/snapshot',{cache:'no-store'});if(before.ok)writeSyncBackup('cloud-before-local-migration',await before.json());}catch{}
        const snap=snapshotState(); writeSyncBackup('local-before-initial-push',snap);
        const r=await cloudFetch(cfg,'/api/sync/initial-snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshot:snap})});
        const out=await r.json().catch(()=>({}));
        if(!r.ok) return res.status(r.status).json({error:out.error||`Falha na carga inicial (HTTP ${r.status}).`});
        // O snapshot já contém o efeito de toda operação local anterior ao
        // pareamento. Marcá-las como sincronizadas evita duplicar POSTs.
        const included=db.prepare(`SELECT id FROM sync_outbox WHERE status IN ('pending','retry','conflict')`).all();
        db.prepare(`UPDATE sync_outbox SET status='synced',syncedAt=?,lastError=NULL WHERE status IN ('pending','retry','conflict')`).run(nowUTCISOString());
        for(const x of included)durableJournal({event:'synced',id:x.id,via:'initial-snapshot'});
        db.prepare('DELETE FROM sync_file_state').run();
        await uploadPendingFiles(cfg);
      }else return res.status(400).json({error:'Direção inválida. Use cloud_to_local ou local_to_cloud.'});
      cfg.initialSyncComplete=true;cfg.lastSyncAt=nowUTCISOString();writeDeviceConfig(cfg);lastSyncError=null;
      res.json({ok:true,direction,status:localStatus()});
    }catch(err){res.status(503).json({error:err.message});}
  });

  router.post('/local/run',async(req,res)=>{
    if(CLOUD_MODE) return res.status(400).json({error:'A sincronização local roda no servidor do depósito.'});
    if(!req.authUser || !['Gerente','Administrador'].includes(req.authUser.perfil)) return res.status(403).json({error:'Apenas gerente pode forçar sincronização.'});
    const result=await runLocalSync('manual'); res.status(result.ok?200:503).json({...result,status:localStatus()});
  });

  router.post('/local/conflicts/:id/retry',(req,res)=>{
    if(CLOUD_MODE) return res.status(400).json({error:'Ação local.'});
    if(!req.authUser || !['Gerente','Administrador'].includes(req.authUser.perfil)) return res.status(403).json({error:'Apenas gerente pode revisar conflitos.'});
    db.prepare(`UPDATE sync_outbox SET status='retry',lastError=NULL WHERE id=? AND status='conflict'`).run(req.params.id); res.json({ok:true});
  });

  router.get('/local/conflicts',(req,res)=>{
    if(CLOUD_MODE) return res.json([]);
    if(!req.authUser) return res.status(401).json({error:'Autenticação necessária.'});
    const rows=db.prepare(`SELECT id,method,path,body,actor,createdAt,attempts,lastError FROM sync_outbox WHERE status='conflict' ORDER BY createdAt ASC`).all().map(r=>({...r,body:parseJson(r.body,{}),actor:parseJson(r.actor,{})}));
    res.json(rows);
  });

  return router;
}

module.exports={
  CLOUD_MODE,
  createSyncRouter,
  syncDeviceAuthMiddleware,
  captureLocalMutations,
  cloudReplayIdempotency,
  startLocalSyncLoop,
  runLocalSync,
  localStatus,
  queueMutation,
  snapshotState,
  applyAuthoritativeSnapshot
};
