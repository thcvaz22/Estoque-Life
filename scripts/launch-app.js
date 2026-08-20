/* ============================================================
   SCRIPTS/LAUNCH-APP.JS — inicializador robusto do Life Sucos
   - Funciona mesmo quando a pasta tem espaços/OneDrive.
   - Se o servidor ja estiver online, apenas abre o aplicativo.
   - Caso contrario, inicia server/index.js em segundo plano.
   - Aguarda /api/health e abre Chrome/Edge em modo aplicativo.
   - Nao prepara OCR na inicializacao: OCR so e carregado quando
     o usuario realmente usa foto de NF/romaneio.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const SERVER_LOG = path.join(LOG_DIR, 'servidor.log');
const EXPECTED_VERSION = '17.2.0-neon-primary-render-free-recebimento-fiscal-aion-1.1';
const PORT = Number(process.env.PORT || 4000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 4443);
const URL = `http://127.0.0.1:${PORT}`;
const APP_URL = `http://localhost:${PORT}`;
let serverExit = null;

fs.mkdirSync(LOG_DIR, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
}

function healthCheck(timeoutMs = 1800) {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/health`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (!(res.statusCode >= 200 && res.statusCode < 300)) return resolve({ online: false });
        try {
          const data = JSON.parse(body || '{}');
          resolve({ online: true, version: data.systemVersion || '', data });
        } catch {
          resolve({ online: true, version: '', data: null });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ online: false }); });
    req.on('error', () => resolve({ online: false }));
  });
}

function startServer() {
  fs.appendFileSync(SERVER_LOG, `\n\n===== ${new Date().toISOString()} - nova inicializacao =====\n`, 'utf8');
  const out = fs.openSync(SERVER_LOG, 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, PORT: String(PORT), HTTPS_PORT: String(HTTPS_PORT) }
  });
  child.on('error', (err) => {
    serverExit = { error: err };
    try { fs.appendFileSync(SERVER_LOG, `[launcher] Falha ao iniciar Node: ${err.stack || err.message}\n`); } catch (_) {}
  });
  child.on('exit', (code, signal) => {
    serverExit = { code, signal };
    try { fs.appendFileSync(SERVER_LOG, `[launcher] Servidor encerrou antes de ficar online. code=${code} signal=${signal || ''}\n`); } catch (_) {}
  });
  child.unref();
  fs.closeSync(out);
  log(`Servidor solicitado em segundo plano (PID ${child.pid}).`);
}

function findBrowser() {
  const pf = process.env.ProgramFiles || '';
  const pf86 = process.env['ProgramFiles(x86)'] || '';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    { name: 'Chrome', file: path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Chrome', file: path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Chrome', file: path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Edge', file: path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Edge', file: path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe') }
  ];
  return candidates.find(c => c.file && fs.existsSync(c.file)) || null;
}

function openApp() {
  const browser = findBrowser();
  if (browser) {
    log(`Abrindo ${browser.name} em modo aplicativo.`);
    const child = spawn(browser.file, [
      `--app=${APP_URL}`,
      '--start-maximized',
      '--new-window'
    ], {
      detached: true,
      windowsHide: false,
      stdio: 'ignore'
    });
    child.unref();
    return;
  }

  log('Chrome/Edge nao encontrado. Abrindo navegador padrao.');
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', APP_URL], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    });
    child.unref();
  } else {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(cmd, [APP_URL], { detached: true, stdio: 'ignore' });
    child.unref();
  }
}

async function main() {
  log('Iniciando Life Sucos...');

  const existing = await healthCheck();
  if (existing.online) {
    if (existing.version === EXPECTED_VERSION) {
      log(`Servidor correto ja esta online na porta ${PORT} (${existing.version}).`);
      openApp();
      return;
    }
    const err = new Error(`A porta ${PORT} esta ocupada por outra versao/programa (versao detectada: ${existing.version || 'desconhecida'}). Feche a outra instancia do Life Sucos e tente novamente.`);
    err.code = 'WRONG_SERVER_VERSION';
    throw err;
  }

  startServer();

  // better-sqlite3/certificados podem levar alguns segundos na primeira vez.
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    const probe = await healthCheck();
    if (probe.online && probe.version === EXPECTED_VERSION) {
      log(`Servidor online na versao correta (${probe.version}).`);
      openApp();
      return;
    }
    if (serverExit) {
      const detalhe = serverExit.error ? serverExit.error.message : `codigo ${serverExit.code}`;
      const err = new Error(`O servidor encerrou durante a inicializacao (${detalhe}). Consulte logs\\servidor.log.`);
      err.code = 'SERVER_EXITED';
      throw err;
    }
  }

  const err = new Error('O servidor nao respondeu em ate 60 segundos. Consulte logs\\servidor.log.');
  err.code = 'SERVER_TIMEOUT';
  throw err;
}

main().catch((err) => {
  log(`ERRO: ${err.stack || err.message}`);
  process.exitCode = 2;
});
