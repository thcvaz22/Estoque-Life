/* Recuperação local de acesso administrativo — não altera estoque ou histórico.
   Recuperação LOCAL de acesso. Por padrão restaura admin/adminlife2026.
   Em produção na nuvem, prefira RESET_ADMIN_PASSWORD pelo ambiente. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('../server/db');

const username = String(process.env.RESET_ADMIN_USERNAME || 'admin').trim() || 'admin';
const supplied = String(process.env.RESET_ADMIN_PASSWORD || '').trim();
const password = supplied || 'adminlife2026';
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
const now = new Date().toISOString();

try {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nome TEXT NOT NULL,
    perfil TEXT NOT NULL,
    passwordSalt TEXT NOT NULL,
    passwordHash TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`);
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (existing) {
    db.prepare(`UPDATE users SET passwordSalt=?, passwordHash=?, perfil='Gerente', ativo=1, updatedAt=? WHERE id=?`)
      .run(salt, hash, now, existing.id);
    try { db.prepare('DELETE FROM sessions WHERE userId = ?').run(existing.id); } catch {}
  } else {
    db.prepare(`INSERT INTO users (id,username,nome,perfil,passwordSalt,passwordHash,ativo,createdAt,updatedAt)
      VALUES ('user_admin', ?, 'Administrador', 'Gerente', ?, ?, 1, ?, ?)`)
      .run(username, salt, hash, now, now);
  }
  const file = path.join(DATA_DIR, 'PRIMEIRO_ACESSO_ADMIN.txt');
  fs.writeFileSync(file, `LIFE SUCOS | AION\nAcesso administrativo redefinido\nUsuário: ${username}\nSenha: ${password}\n\nTroque a senha após entrar.\n`, { mode: 0o600 });
  console.log('');
  console.log('ADMIN RESETADO COM SUCESSO');
  console.log(`Credenciais gravadas em: ${file}`);
  console.log('Nenhum dado de estoque, pedido, cliente ou histórico foi apagado.');
} catch (err) {
  console.error('Não foi possível resetar o admin:', err.message || err);
  process.exitCode = 1;
} finally {
  try { db.close(); } catch {}
}
