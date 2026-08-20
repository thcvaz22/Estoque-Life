const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
let server,base,dataDir;
async function login(u,p){return fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})})}
test.before(async()=>{
  dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'life-login-v16-2-'));
  process.env.LIFESUCOS_DATA_DIR=dataDir;
  delete process.env.CLOUD_MODE; delete process.env.RENDER;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD; delete process.env.BOOTSTRAP_OPERATOR_PASSWORD;
  delete process.env.BOOTSTRAP_ADMIN_USERNAME; delete process.env.BOOTSTRAP_OPERATOR_USERNAME;
  for(const m of ['../db','../auth','../app','../routes','../stockRoutes','../services/inventoryService'])try{delete require.cache[require.resolve(m)]}catch{}
  const{createApp}=require('../app');server=http.createServer(createApp());await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{if(server)await new Promise(r=>server.close(r));if(dataDir)fs.rmSync(dataDir,{recursive:true,force:true})});
test('primeira instalação local aceita credenciais históricas do gerente e operador',async()=>{
  const a=await login('admin','adminlife2026');assert.equal(a.status,200);
  const o=await login('operador','life2026');assert.equal(o.status,200);
});
