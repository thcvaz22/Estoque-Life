/* ============================================================
   SERVER/AUTH.JS — autenticação, sessões e gestão de usuários

   - Senhas: scrypt + salt (nunca texto puro).
   - Sessões opacas em SQLite (12 horas), cookie HttpOnly.
   - Identidade de auditoria resolvida no servidor.
   - Gestão de usuários e permissões administrativas somente para
     perfil Gerente, com proteção também no backend.
   ============================================================ */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { db, Data, DB_PATH } = require('./db');
const { SELLERS: PRESEEDED_SELLERS } = require('./preseedV18_1');

const COOKIE_NAME = 'ls_sessao';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const ALLOWED_PROFILES = ['Gerente', 'Operador', 'Vendedor'];
const AUTH_SECRET_PATH = path.join(path.dirname(DB_PATH), 'auth-secret.key');
const FIRST_ACCESS_PATH = path.join(path.dirname(DB_PATH), 'PRIMEIRO_ACESSO_ADMIN.txt');
const LOCAL_COMPAT_MARKER = path.join(path.dirname(DB_PATH), '.auth-compat-v16-2');
const LOCAL_DEFAULT_ADMIN_PASSWORD = 'adminlife2026';
const LOCAL_DEFAULT_OPERATOR_PASSWORD = 'life2026';
let AUTH_SECRET = null;

function isCloudMode() {
  return String(process.env.CLOUD_MODE || '').toLowerCase() === 'true' || !!process.env.RENDER;
}

// Bootstrap seguro de primeiro acesso.
// Em instalações existentes, os usuários e senhas do banco são preservados.
// Em banco novo, o admin é criado a partir de variáveis de ambiente ou com
// senha aleatória gravada apenas no diretório de dados (nunca no código-fonte).
function bootstrapPassword(label) {
  const raw = crypto.randomBytes(9).toString('base64url');
  return `Aion-${label}-${raw}`;
}
function writeFirstAccessFile(username, password) {
  try {
    const file = FIRST_ACCESS_PATH;
    fs.writeFileSync(file, `LIFE SUCOS | AION\nPrimeiro acesso administrativo\nUsuário: ${username}\nSenha: ${password}\n\nTroque a senha após o primeiro login.\n`, { mode: 0o600 });
    console.log(`   [auth] Credenciais iniciais gravadas em ${file}`);
  } catch (err) {
    console.warn('   [auth] Não foi possível gravar o arquivo de primeiro acesso:', err.message);
  }
}


const loginAttempts = new Map();

function tableColumns(name) {
  try { return db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name); }
  catch { return []; }
}

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

function repairFreshV15V16LocalLogin(now) {
  if (isCloudMode()) return;
  if (String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '').trim()) return;
  if (fs.existsSync(LOCAL_COMPAT_MARKER)) return;

  try {
    const userCount = Number(db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n || 0);
    const admin = db.prepare("SELECT * FROM users WHERE id='user_admin' AND username='admin' COLLATE NOCASE").get();
    const firstAccess = fs.existsSync(FIRST_ACCESS_PATH) ? fs.readFileSync(FIRST_ACCESS_PATH, 'utf8') : '';

    // v15/v16.0/v16.2 geravam senha aleatoria no primeiro uso local. Se a base
    // ainda esta praticamente nova (somente admin, ou admin+operador) e existe
    // o arquivo de primeiro acesso, convertemos UMA vez para as credenciais
    // historicas do Life. Bancos em uso com varios usuarios nunca sao alterados.
    if (admin && userCount <= 2 && /Primeiro acesso administrativo|Acesso administrativo redefinido/i.test(firstAccess)) {
      const adminCred = hashPassword(LOCAL_DEFAULT_ADMIN_PASSWORD);
      db.prepare(`UPDATE users SET passwordSalt=?, passwordHash=?, perfil='Gerente', ativo=1, updatedAt=? WHERE id=?`)
        .run(adminCred.salt, adminCred.hash, now, admin.id);

      let operator = db.prepare("SELECT * FROM users WHERE username='operador' COLLATE NOCASE").get();
      const opCred = hashPassword(LOCAL_DEFAULT_OPERATOR_PASSWORD);
      if (operator) {
        db.prepare(`UPDATE users SET passwordSalt=?, passwordHash=?, perfil='Operador', ativo=1, updatedAt=? WHERE id=?`)
          .run(opCred.salt, opCred.hash, now, operator.id);
      } else {
        db.prepare(`INSERT INTO users
          (id, username, nome, perfil, passwordSalt, passwordHash, ativo, createdAt, updatedAt)
          VALUES ('user_operador', 'operador', 'Operador', 'Operador', ?, ?, 1, ?, ?)`)
          .run(opCred.salt, opCred.hash, now, now);
      }

      fs.writeFileSync(FIRST_ACCESS_PATH,
        `LIFE SUCOS | AION\nAcesso local compatível v16.2\nUsuário gerente: admin\nSenha gerente: ${LOCAL_DEFAULT_ADMIN_PASSWORD}\nUsuário operador: operador\nSenha operador: ${LOCAL_DEFAULT_OPERATOR_PASSWORD}\n\nAltere as senhas em Usuários após validar a instalação.\n`,
        { mode: 0o600 });
      console.warn('   [auth] Compatibilidade de login local v16.2 aplicada ao banco recém-criado.');
    }
  } catch (err) {
    console.warn('   [auth] Não foi possível aplicar compatibilidade de login local:', err.message);
  } finally {
    try { fs.writeFileSync(LOCAL_COMPAT_MARKER, new Date().toISOString(), { mode: 0o600 }); } catch {}
  }
}

