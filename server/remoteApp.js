/* ============================================================
   SERVER/REMOTEAPP.JS — o Painel do Gerente
   Processo/porta separados do app principal (server/app.js).
   Only GET /api/summary exposes data — there is no POST/PUT/DELETE
   route in this file at all, on purpose: mesmo que alguém
   descubra o endereço, não existe "porta de escrita" aqui para
   tentar usar.
   ============================================================ */

const path = require('path');
const express = require('express');
const auth = require('./remoteAuth');
const remoteConfig = require('./remoteConfig');
const { buildManagerSummary } = require('./remoteQueries');

const PUBLIC_DIR = path.join(__dirname, 'remote-public');
const COOKIE_NAME = 'ls_gerente_sessao';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function setSessionCookie(req, res, token) {
  const isHttps = req.protocol === 'https';
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${12 * 60 * 60}`
  ];
  if (isHttps) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const session = auth.getSession(cookies[COOKIE_NAME]);
  if (!session) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
    return res.redirect('/login');
  }
  req.remoteUser = session.username;
  next();
}

function createRemoteApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());

  auth.sweepExpiredSessions();
  setInterval(() => auth.sweepExpiredSessions(), 30 * 60 * 1000).unref();

  app.get('/login', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    if (auth.getSession(cookies[COOKIE_NAME])) return res.redirect('/');
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  });

  app.post('/login', (req, res) => {
    if (!remoteConfig.isConfigured()) return res.status(503).json({ error: 'Painel do Gerente ainda não foi configurado neste servidor.' });

    const ip = req.ip || 'desconhecido';
    if (auth.isRateLimited(ip)) {
      return res.status(429).json({ error: 'Muitas tentativas de login. Aguarde alguns minutos e tente de novo.' });
    }

    const { username, password } = req.body || {};
    const cfg = remoteConfig.readConfig();
    const ok = cfg && username === cfg.username && password && auth.verifyPassword(password, cfg.salt, cfg.hash);

    if (!ok) {
      auth.registerFailedAttempt(ip);
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    auth.clearAttempts(ip);
    const token = auth.createSession(username);
    setSessionCookie(req, res, token);
    res.json({ ok: true });
  });

  app.post('/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    auth.destroySession(cookies[COOKIE_NAME]);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
  });

  app.get('/api/summary', requireAuth, (req, res) => {
    try {
      res.json(buildManagerSummary());
    } catch (err) {
      res.status(503).json({ error: 'Não foi possível ler os dados agora: ' + err.message });
    }
  });

  app.use(express.static(PUBLIC_DIR));

  return app;
}

module.exports = { createRemoteApp };
