/* AION IA — provedor Gemini (Google AI Studio / Gemini API)
   Mantém a chave exclusivamente no servidor e habilita Google Search grounding
   apenas quando a pergunta exige informação externa atual. */

function normalizeHistory(history){
  if(!Array.isArray(history)) return [];
  return history.slice(-10).map(x=>({
    role:x?.role==='assistant'?'model':'user',
    parts:[{text:String(x?.content||x?.text||'').slice(0,1200)}]
  })).filter(x=>x.parts[0].text.trim());
}

function status(){
  const aiFlag=String(process.env.AION_EXTERNAL_AI_ENABLED||'auto').toLowerCase();
  const enabled=!!process.env.GEMINI_API_KEY && aiFlag!=='false';
  const web=enabled && String(process.env.AION_WEB_SEARCH_ENABLED||'true').toLowerCase()!=='false';
  return {
    externalAI:enabled,
    webSearch:web,
    provider:enabled?'gemini':null,
    model:enabled?(process.env.GEMINI_MODEL||process.env.AION_MODEL||'gemini-2.5-flash'):null,
    mode:enabled?(web?'conversacional + Gemini + Google Search':'conversacional + Gemini'):'conversacional local'
  };
}

function outputText(data){
  const parts=data?.candidates?.[0]?.content?.parts||[];
  return parts.map(p=>p?.text||'').filter(Boolean).join('\n').trim();
}

async function externalAnswer({message,forceWeb=false,history=[]}){
  const st=status();
  if(!st.externalAI) return null;
  const useWeb=!!(st.webSearch&&forceWeb);
  const model=st.model;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),25000);
  try{
    const contents=normalizeHistory(history);
    contents.push({role:'user',parts:[{text:String(message||'').slice(0,12000)}]});
    const body={
      contents,
      generationConfig:{temperature:0.35,maxOutputTokens:1800}
    };
    if(useWeb) body.tools=[{google_search:{}}];
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data?.error?.message||`Gemini HTTP ${r.status}`);
    const reply=outputText(data);
    if(!reply) return null;
    const grounding=data?.candidates?.[0]?.groundingMetadata;
    return {reply,source:'gemini',provider:'gemini',webUsed:!!(useWeb&&grounding),grounded:!!grounding};
  }catch(err){
    console.warn('[AION] Gemini indisponível:',err.message);
    return null;
  }finally{
    clearTimeout(timer);
  }
}

module.exports={status,externalAnswer};
