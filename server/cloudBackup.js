/* ============================================================
   CLOUD BACKUP — cópia íntegra do SQLite usando a API backup()
   do better-sqlite3. Em nuvem, os backups ficam no mesmo disco
   persistente, para que snapshots do provedor contenham uma
   cópia consistente mesmo com o WAL em uso.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./db');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 14);

function stamp(){
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
function cleanupOldBackups(){
  if(!fs.existsSync(BACKUP_DIR)) return;
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  for(const name of fs.readdirSync(BACKUP_DIR)){
    if(!/^lifesucos_.*\.db$/.test(name)) continue;
    const fp = path.join(BACKUP_DIR,name);
    try{ if(fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); }catch{}
  }
}
async function createDatabaseBackup(reason='manual'){
  fs.mkdirSync(BACKUP_DIR,{recursive:true});
  const target = path.join(BACKUP_DIR,`lifesucos_${stamp()}_${reason}.db`);
  await db.backup(target);
  cleanupOldBackups();
  return target;
}
function scheduleDailyBackups(){
  if(String(process.env.DISABLE_AUTO_DB_BACKUP||'').toLowerCase()==='true') return;
  setTimeout(()=>createDatabaseBackup('startup').catch(err=>console.error('[backup] startup:',err.message)),15_000);
  setInterval(()=>createDatabaseBackup('daily').catch(err=>console.error('[backup] daily:',err.message)),24*60*60*1000);
}
module.exports={ createDatabaseBackup, scheduleDailyBackups, BACKUP_DIR };
