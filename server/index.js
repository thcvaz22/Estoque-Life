/* ============================================================
   SERVER/INDEX.JS — entrada local e cloud v17

   Local:
   - SQLite persistente na pasta data/
   - HTTP + HTTPS autoassinado para rede interna

   Cloud / Render Free:
   - Neon PostgreSQL = persistência autoritativa
   - SQLite = cache transacional efêmero da instância
   - restaura Neon -> cache antes de abrir a porta HTTP
   - toda escrita bem-sucedida é confirmada no Neon antes da resposta
   ============================================================ */
const http = require('http');
const https = require('https');
const { ensureCerts } = require('./certs');
const { getLanUrls, getLanIps } = require('./network');
const remoteConfig = require('./remoteConfig');

const CLOUD_MODE = String(process.env.CLOUD_MODE||'').toLowerCase()==='true' || !!process.env.RENDER;
const PORT = Number(process.env.PORT || 4000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 4443);
const REMOTE_PORT = Number(process.env.REMOTE_PORT || 3010);

function friendlyListenError(err,port,label){
  if(err.code==='EADDRINUSE') console.error(`\n[ERRO] A porta ${port} (${label}) já está em uso.`);
  else console.error(`\n[ERRO] Falha ao iniciar ${label}:`,err.message);
}

function printBanner({ isNewDatabase, publicBaseUrl }){
  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('   LIFE SUCOS · AION — v17.1 · Neon Primary + Render Free');
  console.log('════════════════════════════════════════════════════════');
  if(isNewDatabase) console.log('   Cache local criado nesta execução.');
  if(CLOUD_MODE){
    console.log('   Modo NUVEM ativo · Neon = fonte persistente.');
    console.log(`   Porta interna: ${PORT}`);
    if(publicBaseUrl){
      console.log(`   Sistema: ${publicBaseUrl}`);
      console.log(`   Life Vendas: ${publicBaseUrl.replace(/\/$/,'')}/vendas/`);
    }
  }else{
    console.log(`   Operação local: http://localhost:${PORT}`);
    console.log(`   Life Vendas local: http://localhost:${PORT}/vendas/`);
  }
  console.log('════════════════════════════════════════════════════════');
}

async function main(){
  let persistence = null;

  // IMPORTANTE: restauramos o cache ANTES de carregar app/auth. Assim os
  // usuários, estoque e dados existentes do Neon já estão presentes quando
  // o bootstrap e as rotas são inicializados.
  if(CLOUD_MODE){
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatório para a v17 em nuvem.');
    persistence = require('./cloudPersistence');
    console.log('   [cloud] Restaurando estado persistente do Neon...');
    const restored = await persistence.restoreFromNeon();
    console.log('   [cloud] Restauração concluída.', restored.counts || '');
  }

  const { isNewDatabase } = require('./db');
  const { createApp } = require('./app');
  const { scheduleDailyBackups } = require('./cloudBackup');
  const app = createApp();

  // Seed de catálogo e eventual primeiro admin são criados durante createApp.
  // Em nuvem confirmamos esse estado no Neon antes de aceitar tráfego.
  if(CLOUD_MODE){
    await persistence.flushToNeon('startup-bootstrap');
    console.log('   [cloud] Estado inicial confirmado no Neon.');
  }

  const server=http.createServer(app);
  server.on('error',err=>{friendlyListenError(err,PORT,'HTTP');process.exit(1);});

  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(PORT,'0.0.0.0',()=>{
      server.removeListener('error',reject);
      printBanner({ isNewDatabase, publicBaseUrl: process.env.PUBLIC_BASE_URL || null });
      scheduleDailyBackups();
      if(!CLOUD_MODE) startHttps(app);
      resolve();
    });
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal}: encerrando o Life Sucos...`);
    try {
      if(CLOUD_MODE && persistence) await Promise.race([
        persistence.flushToNeon('shutdown'),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),8000))
      ]);
    } catch(err) {
      console.error('[cloud] Falha na sincronização final:', err.message);
    }
    server.close(()=>process.exit(0));
    setTimeout(()=>process.exit(0),10_000).unref();
  };
  process.once('SIGTERM',()=>shutdown('SIGTERM'));
  process.once('SIGINT',()=>shutdown('SIGINT'));

  if(!CLOUD_MODE && remoteConfig.isConfigured()){
    const { createRemoteApp }=require('./remoteApp');
    const remoteServer=http.createServer(createRemoteApp());
    remoteServer.on('error',err=>friendlyListenError(err,REMOTE_PORT,'Painel do Gerente'));
    remoteServer.listen(REMOTE_PORT,'0.0.0.0');
  }
}

function startHttps(app){
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

main().catch(err=>{
  console.error('\n[ERRO FATAL] Não foi possível iniciar o Life Sucos v17.1:', err.message);
  if(err.stack) console.error(err.stack);
  process.exit(1);
});
