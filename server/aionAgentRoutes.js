/* ============================================================
   AIONAGENTROUTES.JS — AION Agent Core 3.0
   Agente contextual com Gemini, memória, objetivos, especialistas, planejamento e proatividade.
   ============================================================ */
const express = require('express');
const AionUnified = require('./services/aionUnified');
const AionSkill = require('./services/aionSkill');
const AionLocalContext = require('./services/aionLocalContext');
const ProviderState = require('./services/aionProviderState');
const Gemini = require('./services/aionGeminiProvider');
const Core = require('./services/aionAgentCore');
const Goals = require('./services/aionGoals');
const Specialists = require('./services/aionSpecialists');

const router = express.Router();
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
function explicitOperationalAction(message){const q=norm(message);return /\b(cadastrar|cadastre|adicionar|criar|registre|registrar|nova entrada|novo pedido|nova saida|nova saída|avaria|perda|relatorio|relatório|pdf)\b/.test(q);}
function actionConversation(message,history=[]){
  const recentUsers=history.filter(x=>x?.role!=='assistant').slice(-4).map(x=>String(x?.content||x?.text||'').trim()).filter(Boolean);
  const combined=[...recentUsers,String(message||'').trim()].filter(Boolean).join(' ; ');
  return {combined,hasAction:explicitOperationalAction(combined),currentHasAction:explicitOperationalAction(message)};
}
function sanitizedScreenContext(req){const raw=req.body?.screenContext;if(!raw||typeof raw!=='object')return null;return {route:String(raw.route||raw.routeId||'').slice(0,80),title:String(raw.title||raw.viewTitle||'').slice(0,120),path:String(raw.path||'').slice(0,160)};}
function evidenceFor(req,message,scope,history){
  const parts=[];const data=AionUnified.dataAnswer(req,message,scope,history);if(data?.reply)parts.push(`DADO INTERNO VERIFICADO:\n${data.reply}`);
  const help=AionUnified.howTo(message,scope);if(help)parts.push(`CONHECIMENTO DO SISTEMA:\n${help}`);
  if(AionUnified.isManagementQuestion(message))parts.push(`ANÁLISE INTERNA VERIFICÁVEL:\n${AionUnified.managementInsight(req,scope)}`);
  const mem=Core.memories().slice(0,12);if(mem.length)parts.push(`MEMÓRIA EMPRESARIAL VALIDADA:\n${mem.map(x=>`- ${x.title}: ${x.content}`).join('\n')}`);
  const goals=Goals.summary();if(goals.length)parts.push(`OBJETIVOS ATIVOS:\n${goals.map(g=>`- ${g.title}: ${g.progressPct===null?'progresso manual':`${g.progressPct.toFixed(1)}%`}${g.dueDate?` · prazo ${g.dueDate}`:''}`).join('\n')}`);
  return {parts,data,help};
}
function providerStatus(){const gemini=Gemini.status();if(gemini.externalAI)return {...gemini,skill:AionSkill.publicSummary(),coreVersion:Core.CORE_VERSION,marketAwareness:true,advancedAnalytics:true};return {...AionUnified.status(),provider:null,coreVersion:Core.CORE_VERSION};}
async function providerAnswer(args){if(Gemini.status().externalAI)return Gemini.externalAnswer(args);return AionUnified.externalAnswer(args);}

