/* AION Skill 2.0 — injeta contexto da tela em perguntas sem acoplar a UI ao backend. */
(function(){
  if(typeof postJSON!=='function')return;
  const originalPostJSON=postJSON;
  postJSON=async function(url,body={}){
    if(url==='/api/aion/ask' && body && typeof body==='object'){
      const route=(typeof currentRoute!=='undefined'&&currentRoute)||'';
      const title=document.getElementById('view-title')?.textContent||'';
      body={...body,screenContext:{route,title,path:location.pathname+location.hash}};
    }
    return originalPostJSON(url,body);
  };
})();
