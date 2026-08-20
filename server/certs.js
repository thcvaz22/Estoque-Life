/* ============================================================
   SERVER/CERTS.JS — certificado HTTPS local autoassinado
   Inclui os IPs atuais da rede local como SAN (Subject
   Alternative Name), para o navegador do celular não reclamar
   de "endereço não corresponde ao certificado" — mas ATENÇÃO:
   por ser autoassinado (emissor não reconhecido), o aviso de
   "certificado não confiável" continua aparecendo mesmo assim.
   Isso é inerente a certificados autoassinados e não tem como
   ser evitado sem uma autoridade certificadora real — o usuário
   sempre vai precisar confirmar manualmente ("Avançado" →
   "Continuar mesmo assim") na primeira vez em cada aparelho.
   Se os IPs da rede mudarem (ex: outro Wi-Fi), o certificado é
   regenerado automaticamente para incluir os novos IPs.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CERT_DIR = path.join(__dirname, '..', 'data', 'certs');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const META_PATH = path.join(CERT_DIR, 'meta.json');

function ipToLong(ip) {
  return ip.split('.').map(Number);
}

function generate(ips) {
  const selfsigned = require('selfsigned');
  const attrs = [{ name: 'commonName', value: 'lifesucos.local' }];
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...ips.map(ip => ({ type: 7, ip }))
  ];
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    extensions: [{ name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames }]
  });
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(CERT_PATH, pems.cert);
  fs.writeFileSync(KEY_PATH, pems.private);
  fs.writeFileSync(META_PATH, JSON.stringify({ ips, generatedAt: new Date().toISOString() }, null, 2));
  return { cert: pems.cert, key: pems.private };
}

/* ips: lista atual de IPs LAN do computador (vinda de network.js) */
function ensureCerts(ips = []) {
  const exists = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);
  if (exists) {
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch (e) { /* meta ausente = certificado de versão anterior */ }
    const coversAllIps = meta && ips.every(ip => meta.ips.includes(ip));
    if (coversAllIps) {
      return { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) };
    }
    // IP novo (ex: rede Wi-Fi diferente) — regenera para incluir todos
  }
  return generate(ips);
}

module.exports = { ensureCerts };