async function runAgent(req,res,next,{scope='operational',salesResponse=false}={}){
  const message=String(req.body?.message||'').trim();if(!message)return res.status(400).json({error:'Escreva uma pergunta ou solicitação.'});
  const history=Array.isArray(req.body?.history)?req.body.history.slice(-12):[];
  if(scope==='operational'){
    const actionCtx=actionConversation(message,history);
    if(actionCtx.hasAction){
      // Continuidade de ação: respostas curtas como “Carlos”, “NF 123” ou
      // “24 unidades” são recombinadas com o pedido original antes de chegar
      // ao executor estruturado. Assim o objetivo não se perde entre turnos.
      if(!actionCtx.currentHasAction) req.body.message=actionCtx.combined;
      return next();
    }
  }
  const screen=sanitizedScreenContext(req);
  try{
    const ev=evidenceFor(req,message,scope,history),market=AionUnified.wantsExternalWeb(message),management=AionUnified.isManagementQuestion(message),coreMetrics=Core.metrics(req),specialists=Specialists.route(message);
    const prompt=[
      `Pergunta atual do usuário: ${message}`,
      screen?`Contexto da tela atual: rota=${screen.route||'não informada'}; título=${screen.title||'não informado'}; caminho=${screen.path||'não informado'}.`:'',
      ev.parts.length?`Evidências confiáveis disponíveis:\n${ev.parts.join('\n\n')}`:'Não há uma resposta pré-calculada específica; interprete a intenção usando o contexto seguro do sistema e o histórico.',
      `MÉTRICAS DO AGENT CORE 3.0: ${JSON.stringify(coreMetrics)}`,
      `ESPECIALISTAS INTERNOS ATIVADOS: ${specialists.map(s=>`${s.name} (${s.focus})`).join(' | ')}`,
      'Você é a AION IA, uma única inteligência para o usuário. Os especialistas internos são perspectivas de análise; sintetize tudo em uma resposta coerente e não exponha uma discussão artificial entre agentes.',
      'Responda como um analista humano integrado ao sistema, não como FAQ ou árvore de respostas.',
      'Antes de responder, planeje silenciosamente quais dados precisa consultar, o que pode inferir, o que ainda precisa perguntar e qual é a melhor próxima ação.',
      'Use histórico, memória empresarial e objetivos ativos para entender continuidade, regras, prioridades e metas já validadas.',
      'Escolha dinamicamente entre explicar, consultar, analisar, comparar, projetar, recomendar, planejar ou orientar uma execução.',
      'Quando a pergunta pedir análise, traga métricas, comparativos, tendência, projeção e recomendação sempre que os dados permitirem. Diferencie fato, projeção e hipótese.',
      'Se uma tarefa puder ser executada pelo sistema, conduza o usuário: peça somente os dados realmente ausentes, prepare a operação e indique a confirmação necessária. Não mande o usuário fazer manualmente algo que a AION pode executar por ação autorizada.',
      'Quando houver evidência interna, trate-a como fonte confiável e interprete seu significado. Não invente dados internos.',
      management?'A intenção é analítica: destaque cenário, comparação, tendência, projeção, impacto, risco/oportunidade e direção recomendada com base nas evidências.':'',
      market?'A intenção envolve mercado/benchmark: use Google Search quando disponível, diferencie informação externa de dados internos e transforme a descoberta em aplicação prática para a empresa.':'',
      'Nunca afirme que executou uma ação sem confirmação real do sistema. Ações destrutivas, financeiras, aprovações e movimentações de estoque exigem confirmação adequada.'
    ].filter(Boolean).join('\n\n');
    const st=providerStatus(),configured=st.externalAI;ProviderState.markConfigured(configured);
    const external=await providerAnswer({req,message:prompt,scope,forceWeb:market||management,history});
    if(external){ProviderState.success();const payload={...external,agentic:true,coreVersion:Core.CORE_VERSION,specialists:specialists.map(s=>s.id),skillVersion:AionSkill.SKILL.version,providerResponded:true};if(salesResponse)payload.text=payload.reply;return res.json(payload);}
    if(configured)ProviderState.failure(`${st.provider||'Provedor'} configurado, mas não retornou resposta válida nesta solicitação.`);
    let fallback=null;if(ev.data)fallback={...ev.data};else if(ev.help)fallback={reply:ev.help,source:'local-knowledge'};else fallback=AionLocalContext.answer({message,scope,screen,history,req});
    const payload={...fallback,agenticFallback:true,coreVersion:Core.CORE_VERSION,specialists:specialists.map(s=>s.id),skillVersion:AionSkill.SKILL.version,providerConfigured:configured,providerResponded:false};if(salesResponse)payload.text=payload.reply;return res.json(payload);
  }catch(err){console.warn(`[AION Agent ${scope}] fallback contextual:`,err.message);ProviderState.failure(err.message);const fallback=AionLocalContext.answer({message,scope,screen,history,req});const payload={...fallback,agenticFallback:true,coreVersion:Core.CORE_VERSION,skillVersion:AionSkill.SKILL.version,providerResponded:false};if(salesResponse)payload.text=payload.reply;return res.json(payload);}
}

router.get('/status',(req,res)=>{const base=providerStatus();res.json({...base,providerHealth:ProviderState.snapshot(),skillVersion:AionSkill.SKILL.version});});
router.get('/core/status',(req,res)=>res.json({ok:true,coreVersion:Core.CORE_VERSION,provider:providerStatus(),specialists:Object.keys(Specialists.SPECIALISTS)}));
router.get('/core/metrics',(req,res)=>res.json(Core.metrics(req)));
router.get('/core/proactive',(req,res)=>res.json(Core.proactive(req)));
router.get('/core/memory',(req,res)=>res.json({items:Core.memories()}));
router.post('/core/memory',(req,res)=>{try{res.status(201).json(Core.saveMemory(req,req.body||{}));}catch(e){res.status(400).json({error:e.message});}});
router.get('/core/goals',(req,res)=>res.json({items:Goals.list()}));
router.post('/core/goals',(req,res)=>{try{res.status(201).json(Goals.create(req,req.body||{}));}catch(e){res.status(400).json({error:e.message});}});
router.patch('/core/goals/:id',(req,res)=>{try{res.json(Goals.update(req.params.id,req.body||{}));}catch(e){res.status(404).json({error:e.message});}});
router.post('/core/plan',(req,res)=>{try{res.json({...Core.plan(req.body||{}),specialists:Specialists.route(req.body?.goal||'')} );}catch(e){res.status(400).json({error:e.message});}});
router.post('/ask',(req,res,next)=>runAgent(req,res,next,{scope:'operational'}));
router.post('/assistant',(req,res,next)=>runAgent(req,res,next,{scope:'sales',salesResponse:true}));
module.exports=router;
