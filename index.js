/* ============================================================
   SERVER/INDEX.JS — entrada local e cloud
   - Local: HTTP + HTTPS autoassinado para rede interna.
   - Cloud: CLOUD_MODE=true, usa apenas HTTP interno na porta PORT;
     o provedor (ex.: Render) entrega HTTPS público automaticamente.
   ============================================================ */
const http = require('http');
const https = require('https');
const { isNewDatabase } = require('./db');
const { createApp } = require('./app');
const { ensureCerts } = require('./certs');
const { getLanUrls, getLanIps } = require('./network');
const remoteConfig = require('./remoteConfig');
const { scheduleDailyBackups } = require('./cloudBackup');
const { scheduleNeonMirror } = require('./neonMirror');

const CLOUD_MODE = String(process.env.CLOUD_MODE||'').toLowerCase()==='true' || !!process.env.RENDER;
const PORT = Number(process.env.PORT || 4000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 4443);
const REMOTE_PORT = Number(process.env.REMOTE_PORT || 3010);
const app=createApp();

function friendlyListenError(err,port,label){
  if(err.code==='EADDRINUSE') console.error(`\n[ERRO] A porta ${port} (${label}) já está em uso.`);
  else console.error(`\n[ERRO] Falha ao iniciar ${label}:`,err.message);
}
function printBanner(){
  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('   LIFE SUCOS · AION — v16.3 · Cloud Estável + Neon Mirror + Skill 1.1');
  console.log('════════════════════════════════════════════════════════');
  if(isNewDatabase) console.log('   Banco de dados criado agora (primeira execução).');
  if(CLOUD_MODE){
    console.log('   Modo NUVEM ativo.');
    console.log(`   Porta interna: ${PORT}`);
    if(process.env.PUBLIC_BASE_URL){
      console.log(`   Sistema: ${process.env.PUBLIC_BASE_URL}`);
      console.log(`   Life Vendas: ${process.env.PUBLIC_BASE_URL.replace(/\/$/,'')}/vendas/`);
    }
  }else{
    console.log(`   Operação local: http://localhost:${PORT}`);
    console.log(`   Life Vendas local: http://localhost:${PORT}/vendas/`);
  }
  console.log('════════════════════════════════════════════════════════');
}

const server=http.createServer(app);
server.on('error',err=>{friendlyListenError(err,PORT,'HTTP');process.exit(1);});
server.listen(PORT,'0.0.0.0',()=>{
  printBanner();
  scheduleDailyBackups();
  scheduleNeonMirror();
  if(!CLOUD_MODE) startHttps();
});

function startHttps(){
  try{
    const certs=ensureCerts(getLanIps());
    const s=https.createServer({cert:certs.cert,key:certs.key},app);
    s.on('error',err=>friendlyListenError(err,HTTPS_PORT,'HTTPS'));
    s.listen(HTTPS_PORT,'0.0.0.0',()=>{
      const urls=getLanUrls(HTTPS_PORT,'https');
      if(urls.length){
        console.log('   Rede interna:');
        urls.forEach(u=>console.log(`     → ${u}`));
        console.log('   Life Vendas:');
        urls.forEach(u=>console.log(`     → ${u}/vendas/`));
      }
      console.log('');
    });
  }catch(err){ console.log('   HTTPS local indisponível:',err.message); }
}

process.on('SIGINT',()=>{console.log('\nEncerrando o Life Sucos...');process.exit(0);});

if(!CLOUD_MODE && remoteConfig.isConfigured()){
  const { createRemoteApp }=require('./remoteApp');
  const remoteServer=http.createServer(createRemoteApp());
  remoteServer.on('error',err=>friendlyListenError(err,REMOTE_PORT,'Painel do Gerente'));
  remoteServer.listen(REMOTE_PORT,'0.0.0.0');
}
