/* AION Skill 2.0 — injeta contexto da tela e reflete o estado real do provedor. */
(function(){
  if(typeof postJSON!=='function')return;
  const originalPostJSON=postJSON;
  postJSON=async function(url,body={}){
    if(url==='/api/aion/ask' && body && typeof body==='object'){
      const route=(typeof currentRoute!=='undefined'&&currentRoute)||'';
      const title=document.getElementById('view-title')?.textContent||'';
      body={...body,screenContext:{route,title,path:location.pathname+location.hash}};
    }
    const result=await originalPostJSON(url,body);
    if(url==='/api/aion/ask' && result && typeof result==='object'){
      const mode=document.getElementById('aion-ai-mode');
      if(mode && result.providerResponded===false){
        mode.textContent=result.providerConfigured?'AION contextual · contingência local (IA externa sem resposta)':'AION contextual · modo local';
      }else if(mode && result.providerResponded===true){
        mode.textContent=result.webUsed?'AION contextual + web':'AION contextual + IA externa';
      }
    }
    return result;
  };
})();
