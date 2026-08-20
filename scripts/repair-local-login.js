/* Life Sucos v16.2 — recuperação local de login sem apagar dados operacionais. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('../server/db');

const now = new Date().toISOString();
const users = [
  { id:'user_admin', username:'admin', nome:'Administrador', perfil:'Gerente', password:'adminlife2026' },
  { id:'user_operador', username:'operador', nome:'Operador', perfil:'Operador', password:'life2026' }
];
function hash(password){ const salt=crypto.randomBytes(16).toString('hex'); return {salt,hash:crypto.scryptSync(password,salt,64).toString('hex')}; }
try {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, nome TEXT NOT NULL,
    perfil TEXT NOT NULL, passwordSalt TEXT NOT NULL, passwordHash TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)), createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  )`);
  for(const u of users){
    const c=hash(u.password);
    const existing=db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(u.username);
    if(existing){
      db.prepare('UPDATE users SET nome=?, perfil=?, passwordSalt=?, passwordHash=?, ativo=1, updatedAt=? WHERE id=?')
        .run(u.nome,u.perfil,c.salt,c.hash,now,existing.id);
    }else{
      db.prepare('INSERT INTO users (id,username,nome,perfil,passwordSalt,passwordHash,ativo,createdAt,updatedAt) VALUES (?,?,?,?,?,?,1,?,?)')
        .run(u.id,u.username,u.nome,u.perfil,c.salt,c.hash,now,now);
    }
  }
  try { db.exec('DELETE FROM sessions'); } catch {}
  const file=path.join(DATA_DIR,'ACESSO_LOCAL_V16_2.txt');
  fs.writeFileSync(file,'LIFE SUCOS v16.2\n\nGerente: admin\nSenha: adminlife2026\n\nOperador: operador\nSenha: life2026\n\nTroque as senhas apos validar a instalacao.\n',{mode:0o600});
  console.log('LOGIN LOCAL RECUPERADO COM SUCESSO');
  console.log('Gerente: admin / adminlife2026');
  console.log('Operador: operador / life2026');
  console.log(`Dados operacionais preservados. Arquivo: ${file}`);
} catch(err){ console.error('Falha ao recuperar login:',err.stack||err.message||err); process.exitCode=1; }
finally { try{db.close()}catch{} }
