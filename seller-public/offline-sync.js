/* ============================================================
   LIFE VENDAS OFFLINE — v18.0
   IndexedDB local-first para vendedores:
   - cacheia leituras recentes;
   - mantém a última sessão conhecida por até 24h apenas para modo offline;
   - fila novos clientes e pedidos quando a nuvem estiver indisponível;
   - sincroniza automaticamente quando a conexão retorna;
   - conflitos nunca são apagados: ficam como "atenção necessária".
   ============================================================ */
(function(){
  const DB_NAME='life-vendas-offline-v18';
  const DB_VERSION=1;
  const SESSION_TTL=24*60*60*1000;
  let online=true, flushing=false, lastError='';

  function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('kv'))db.createObjectStore('kv',{keyPath:'key'});if(!db.objectStoreNames.contains('outbox')){const s=db.createObjectStore('outbox',{keyPath:'id'});s.createIndex('status','status');s.createIndex('createdAt','createdAt');}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function tx(store,mode,fn){const db=await openDb();return new Promise((resolve,reject)=>{const t=db.transaction(store,mode),s=t.objectStore(store);let out;try{out=fn(s);}catch(e){reject(e);return;}t.oncomplete=()=>resolve(out);t.onerror=()=>reject(t.error);});}
  async function kvSet(key,value){await tx('kv','readwrite',s=>s.put({key,value,updatedAt:Date.now()}));}
  async function kvGet(key){const db=await openDb();return new Promise((resolve,reject)=>{const r=db.transaction('kv').objectStore('kv').get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}
  async function outboxAll(){const db=await openDb();return new Promise((resolve,reject)=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>resolve((r.result||[]).sort((a,b)=>a.createdAt-b.createdAt));r.onerror=()=>reject(r.error);});}
  async function outboxPut(row){await tx('outbox','readwrite',s=>s.put(row));updateBadge();}
  async function outboxDelete(id){await tx('outbox','readwrite',s=>s.delete(id));updateBadge();}
  function uid(){return `sellerop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;}
  function cacheKey(url){return 'http:'+url;}
  function canQueue(url,method){return method==='POST' && (url==='/api/commercial/orders'||url==='/api/commercial/customers');}
  function placeholder(url,body,id){if(url.endsWith('/orders'))return {id,numero:`OFFLINE-${id.slice(-6).toUpperCase()}`,clienteId:body.clienteId,status:'aguardando_sincronizacao',statusAprovacao:'pendente',criadoEm:new Date().toISOString(),offlinePending:true};return {id,nome:body.nome||body.nomeFantasia||body.razaoSocial||'Cliente offline',statusAprovacao:'aguardando_sincronizacao',criadoEm:new Date().toISOString(),offlinePending:true};}
  function parseBody(opt){try{return opt.body?JSON.parse(opt.body):{};}catch{return{};}}

  async function cachedRead(url){
    if(url==='/api/auth/me'){
      const row=await kvGet('lastUser');
      if(row && Date.now()-Number(row.updatedAt||0)<=SESSION_TTL) return {...row.value,offline:true};
    }
    const row=await kvGet(cacheKey(url));
    if(!row) return null;
    let value=row.value;
    if(url==='/api/commercial/orders'){
      const pending=(await outboxAll()).filter(x=>x.url===url&&x.status!=='synced').map(x=>x.placeholder);
      if(Array.isArray(value)) value=value.concat(pending);
    }
    return value;
  }

  async function queueRequest(url,opt){
    const id=uid(), body=parseBody(opt), row={id,url,method:(opt.method||'POST').toUpperCase(),body,createdAt:Date.now(),status:'pending',attempts:0,lastError:'',placeholder:null};
    row.placeholder=placeholder(url,body,id); await outboxPut(row); online=false; updateBadge(); return row.placeholder;
  }

  async function request(url,opt={}){
    const method=(opt.method||'GET').toUpperCase();
    try{
      const r=await fetch(url,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})},cache:'no-store'});
      let d={};try{d=await r.json()}catch{}
      if(r.status===401){ if(url!='/api/auth/me') throw Object.assign(new Error('Sessão expirada.'),{status:401}); }
      if(!r.ok) throw Object.assign(new Error(d.error||'Erro na operação.'),{status:r.status,response:d});
      online=true;lastError='';
      if(method==='GET') await kvSet(cacheKey(url),d);
      if(url==='/api/auth/me'&&d?.user) await kvSet('lastUser',{user:d.user});
      updateBadge();
      if(!flushing) setTimeout(()=>flush(),0);
      return d;
    }catch(err){
      const unavailable=!err.status || Number(err.status)>=500 || Number(err.status)===429;
      if(!unavailable) throw err;
      online=false;lastError=err.message||'Sem conexão';updateBadge();
      if(method==='GET'){
        const c=await cachedRead(url); if(c!==null) return c;
      }
      if(canQueue(url,method)) return queueRequest(url,opt);
      throw new Error('Sem conexão com a nuvem. Esta ação não pode ser feita offline, mas pedidos e novos clientes podem ser salvos e sincronizados depois.');
    }
  }

  async function flush(){
    if(flushing) return;flushing=true;
    try{
      const rows=await outboxAll();
      for(const row of rows){
        if(row.status==='attention') continue;
        try{
          const r=await fetch(row.url,{method:row.method,headers:{'Content-Type':'application/json','X-Life-Seller-Offline-Id':row.id},body:JSON.stringify({...row.body,clientOperationId:row.id}),cache:'no-store'});
          let d={};try{d=await r.json()}catch{}
          if(r.ok){await outboxDelete(row.id);online=true;continue;}
          if(r.status>=400&&r.status<500){row.status='attention';row.attempts++;row.lastError=d.error||`HTTP ${r.status}`;await outboxPut(row);continue;}
          row.status='pending';row.attempts++;row.lastError=d.error||`HTTP ${r.status}`;await outboxPut(row);break;
        }catch(e){online=false;lastError=e.message||'Sem conexão';break;}
      }
    }finally{flushing=false;updateBadge();}
  }

  async function status(){const rows=await outboxAll();return {online,pending:rows.filter(x=>x.status==='pending').length,attention:rows.filter(x=>x.status==='attention').length,total:rows.length,lastError};}
  async function updateBadge(){
    let el=document.getElementById('seller-sync-status');
    if(!el&&document.body){el=document.createElement('div');el.id='seller-sync-status';el.style.cssText='position:fixed;right:12px;bottom:86px;z-index:9999;padding:8px 11px;border-radius:999px;background:#fff7d6;border:1px solid rgba(0,0,0,.13);box-shadow:0 5px 18px rgba(0,0,0,.12);font:600 12px Inter,sans-serif;max-width:78vw';document.body.appendChild(el);}
    if(!el)return;let st={online,pending:0,attention:0};try{st=await status();}catch{}
    if(st.attention)el.textContent=`⚠ ${st.attention} item(ns) precisam de atenção`;
    else if(st.pending)el.textContent=`${st.online?'🔄':'📴'} ${st.pending} operação(ões) aguardando sincronização`;
    else el.textContent=st.online?'● Sincronizado':'📴 Offline · nada pendente';
    el.dataset.state=st.attention?'attention':st.pending?'pending':st.online?'online':'offline';
  }
  window.addEventListener('online',()=>{online=true;updateBadge();flush();});
  window.addEventListener('offline',()=>{online=false;updateBadge();});
  setInterval(()=>flush(),10000);
  document.addEventListener('DOMContentLoaded',()=>{updateBadge();setTimeout(()=>flush(),1200);});
  window.SellerOffline={request,flush,status,cachedRead};
})();
