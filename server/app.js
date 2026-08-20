/* ============================================================
   SERVER/APP.JS — monta o Express app (rotas + estáticos), sem
   subir nenhum servidor HTTP/HTTPS. Separado de index.js para
   que os testes automatizados (server/test/*.test.js) possam
   importar o app e testá-lo diretamente, sem depender de portas
   de rede nem do certificado HTTPS.
   ============================================================ */

const path = require('path');
const express = require('express');

const { seedIfNewDatabase, Data } = require('./db');
const apiRouter = require('./routes');
const stockRouter = require('./stockRoutes');
const aionRouter = require('./aionRoutes');
const commercialRouter = require('./commercialRoutes');
const fiscalRouter = require('./fiscalRoutes');
const { createOcrRouter } = require('./ocrRoutes');
const { createAuthRouter, createUserRouter, requireAuth, requireManager, requireOperational } = require('./auth');
const { cloudPersistenceEnabled, flushToNeon, queueCloudFlush } = require('./cloudPersistence');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SELLER_DIR = path.join(__dirname, '..', 'seller-public');

function createApp({ seed = true, ocrEngine } = {}) {
  if (seed) seedIfNewDatabase();
  const app = express();
  app.set('trust proxy', 1);
  const baseJson = express.json({ limit: '8mb' });
  app.use((req, res, next) => (req.originalUrl.startsWith('/api/ocr/') || req.originalUrl.startsWith('/api/fiscal/')) ? next() : baseJson(req, res, next));

  // v17 cloud: uma escrita só é anunciada como concluída depois de o estado
  // resultante ter sido confirmado no Neon. O SQLite da instância funciona
  // como cache transacional efêmero, não como armazenamento persistente.
  app.use((req, res, next) => {
    const mutating = ['POST','PUT','PATCH','DELETE'].includes(req.method);
    if (!mutating || !req.originalUrl.startsWith('/api/') || !cloudPersistenceEnabled()) return next();
    const pathOnly = req.originalUrl.split('?')[0];
    const noDurableMutation = [
      '/api/auth/login', '/api/auth/logout', '/api/aion/ask', '/api/commercial/assistant'
    ].some(p => pathOnly === p);
    if (noDurableMutation) return next();

    const originalJson = res.json.bind(res);
    let persistenceStarted = false;
    res.json = function durableJson(body) {
      if (persistenceStarted || res.statusCode >= 400) return originalJson(body);
      persistenceStarted = true;
      const successStatus = res.statusCode;
      flushToNeon(`${req.method} ${pathOnly}`).then(() => {
        res.statusCode = successStatus;
        originalJson(body);
      }).catch(err => {
        console.error('[neon-primary] Não foi possível confirmar a escrita:', err.message);
        if (res.headersSent) return;
        res.statusCode = 503;
        originalJson({
          error: 'A operação foi processada nesta instância, mas o Neon não confirmou a persistência. Tente novamente; o sistema também fará nova tentativa automática.',
          code: 'NEON_PERSISTENCE_PENDING',
          retryable: true
        });
      });
      return res;
    };
    next();
  });

  // Auditoria de segurança: se uma operação de escrita terminar com sucesso
  // e a rota específica não tiver gravado um histórico detalhado, registramos
  // uma entrada genérica. Assim nenhuma alteração relevante fica sem trilha.
  app.use((req, res, next) => {
    const mutating = ['POST','PUT','PATCH','DELETE'].includes(req.method);
    const skip = req.originalUrl.startsWith('/api/auth/') || req.originalUrl.startsWith('/api/history');
    if (!mutating || skip) return next();
    let beforeCount = 0;
    try { beforeCount = Data.all('history').length; } catch {}
    res.on('finish', () => {
      if (res.statusCode >= 400 || !req.authUser) return;
      try {
        const afterCount = Data.all('history').length;
        if (afterCount !== beforeCount) return;
        const body = { ...(req.body && typeof req.body === 'object' ? req.body : {}) };
        for (const key of Object.keys(body)) {
          if (/pass|senha|secret|token|base64|foto|image|arquivo|xml|pdf/i.test(key)) body[key] = '[omitido]';
        }
        const id = `hist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
        Data.upsert('history', id, {
          id,
          timestamp: new Date().toISOString(),
          usuario: req.authUser.auditLabel || `${req.authUser.nome} (${req.authUser.username})`,
          tipo: 'alteracao_sistema',
          motivo: `${req.method} ${req.originalUrl.split('?')[0]}`,
          observacoes: JSON.stringify(body).slice(0, 1500)
        });
        // A auditoria genérica é criada no evento finish, portanto dispara uma
        // sincronização curta adicional para não ficar apenas no cache efêmero.
        if (cloudPersistenceEnabled()) queueCloudFlush('generic-audit');
      } catch {}
    });
    next();
  });

  // Login/logout precisam ser públicos. Todo o restante da API operacional
  // exige uma sessão válida; /api/health é a única exceção porque o
  // inicializador usa essa rota para saber quando o servidor terminou de subir.
  app.use('/api/auth', createAuthRouter());
  app.use('/api/users', requireAuth, requireManager, createUserRouter());
  app.use('/api/commercial', requireAuth, commercialRouter);
  app.use('/api/fiscal', requireAuth, requireOperational, express.json({ limit: '30mb' }), fiscalRouter);
  app.use('/api/stock', requireAuth, requireOperational, stockRouter);
  app.use('/api/aion', requireAuth, requireOperational, aionRouter);
  // fotos de NF em base64 podem passar bem dos 8mb padrão (várias páginas
  // em alta resolução) — por isso este grupo de rotas tem um limite maior.
  app.use('/api/ocr', requireAuth, requireOperational, express.json({ limit: '60mb' }), createOcrRouter(ocrEngine ? { recognizeText: ocrEngine } : {}));
  app.use('/api', (req, res, next) => req.path === '/health' ? next() : requireAuth(req, res, () => requireOperational(req, res, next)), apiRouter);

  // Os assets estáticos e o index ficam públicos para que a própria tela de
  // login consiga carregar. Dados e operações continuam protegidos pela API.
  app.use('/vendas', express.static(SELLER_DIR));
  app.get('/vendas', (req,res) => res.sendFile(path.join(SELLER_DIR,'index.html')));
  app.use(express.static(PUBLIC_DIR));
  return app;
}

module.exports = { createApp };