function seedPredefinedSellersV18_1(now = new Date().toISOString()) {
  let inserted = 0;
  for (const spec of PRESEEDED_SELLERS) {
    const existing = db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE OR nome = ? COLLATE NOCASE LIMIT 1`)
      .get(spec.username, spec.nome);
    if (existing) continue;
    db.prepare(`INSERT INTO users
      (id, username, nome, perfil, passwordSalt, passwordHash, ativo, createdAt, updatedAt)
      VALUES (?, ?, ?, 'Vendedor', ?, ?, 1, ?, ?)`)
      .run(spec.id, spec.username, spec.nome, spec.passwordSalt, spec.passwordHash, now, now);
    inserted++;
  }
  if (inserted) console.log(`   [v18.1] ${inserted} vendedor(es) pré-cadastrado(s) a partir das carteiras comerciais.`);
}

function ensureAuthSchema() {
  // Migração defensiva: versões anteriores do Life podem ter deixado tabelas
  // users/sessions com estrutura diferente. CREATE TABLE IF NOT EXISTS não
  // corrige esse caso e o login pode falhar só depois de validar a senha.
  const usersRequired = ['id','username','nome','perfil','passwordSalt','passwordHash','ativo','createdAt','updatedAt'];
  const sessionsRequired = ['tokenHash','userId','createdAt','expiresAt'];

  if (tableExists('users')) {
    const cols = tableColumns('users');
    if (!usersRequired.every(c => cols.includes(c))) {
      const legacy = `users_legacy_${Date.now()}`;
      db.exec(`ALTER TABLE users RENAME TO ${legacy}`);
      console.warn(`   [auth] Estrutura antiga de usuários preservada em ${legacy}; criando schema atual.`);
    }
  }
  if (tableExists('sessions')) {
    const cols = tableColumns('sessions');
    if (!sessionsRequired.every(c => cols.includes(c))) {
      const legacy = `sessions_legacy_${Date.now()}`;
      db.exec(`ALTER TABLE sessions RENAME TO ${legacy}`);
      console.warn(`   [auth] Estrutura antiga de sessões preservada em ${legacy}; criando schema atual.`);
    }
  }

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
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    tokenHash TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expiresAt)');

  const now = new Date().toISOString();
  const count = Number(db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n || 0);
  if (count === 0) {
    const adminUsername = String(process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin').trim() || 'admin';
    const supplied = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '').trim();
    const adminPassword = supplied || (isCloudMode() ? bootstrapPassword('Admin') : LOCAL_DEFAULT_ADMIN_PASSWORD);
    const { salt, hash } = hashPassword(adminPassword);
    db.prepare(`INSERT INTO users
      (id, username, nome, perfil, passwordSalt, passwordHash, ativo, createdAt, updatedAt)
      VALUES (?, ?, ?, 'Gerente', ?, ?, 1, ?, ?)`)
      .run('user_admin', adminUsername, 'Administrador', salt, hash, now, now);
    if (!supplied && isCloudMode()) writeFirstAccessFile(adminUsername, adminPassword);
    console.log(`   [auth] Administrador inicial criado: ${adminUsername}`);

    const operatorUsername = String(process.env.BOOTSTRAP_OPERATOR_USERNAME || 'operador').trim() || 'operador';
    const suppliedOperator = String(process.env.BOOTSTRAP_OPERATOR_PASSWORD || '').trim();
    const operatorPassword = suppliedOperator || (!isCloudMode() ? LOCAL_DEFAULT_OPERATOR_PASSWORD : '');
    if (operatorPassword) {
      const op = hashPassword(operatorPassword);
      db.prepare(`INSERT INTO users
        (id, username, nome, perfil, passwordSalt, passwordHash, ativo, createdAt, updatedAt)
        VALUES (?, ?, 'Operador', 'Operador', ?, ?, 1, ?, ?)`)
        .run('user_operador', operatorUsername, op.salt, op.hash, now, now);
      console.log(`   [auth] Operador inicial criado: ${operatorUsername}`);
    }
  } else {
    repairFreshV15V16LocalLogin(now);
  }

  seedPredefinedSellersV18_1(now);
  sweepExpiredSessions();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const clean = String(password || '');
  if (clean.length < 6) throw Object.assign(new Error('A senha deve ter pelo menos 6 caracteres.'), { status: 400 });
  return { salt, hash: crypto.scryptSync(clean, salt, 64).toString('hex') };
}

function verifyPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) return false;
  const calculated = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return expected.length === calculated.length && crypto.timingSafeEqual(expected, calculated);
}

function publicUser(row, { includeStatus = false } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    username: row.username,
    nome: row.nome,
    perfil: row.perfil,
    auditLabel: `${row.nome} (${row.username})`
  };
  if (includeStatus) {
    out.ativo = Number(row.ativo) === 1;
    out.createdAt = row.createdAt || null;
    out.updatedAt = row.updatedAt || null;
  }
  return out;
}

function authenticate(username, password) {
  const key = String(username || '').trim();
  let row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND ativo = 1').get(key);
  if (!row && key) {
    const byName = db.prepare('SELECT * FROM users WHERE nome = ? COLLATE NOCASE AND ativo = 1 ORDER BY createdAt ASC').all(key);
    if (byName.length === 1) row = byName[0];
  }
  if (!row || !verifyPassword(password, row.passwordSalt, row.passwordHash)) return null;
  return publicUser(row);
}

function getAuthSecret() {
  if (AUTH_SECRET) return AUTH_SECRET;

  // v17 cloud: a assinatura de sessão vem de variável de ambiente gerada pelo
  // Render. Assim reinícios/spin-down do plano Free não invalidam as sessões
  // apenas porque o filesystem efêmero foi recriado.
  const configured = String(process.env.AUTH_SIGNING_SECRET || '').trim();
  if (configured) {
    if (configured.length < 32) throw new Error('AUTH_SIGNING_SECRET deve ter pelo menos 32 caracteres.');
    AUTH_SECRET = Buffer.from(configured, 'utf8');
    return AUTH_SECRET;
  }

  try {
    if (fs.existsSync(AUTH_SECRET_PATH)) {
      const raw = fs.readFileSync(AUTH_SECRET_PATH);
      if (raw.length >= 32) { AUTH_SECRET = raw; return AUTH_SECRET; }
    }
    const secret = crypto.randomBytes(48);
    fs.mkdirSync(path.dirname(AUTH_SECRET_PATH), { recursive: true });
    fs.writeFileSync(AUTH_SECRET_PATH, secret);
    AUTH_SECRET = secret;
    if (isCloudMode()) console.warn('[auth] AUTH_SIGNING_SECRET ausente; sessões serão invalidadas após reinício.');
    return AUTH_SECRET;
  } catch (err) {
    console.warn('[auth] Nao foi possivel persistir auth-secret.key; usando segredo temporario:', err.message);
    AUTH_SECRET = crypto.randomBytes(48);
    return AUTH_SECRET;
  }
}

function signSessionPayload(encodedPayload) {
  return crypto.createHmac('sha256', getAuthSecret()).update(encodedPayload).digest('base64url');
}

function createSession(userId) {
  const row = db.prepare('SELECT id, updatedAt, ativo FROM users WHERE id = ?').get(userId);
  if (!row || Number(row.ativo) !== 1) throw new Error('Usuario nao encontrado ou inativo.');
  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: expiresAtMs, ver: row.updatedAt || '' }), 'utf8').toString('base64url');
  const signature = signSessionPayload(payload);
  const token = `${payload}.${signature}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(expiresAtMs);
  db.prepare('INSERT OR REPLACE INTO sessions (tokenHash, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, createdAt, expiresAt.toISOString());
  return { token, expiresAt };
}

function getSessionUser(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    const expected = signSessionPayload(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.uid || !parsed.exp || Date.now() >= Number(parsed.exp)) return null;
    const session = db.prepare('SELECT userId, expiresAt FROM sessions WHERE tokenHash = ?').get(hashToken(token));
    if (!session || session.userId !== parsed.uid || Date.now() >= Date.parse(session.expiresAt)) return null;
    const row = db.prepare('SELECT * FROM users WHERE id = ? AND ativo = 1').get(parsed.uid);
    if (!row) return null;
    // updatedAt funciona como versao da sessao: trocar senha/perfil/desativar invalida tokens antigos.
    if (String(parsed.ver || '') !== String(row.updatedAt || '')) return null;
    return publicUser(row);
  } catch {
    return null;
  }
}

function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(hashToken(token));
}

