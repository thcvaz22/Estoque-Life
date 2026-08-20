/* ============================================================
   SERVER/NETWORK.JS — descobre os IPs da rede local do computador,
   para mostrar ao usuário o endereço que deve digitar no celular.
   ============================================================ */

const os = require('os');

function getLanUrls(port, protocol = 'http') {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`${protocol}://${net.address}:${port}`);
      }
    }
  }
  return urls;
}

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

module.exports = { getLanUrls, getLanIps };
