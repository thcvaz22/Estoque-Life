/* ============================================================
   AIONAGENTROUTES.JS — Skill AION IA 2.0
   Camada contextual/generativa montada antes dos handlers legados.
   Os handlers legados continuam responsáveis por ações estruturadas
   e funcionam como contingência quando a IA externa não estiver ativa.
   ============================================================ */
const express = require('express');
const AionUnified = require('./services/aionUnified');
const AionSkill = require('./services/aionSkill');
const AionLocalContext = require('./services/aionLocalContext');
const ProviderState = require('./services/aionProviderState');

const router = express.Router();

function norm(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}
function explicitOperationalAction(message){
  const q=norm(message);
  return /\b(cadastrar|cadastre|adicionar|criar|registre|registrar|nova entrada|novo pedido|nova saida|nova saída|avaria|perda|relatorio|relatório|pdf)\b/.test(q);
}
function sanitizedScreenContext(req){
  const raw=req.body?.screenContext;
  if(!raw||typeof raw!=='object')return null;
  return {
    route:String(raw.route||raw.routeId||'').slice(0,80),
    title:String(raw.title||raw.viewTitle||'').slice(0,120),
    path:String(raw.path||'').slice(0,160)
  };
}
function evidenceFor(req,message,scope,history){
  const parts=[];
  const data=AionUnified.dataAnswer(req,message,scope,history);
  if(data?.reply)parts.push(`DADO INTERNO VERIFICADO:\n${data.reply}`);
  const help=AionUnified.howTo(message,scope);
  if(help)parts.push(`CONHECIMENTO DO SISTEMA:\n${help}`);
  if(AionUnified.isManagementQuestion(message)){
    parts.push(`ANÁLISE INTERNA VERIFICÁVEL:\n${AionUnified.managementInsight(req,scope)}`);
  }
  return {parts,data,help};
}

async function runAgent(req,res,next,{scope='operational',salesResponse=false}={}){
  const message=String(req.body?.message||'').trim();
  if(!message)return res.status(400).json({error:'Escreva uma pergunta ou solicitação.'});

  // Comandos operacionais explícitos seguem para o executor estruturado já existente.
  if(scope==='operational'&&explicitOperationalAction(message))return next();

  const history=Array.isArray(req.body?.history)?req.body.history.slice(-12):[];
  const screen=sanitizedScreenContext(req);
  try{
    const ev=evidenceFor(req,message,scope,history);
    const market=AionUnified.wantsExternalWeb(message);
    const management=AionUnified.isManagementQuestion(message);
    const prompt=[
      `Pergunta atual do usuário: ${message}`,
      screen?`Contexto da tela atual: rota=${screen.route||'não informada'}; título=${screen.title||'não informado'}; caminho=${screen.path||'não informado'}.`:'',
      ev.parts.length?`Evidências confiáveis disponíveis:\n${ev.parts.join('\n\n')}`:'Não há uma resposta pré-calculada específica; interprete a intenção usando o contexto seguro do sistema e o histórico.',
      'Responda como um analista humano integrado ao sistema, não como FAQ, menu de comandos ou árvore de respostas.',
      'Leia o histórico para resolver referências, continuação do assunto e perguntas incompletas. Considere a tela atual quando ela ajudar a interpretar o pedido.',
      'Escolha dinamicamente se a melhor resposta deve explicar, consultar, analisar, comparar, recomendar ou orientar uma execução.',
      'Quando houver evidência interna, interprete o significado dela. Não apenas repita números ou frases calculadas.',
      'Dê primeiro a resposta mais útil para a pergunta atual e varie a estrutura conforme o assunto; não use sempre o mesmo roteiro.',
      management?'A intenção é analítica: compare dados/períodos disponíveis, destaque causa provável somente quando sustentada, impacto, risco/oportunidade e direção recomendada.':'Adapte profundidade e tom à pergunta.',
      market?'A intenção envolve mercado/benchmark: use pesquisa atual quando disponível, diferencie claramente informação externa de dados internos e traduza a descoberta em aplicação prática para a empresa.':'',
      'Nunca afirme que executou uma ação se o sistema não retornou confirmação real. Ações sensíveis continuam exigindo confirmação no fluxo autorizado.'
    ].filter(Boolean).join('\n\n');

    const configured=AionUnified.status().externalAI;
    ProviderState.markConfigured(configured);
    const external=await AionUnified.externalAnswer({
      req,message:prompt,scope,forceWeb:market||management,history
    });
    if(external){
      ProviderState.success();
      const payload={...external,agentic:true,skillVersion:AionSkill.SKILL.version,providerResponded:true};
      if(salesResponse)payload.text=payload.reply;
      return res.json(payload);
    }
    if(configured) ProviderState.failure('Provedor configurado, mas não retornou resposta válida nesta solicitação.');

    // Sem resposta do provedor generativo: nunca devolve a apresentação genérica.
    // Primeiro usa evidências internas; gestão/mercado mantêm o analisador local;
    // demais perguntas recebem uma contingência contextual ancorada na tela/conversa.
    let fallback=null;
    if(ev.data) fallback={...ev.data,agenticFallback:true,skillVersion:AionSkill.SKILL.version};
    else if(ev.help) fallback={reply:ev.help,source:'local-knowledge',agenticFallback:true,skillVersion:AionSkill.SKILL.version};
    else if(management||market) fallback=await AionUnified.unifiedFallback({req,message,scope,history});
    else fallback=AionLocalContext.answer({message,scope,screen,history,req});

    if(fallback){
      const payload={...fallback,agenticFallback:true,skillVersion:AionSkill.SKILL.version,providerConfigured:configured,providerResponded:false};
      if(salesResponse)payload.text=payload.reply;
      return res.json(payload);
    }
    return next();
  }catch(err){
    console.warn(`[AION Agent ${scope}] fallback contextual:`,err.message);
    ProviderState.failure(err.message);
    const fallback=AionLocalContext.answer({message,scope,screen,history,req});
    const payload={...fallback,agenticFallback:true,skillVersion:AionSkill.SKILL.version,providerResponded:false};
    if(salesResponse)payload.text=payload.reply;
    return res.json(payload);
  }
}

router.get('/status',(req,res)=>{
  const base=AionUnified.status();
  res.json({...base,providerHealth:ProviderState.snapshot(),skillVersion:AionSkill.SKILL.version});
});
router.post('/ask',(req,res,next)=>runAgent(req,res,next,{scope:'operational'}));
router.post('/assistant',(req,res,next)=>runAgent(req,res,next,{scope:'sales',salesResponse:true}));

module.exports=router;