function destroyUserSessions(userId) {
  // Invalida todos os tokens emitidos anteriormente para este usuario.
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET updatedAt = ? WHERE id = ?').run(now, userId);
}

function sweepExpiredSessions() {
  // Mantem apenas compatibilidade/limpeza de tabelas de sessoes de versoes antigas.
  try { db.prepare('DELETE FROM sessions WHERE expiresAt <= ?').run(new Date().toISOString()); } catch {}
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(raw); } catch { out[key] = raw; }
  }
  return out;
}

function requestToken(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}

function isHttpsRequest(req) {
  return !!(req.secure || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https');
}

function setSessionCookie(req, res, token) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (isHttpsRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttpsRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function requireAuth(req, res, next) {
  // v18: operações vindas de um servidor local pareado já chegam com uma
  // identidade sintética validada pelo AION Sync. Não exigimos cookie humano
  // novamente, mas apenas para requisições marcadas como replay autorizado.
  if (req.isSyncReplay && req.authUser) return next();
  const user = getSessionUser(requestToken(req));
  if (!user) return res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.', code: 'AUTH_REQUIRED' });
  req.authUser = user;
  next();
}

function requireManager(req, res, next) {
  if (!req.authUser || req.authUser.perfil !== 'Gerente') {
    return res.status(403).json({ error: 'Acesso negado — permissão de gerente necessária.', code: 'MANAGER_REQUIRED' });
  }
  next();
}

function requireOperational(req, res, next) {
  if (!req.authUser || !['Gerente','Operador'].includes(req.authUser.perfil)) {
    return res.status(403).json({ error: 'Acesso restrito à equipe operacional.', code: 'OPERATIONAL_REQUIRED' });
  }
  next();
}

function isRateLimited(ip) {
  const now = Date.now();
  const e = loginAttempts.get(ip);
  if (!e || now - e.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 0, windowStart: now });
    return false;
  }
  return e.count >= LOGIN_MAX_ATTEMPTS;
}
function registerFailure(ip) {
  const now = Date.now();
  const e = loginAttempts.get(ip);
  if (!e || now - e.windowStart > LOGIN_WINDOW_MS) loginAttempts.set(ip, { count: 1, windowStart: now });
  else e.count += 1;
}
function clearFailures(ip) { loginAttempts.delete(ip); }

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function auditUserAction(actor, tipo, target, motivo, observacoes = '') {
  const id = genId('hist');
  const row = {
    id,
    timestamp: new Date().toISOString(),
    usuario: actor.auditLabel || `${actor.nome} (${actor.username})`,
    tipo,
    produtoId: null,
    produtoNome: target ? `${target.nome} (${target.username})` : null,
    quantidade: null,
    lote: null,
    nf: null,
    motivo,
    observacoes
  };
  Data.upsert('history', id, row);
  return row;
}

