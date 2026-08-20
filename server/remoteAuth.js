/* ============================================================
   SERVER/REMOTEAUTH.JS — autenticação do Painel do Gerente
   Sem dependências novas: usa só o módulo crypto nativo do Node.
   - Senha nunca fica em texto puro (scrypt + salt aleatório).
   - Sessão é um token aleatório opaco guardado em memória no
     servidor (não é JWT, não guarda nada sensível no cookie).
   - Limitador simples de tentativas de login por IP.
   ============================================================ */

const crypto = require('crypto');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas
const LOGIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutos
const LOGIN_MAX_ATTEMPTS = 10;

const sessions = new Map(); // token -> { username, expiresAt }
const loginAttempts = new Map(); // ip -> { count, windowStart }

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, useSalt, 64).toString('hex');
  return { salt: useSalt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(token); return null; }
  return s;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

/* Limita tentativas de login por IP — protege o endpoint público
   de login contra força bruta simples. Não é infalível (IP pode
   ser compartilhado), mas é uma barreira barata e sem dependências. */
function isRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 0, windowStart: now });
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}
function registerFailedAttempt(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}
function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

/* Limpeza periódica de sessões expiradas (evita crescer para sempre) */
function sweepExpiredSessions() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(token);
  }
}

module.exports = {
  hashPassword, verifyPassword,
  createSession, getSession, destroySession,
  isRateLimited, registerFailedAttempt, clearAttempts,
  sweepExpiredSessions
};
