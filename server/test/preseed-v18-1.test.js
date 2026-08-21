const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let dataDir, server, base;
function cookieFrom(res){ return (res.headers.get('set-cookie') || '').split(';')[0]; }
async function login(username,password){
  const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
  return {res,body:await res.json().catch(()=>null),cookie:cookieFrom(res)};
}
async function get(pathname,cookie){
  const res=await fetch(base+pathname,{headers:cookie?{Cookie:cookie}:{}});
  return {status:res.status,body:await res.json().catch(()=>null)};
}

test.before(async()=>{
  dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lifesucos-v181-test-'));
  process.env.LIFESUCOS_DATA_DIR=dataDir;
  for(const mod of ['../preseedV18_1','../db','../auth','../app','../routes','../stockRoutes','../commercialRoutes','../hybridSync','../cloudPersistence','../services/inventoryService']){
    try{delete require.cache[require.resolve(mod)];}catch{}
  }
  const {createApp}=require('../app');
  server=http.createServer(createApp());
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});

test.after(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(dataDir)fs.rmSync(dataDir,{recursive:true,force:true});
});

test('v18.1 cria os cinco vendedores sem expor senha em texto puro',()=>{
  const {db}=require('../db');
  const rows=db.prepare("SELECT id,username,nome,perfil,passwordSalt,passwordHash FROM users WHERE perfil='Vendedor' ORDER BY nome").all();
  assert.equal(rows.length,5);
  assert.deepEqual(rows.map(x=>x.nome),['ANTONIO ALVES DA SILVA','FABIANA','FABIANO PELANDA','MANOEL JR','MARCOS SCHULTZ']);
  for(const row of rows){
    assert.match(row.passwordSalt,/^[a-f0-9]{32}$/i);
    assert.match(row.passwordHash,/^[a-f0-9]{128}$/i);
  }
});

test('vendedor entra usando o próprio nome e recebe somente sua carteira pré-cadastrada',async()=>{
  const auth=await login('FABIANA','life2026');
  assert.equal(auth.res.status,200);
  assert.equal(auth.body.user.perfil,'Vendedor');
  const customers=await get('/api/commercial/customers',auth.cookie);
  assert.equal(customers.status,200);
  assert.equal(customers.body.length,104);
  assert.ok(customers.body.every(c=>c.vendedorNome==='FABIANA'));
  assert.ok(customers.body.every(c=>c.statusAprovacao==='pre_cadastro'));
  assert.ok(customers.body.some(c=>c.nome==='PANIFICADORA DOIS IRMAOS' && c.ultimaCompra==='2026-06-24'));
});

test('carteiras importadas somam 284 clientes e preservam vendedor/data do último pedido',async()=>{
  const admin=await login('admin',process.env.BOOTSTRAP_ADMIN_PASSWORD||'TestAdmin-v15-Only');
  assert.equal(admin.res.status,200);
  const customers=await get('/api/commercial/customers',admin.cookie);
  assert.equal(customers.status,200);
  assert.equal(customers.body.length,284);
  const counts=customers.body.reduce((a,c)=>(a[c.vendedorNome]=(a[c.vendedorNome]||0)+1,a),{});
  assert.deepEqual(counts,{
    'FABIANA':104,
    'FABIANO PELANDA':33,
    'MANOEL JR':48,
    'MARCOS SCHULTZ':72,
    'ANTONIO ALVES DA SILVA':27
  });
});

test('vendedor troca a própria senha e a senha antiga deixa de funcionar',async()=>{
  const auth=await login('fabiano.pelanda','life2026');
  assert.equal(auth.res.status,200);
  const res=await fetch(base+'/api/auth/change-password',{
    method:'POST',headers:{'Content-Type':'application/json',Cookie:auth.cookie},
    body:JSON.stringify({currentPassword:'life2026',newPassword:'FabianoNova2026!',confirmPassword:'FabianoNova2026!'})
  });
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.ok,true);
  const oldLogin=await login('FABIANO PELANDA','life2026');
  assert.equal(oldLogin.res.status,401);
  const newLogin=await login('FABIANO PELANDA','FabianoNova2026!');
  assert.equal(newLogin.res.status,200);
});