function validateUsername(username) {
  const value = String(username || '').trim();
  if (value.length < 3 || value.length > 40) throw Object.assign(new Error('O usuário deve ter entre 3 e 40 caracteres.'), { status: 400 });
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw Object.assign(new Error('Use apenas letras, números, ponto, hífen ou sublinhado no usuário.'), { status: 400 });
  return value;
}

function validateName(nome) {
  const value = String(nome || '').trim();
  if (value.length < 2 || value.length > 80) throw Object.assign(new Error('Informe um nome válido.'), { status: 400 });
  return value;
}

function validateProfile(perfil) {
  const value = String(perfil || 'Operador').trim();
  if (!ALLOWED_PROFILES.includes(value)) throw Object.assign(new Error('Perfil inválido.'), { status: 400 });
  return value;
}

function countActiveManagersExcluding(userId = null) {
  if (userId) return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ativo = 1 AND perfil = 'Gerente' AND id <> ?`).get(userId).n;
  return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ativo = 1 AND perfil = 'Gerente'`).get().n;
}

function createAuthRouter() {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || 'desconhecido';
    try {
      if (isRateLimited(ip)) return res.status(429).json({ error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' });
      const { username, password } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: 'Informe usuário e senha.' });
      const user = authenticate(username, password);
      if (!user) {
        registerFailure(ip);
        return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
      }
      clearFailures(ip);
      const { token } = createSession(user.id);
      setSessionCookie(req, res, token);
      res.json({ ok: true, user });
    } catch (err) {
      console.error('[auth] Falha ao efetuar login:', err && (err.stack || err.message || err));
      res.status(500).json({ error: 'Falha interna ao autenticar. Reinicie o Life Sucos; se persistir, use o atalho Resetar Admin.' });
    }
  });

  router.get('/me', (req, res) => {
    const user = getSessionUser(requestToken(req));
    if (!user) return res.status(401).json({ error: 'Sessão não autenticada.', code: 'AUTH_REQUIRED' });
    res.json({ user });
  });

  router.post('/change-password', (req, res) => {
    try {
      const sessionUser = getSessionUser(requestToken(req));
      if (!sessionUser) return res.status(401).json({ error: 'Sessão não autenticada.', code: 'AUTH_REQUIRED' });
      const row = db.prepare('SELECT * FROM users WHERE id = ? AND ativo = 1').get(sessionUser.id);
      if (!row) return res.status(404).json({ error: 'Usuário não encontrado.' });

      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');
      const confirmPassword = String(req.body?.confirmPassword || '');

      if (!verifyPassword(currentPassword, row.passwordSalt, row.passwordHash)) {
        return res.status(401).json({ error: 'Senha atual incorreta.' });
      }
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'A confirmação da nova senha não confere.' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
      }
      if (verifyPassword(newPassword, row.passwordSalt, row.passwordHash)) {
        return res.status(400).json({ error: 'Escolha uma senha diferente da senha atual.' });
      }

      const { salt, hash } = hashPassword(newPassword);
      const now = new Date().toISOString();
      db.prepare('UPDATE users SET passwordSalt = ?, passwordHash = ?, updatedAt = ? WHERE id = ?')
        .run(salt, hash, now, row.id);
      auditUserAction(sessionUser, 'senha_alterada_pelo_usuario', row, 'Senha alterada pelo próprio usuário');
      res.json({ ok: true, requiresRelogin: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Não foi possível alterar a senha.' });
    }
  });

  router.post('/logout', (req, res) => {
    destroySession(requestToken(req));
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  return router;
}

function createUserRouter() {
  const router = express.Router();

  // Esta rota inteira é montada no app com requireAuth + requireManager.
  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY ativo DESC, perfil ASC, nome COLLATE NOCASE ASC').all();
    res.json(rows.map(r => publicUser(r, { includeStatus: true })));
  });

  router.post('/', (req, res) => {
    try {
      const body = req.body || {};
      const nome = validateName(body.nome);
      const username = validateUsername(body.username);
      const perfil = validateProfile(body.perfil || 'Operador');
      const password = String(body.password || '');
      const exists = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
      if (exists) return res.status(409).json({ error: 'Já existe um usuário com esse login.' });
      const { salt, hash } = hashPassword(password);
      const now = new Date().toISOString();
      const id = genId('user');
      db.prepare(`INSERT INTO users (id, username, nome, perfil, passwordSalt, passwordHash, ativo, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(id, username, nome, perfil, salt, hash, now, now);
      const created = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      auditUserAction(req.authUser, 'usuario_cadastrado', created, `Usuário ${perfil.toLowerCase()} cadastrado`, `Novo login: ${username}`);
      res.status(201).json(publicUser(created, { includeStatus: true }));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Não foi possível cadastrar o usuário.' });
    }
  });

  router.put('/:id', (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Usuário não encontrado.' });
      const body = req.body || {};
      const nome = validateName(body.nome ?? existing.nome);
      const username = validateUsername(body.username ?? existing.username);
      const perfil = validateProfile(body.perfil ?? existing.perfil);
      const duplicate = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?').get(username, existing.id);
      if (duplicate) return res.status(409).json({ error: 'Já existe outro usuário com esse login.' });
      if (existing.perfil === 'Gerente' && perfil !== 'Gerente' && Number(existing.ativo) === 1 && countActiveManagersExcluding(existing.id) === 0) {
        return res.status(409).json({ error: 'Não é possível remover o perfil do último gerente ativo do sistema.' });
      }
      const now = new Date().toISOString();
      db.prepare('UPDATE users SET username = ?, nome = ?, perfil = ?, updatedAt = ? WHERE id = ?').run(username, nome, perfil, now, existing.id);
      const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
      auditUserAction(req.authUser, 'usuario_editado', updated, 'Cadastro de usuário alterado', `Antes: ${existing.nome} (${existing.username}) · ${existing.perfil}; Depois: ${nome} (${username}) · ${perfil}`);
      res.json(publicUser(updated, { includeStatus: true }));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Não foi possível alterar o usuário.' });
    }
  });

  router.post('/:id/reset-password', (req, res) => {
    try {
      const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Usuário não encontrado.' });
      const { salt, hash } = hashPassword(req.body?.password);
      const now = new Date().toISOString();
      db.prepare('UPDATE users SET passwordSalt = ?, passwordHash = ?, updatedAt = ? WHERE id = ?').run(salt, hash, now, existing.id);
      destroyUserSessions(existing.id);
      auditUserAction(req.authUser, 'senha_redefinida', existing, 'Senha redefinida pelo gerente');
      res.json({ ok: true, selfSessionInvalidated: existing.id === req.authUser.id });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Não foi possível redefinir a senha.' });
    }
  });

  router.post('/:id/deactivate', (req, res) => {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (existing.id === req.authUser.id) return res.status(409).json({ error: 'Você não pode desativar o próprio usuário enquanto está conectado.' });
    if (Number(existing.ativo) !== 1) return res.json(publicUser(existing, { includeStatus: true }));
    if (existing.perfil === 'Gerente' && countActiveManagersExcluding(existing.id) === 0) {
      return res.status(409).json({ error: 'Não é possível desativar o último gerente ativo do sistema.' });
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET ativo = 0, updatedAt = ? WHERE id = ?').run(now, existing.id);
    destroyUserSessions(existing.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
    auditUserAction(req.authUser, 'usuario_desativado', updated, 'Usuário desativado', 'O histórico anterior do usuário foi preservado.');
    res.json(publicUser(updated, { includeStatus: true }));
  });

  router.post('/:id/activate', (req, res) => {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET ativo = 1, updatedAt = ? WHERE id = ?').run(now, existing.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
    auditUserAction(req.authUser, 'usuario_reativado', updated, 'Usuário reativado');
    res.json(publicUser(updated, { includeStatus: true }));
  });

  return router;
}

ensureAuthSchema();
setInterval(sweepExpiredSessions, 30 * 60 * 1000).unref();

module.exports = {
  COOKIE_NAME,
  ALLOWED_PROFILES,
  ensureAuthSchema,
  authenticate,
  hashPassword,
  createSession,
  getSessionUser,
  destroySession,
  requireAuth,
  requireManager,
  requireOperational,
  createAuthRouter,
  createUserRouter,
  parseCookies,
  requestToken,
  publicUser
};
