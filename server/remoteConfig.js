/* ============================================================
   SERVER/REMOTECONFIG.JS — configuração do Painel do Gerente
   O modo remoto só liga se este arquivo existir. Não existe por
   padrão — ou seja, o recurso vem DESLIGADO até o administrador
   rodar "npm run remote:setup" uma vez.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.LIFESUCOS_DATA_DIR || path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'remote-auth.json');

function isConfigured() {
  return fs.existsSync(CONFIG_PATH);
}

function readConfig() {
  if (!isConfigured()) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeConfig({ username, salt, hash }) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ username, salt, hash, createdAt: new Date().toISOString() }, null, 2));
}

function disable() {
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
}

module.exports = { isConfigured, readConfig, writeConfig, disable, CONFIG_PATH };
