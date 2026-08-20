/* ============================================================
   SCRIPTS/REMOTE-SETUP.JS — configura (ou reconfigura) o acesso
   do Painel do Gerente. Roda com: npm run remote:setup
   ============================================================ */

const readline = require('readline');
const { hashPassword } = require('../server/remoteAuth');
const remoteConfig = require('../server/remoteConfig');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

/* Lê a senha sem mostrar na tela (mostra * a cada tecla) */
function askPassword(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = '';
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (char) => {
      char = char.toString();
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.removeListener('data', onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdin.pause();
        process.stdout.write('\n');
        resolve(value);
      } else if (char === '\u0003') { // Ctrl+C
        process.stdout.write('\n');
        process.exit(1);
      } else if (char === '\u007f' || char === '\b') { // backspace
        if (value.length > 0) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        value += char;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('   Life Sucos — Configurar o Painel do Gerente (remoto)');
  console.log('════════════════════════════════════════════════════════');

  if (remoteConfig.isConfigured()) {
    const current = remoteConfig.readConfig();
    console.log(`   Já existe um acesso configurado (usuário: ${current.username}).`);
    const resp = await ask('   Deseja substituir por um novo usuário/senha? (s/N): ');
    if (resp.toLowerCase() !== 's') {
      console.log('   Nada foi alterado.');
      process.exit(0);
    }
  }

  console.log('');
  console.log('   Isso cria o login que o GERENTE vai usar para abrir o');
  console.log('   painel remoto (somente leitura) pela internet.');
  console.log('');

  let username = '';
  while (!username) {
    username = await ask('   Nome de usuário do gerente: ');
    if (!username) console.log('   O nome de usuário não pode ficar em branco.');
  }

  let password = '';
  while (password.length < 6) {
    password = await askPassword('   Senha (mínimo 6 caracteres): ');
    if (password.length < 6) console.log('   Senha muito curta, tente de novo.');
  }
  const confirm = await askPassword('   Confirme a senha: ');
  if (confirm !== password) {
    console.log('');
    console.log('   As senhas não conferem. Nada foi salvo — rode "npm run remote:setup" de novo.');
    process.exit(1);
  }

  const { salt, hash } = hashPassword(password);
  remoteConfig.writeConfig({ username, salt, hash });

  console.log('');
  console.log('   ✔ Pronto! O Painel do Gerente está configurado.');
  console.log('   Reinicie o servidor (npm start) para o painel remoto entrar no ar,');
  console.log('   na porta 3010 por padrão (http://localhost:3010 neste computador).');
  console.log('   Veja o README para os passos de deixar isso acessível pela internet.');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
  process.exit(0);
}

main();
