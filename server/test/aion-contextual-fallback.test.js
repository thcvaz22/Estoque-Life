const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
let base,server,dataDir,cookie;
async function req(p,{method='GET',body}={}){const r=await fetch(base+p,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body!==undefined?JSON.stringify(body):undefined});return{status:r.status,body:await r.json().catch(()=>null),headers:r.headers}}
test.before(async()=>{dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'life-aion-context-'));process.env.LIFESUCOS_DATA_DIR=dataDir;process.env.AION_EXTERNAL_AI_ENABLED='false';for(const m of ['../db','../auth','../app','../aionRoutes','../aionAgentRoutes','../services/aionUnified'])try{delete require.cache[require.resolve(m)]}catch{}const{createApp}=require('../app');server=http.createServer(createApp());await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;const login=await req('/api/auth/login',{method:'POST',body:{username:'admin',password:'TestAdmin-v15-Only'}});cookie=(login.headers.get('set-cookie')||'').split(';')[0]});
test.after(async()=>{if(server)await new Promise(r=>server.close(r));if(dataDir)fs.rmSync(dataDir,{recursive:true,force:true})});

test('AION responde emissão de NF com conhecimento do sistema, sem fallback genérico',async()=>{const r=await req('/api/aion/ask',{method:'POST',body:{message:'Como faço para emitir uma NF?',screenContext:{route:'dashboard',title:'Dashboard'}}});assert.equal(r.status,200);assert.match(r.body.reply,/Notas Fiscais|NF-e|SEFAZ/i);assert.doesNotMatch(r.body.reply,/Pode perguntar do seu jeito/i)});

test('AION direciona alteração de senha no operacional',async()=>{const r=await req('/api/aion/ask',{method:'POST',body:{message:'Aonde altero minha senha?',screenContext:{route:'dashboard',title:'Dashboard'}}});assert.equal(r.status,200);assert.match(r.body.reply,/Usuários|Gerente|Trocar senha/i);assert.doesNotMatch(r.body.reply,/Pode perguntar do seu jeito/i)});
