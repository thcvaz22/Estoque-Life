/* ============================================================
   SCRIPTS/REMOTE-DISABLE.JS — desliga o Painel do Gerente
   Roda com: npm run remote:disable
   Remove as credenciais salvas — na próxima vez que o servidor
   for iniciado, o painel remoto simplesmente não sobe mais.
   (Isso não desativa um túnel como o Tailscale Funnel que já
   esteja ativo — veja o README para o comando "tailscale funnel off".)
   ============================================================ */

const remoteConfig = require('../server/remoteConfig');

if (!remoteConfig.isConfigured()) {
  console.log('O Painel do Gerente já está desligado (nenhuma credencial configurada).');
  process.exit(0);
}

remoteConfig.disable();
console.log('');
console.log('✔ Painel do Gerente desligado. As credenciais foram removidas.');
console.log('Reinicie o servidor (npm start) para o painel remoto parar de vez.');
console.log('');
console.log('Se você também ativou o Tailscale Funnel, rode "tailscale funnel off"');
console.log('para tirar o endereço do ar imediatamente (não precisa esperar reiniciar).');
console.log('');
