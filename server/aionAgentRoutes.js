/* ============================================================
   AIONAGENTROUTES.JS — Skill AION IA 2.0
   Agente contextual com Gemini como provedor generativo principal.
   ============================================================ */
const express = require('express');
const AionUnified = require('./services/aionUnified');
const AionSkill = require('./services/aionSkill');
const AionLocalContext = require('./services/aionLocalContext');
const ProviderState = require('./services/aionProviderState');
const Gemini = require('./services/aionGeminiProvider');

const router = express.Router();

function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
function explicitOperationalAction(message){const q=norm(message);return /\b(cadastrar|cadastre|adicionar|criar|registre|registrar|nova entrada|novo pedido|nova saida|nova saída|avaria|perda|relatorio|relatório|pdf)\b/.test(q);}
function sanitizedScreenContext(req){const raw=req.body?.screenContext;if(!raw||typeof raw!=='object')return null;return {route:String(raw.route||raw.routeId||'').slice(0,80),title:String(raw.title||raw.viewTitle||'').slice(0,120),path:String(raw.path||'').slice(0,160)};}
function evidenceFor(req,message,scope,history){
  const parts=[];const data=AionUnified.dataAnswer(req,message,scope,history);if(data?.reply)parts.push(`DADO INTERNO VERIFICADO:\n${data.reply}`);
  const help=AionUnified.howTo(message,scope);if(help)parts.push(`CONHECIMENTO DO SISTEMA:\n${help}`);
  if(AionUnified.isManagementQuestion(message))parts.push(`ANÁLISE INTERNA VERIFICÁVEL:\n${AionUnified.managementInsight(req,scope)}`);
  return {parts,data,help};
}
function providerStatus(){
  const gemini=Gemini.status();
  if(gemini.externalAI)return {...gemini,skill:AionSkill.publicSummary(),marketAwareness:true,advancedAnalytics:true};
  return {...AionUnified.status(),provider:null};
}
async function providerAnswer(args){
  if(Gemini.status().externalAI)return Gemini.externalAnswer(args);
  return AionUnified.externalAnswer(args);
}

async function runAgent(req,res,next,{scope='operational',salesResponse=false}={}){
  const message=String(req.body?.message||'').trim();if(!message)return res.status(400).json({error:'Escreva uma pergunta ou solicitação.'});
  if(scope==='operational'&&explicitOperationalAction(message))return next();
  const history=Array.isArray(req.body?.history)?req.body.history.slice(-12):[];const screen=sanitizedScreenContext(req);
  try{
    const ev=evidenceFor(req,message,scope,history);const market=AionUnified.wantsExternalWeb(message);const management=AionUnified.isManagementQuestion(message);
    const prompt=[`Pergunta atual do usuário: ${message}`,screen?`Contexto da tela atual: rota=${screen.route||'não informada'}; título=${screen.title||'não informado'}; caminho=${screen.path||'não informado'}.`:'',ev.parts.length?`Evidências confiáveis disponíveis:\n${ev.parts.join('\n\n')}`:'Não há uma resposta pré-calculada específica; interprete a intenção usando o contexto seguro do sistema e o histórico.','Você é a AION IA, analista contextual integrado ao Life Sucos. Responda como um analista humano integrado ao sistema, não como FAQ ou árvore de respostas.','Use o histórico para entender continuidade e referências. Escolha dinamicamente entre explicar, consultar, analisar, comparar, recomendar ou orientar uma execução.','Quando houver evidência interna, trate-a como fonte confiável e interprete seu significado. Não invente dados internos.','Comece pela resposta direta e adapte a profundidade ao assunto. Não repita sempre a mesma estrutura.',management?'A intenção é analítica: destaque cenário, impacto, risco/oportunidade e direção recomendada com base nas evidências.':'',market?'A intenção envolve mercado/benchmark: use Google Search quando disponível, diferencie informação externa de dados internos e transforme a descoberta em aplicação prática para a empresa.':'','Nunca afirme que executou uma ação sem confirmação real do sistema.'].filter(Boolean).join('\n\n');
    const st=providerStatus();const configured=st.externalAI;ProviderState.markConfigured(configured);
    const external=await providerAnswer({req,message:prompt,scope,forceWeb:market||management,history});
    if(external){ProviderState.success();const payload={...external,agentic:true,skillVersion:AionSkill.SKILL.version,providerResponded:true};if(salesResponse)payload.text=payload.reply;return res.json(payload);}
    if(configured)ProviderState.failure(`${st.provider||'Provedor'} configurado, mas não retornou resposta válida nesta solicitação.`);
    let fallback=null;if(ev.data)fallback={...ev.data};else if(ev.help)fallback={reply:ev.help,source:'local-knowledge'};else if(management||market)fallback=AionLocalContext.answer({message,scope,screen,history,req});else fallback=AionLocalContext.answer({message,scope,screen,history,req});
    const payload={...fallback,agenticFallback:true,skillVersion:AionSkill.SKILL.version,providerConfigured:configured,providerResponded:false};if(salesResponse)payload.text=payload.reply;return res.json(payload);
  }catch(err){console.warn(`[AION Agent ${scope}] fallback contextual:`,err.message);ProviderState.failure(err.message);const fallback=AionLocalContext.answer({message,scope,screen,history,req});const payload={...fallback,agenticFallback:true,skillVersion:AionSkill.SKILL.version,providerResponded:false};if(salesResponse)payload.text=payload.reply;return res.json(payload);}
}

router.get('/status',(req,res)=>{const base=providerStatus();res.json({...base,providerHealth:ProviderState.snapshot(),skillVersion:AionSkill.SKILL.version});});
router.post('/ask',(req,res,next)=>runAgent(req,res,next,{scope:'operational'}));
router.post('/assistant',(req,res,next)=>runAgent(req,res,next,{scope:'sales',salesResponse:true}));
module.exports=router;
