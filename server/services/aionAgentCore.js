/* AION AGENT CORE 3.0 — planejamento, memória, métricas e inteligência proativa */
const { Data } = require('../db');
const inventory = require('./inventoryService');

const CORE_VERSION='3.0';
function docs(name){try{return Data.all(name)||[];}catch{return [];}}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function iso(v){return String(v||'').slice(0,10);}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function daysAgo(n){const d=new Date(`${today()}T12:00:00-03:00`);d.setDate(d.getDate()-n);return d.toLocaleDateString('sv-SE');}
function pct(cur,prev){return prev?((cur-prev)/Math.abs(prev))*100:null;}
function money(v){return num(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function sales(rows){const ok=new Set(['aprovado','faturando','faturado','separacao','em_rota','entregue']);return rows.filter(o=>ok.has(String(o.status||'').toLowerCase()));}
function sumOrders(rows){return rows.reduce((a,o)=>a+num(o.total),0);}

function metrics(req){
  let orders=docs('orders');
  if(req?.authUser?.perfil==='Vendedor')orders=orders.filter(o=>o.vendedorId===req.authUser.id);
  const confirmed=sales(orders), now=today(), from30=daysAgo(29), prevFrom=daysAgo(59), prevTo=daysAgo(30);
  const cur30=confirmed.filter(o=>{const d=iso(o.criadoEm||o.data);return d>=from30&&d<=now;});
  const prev30=confirmed.filter(o=>{const d=iso(o.criadoEm||o.data);return d>=prevFrom&&d<=prevTo;});
  const revenue30=sumOrders(cur30), prevRevenue=sumOrders(prev30);
  const exits=docs('exits'), backlog=docs('backlog'), losses=docs('losses');
  const losses30=losses.filter(x=>iso(x.data)>=from30).reduce((a,x)=>a+num(x.quantidade),0);
  const backlogPending=backlog.filter(x=>['bloqueado','pendente'].includes(String(x.status))).length;
  const pendingOrders=orders.filter(o=>String(o.status)==='enviado').length;
  let lots=[];try{lots=inventory.listAllLots();}catch{}
  const products=docs('products').filter(p=>p.ativo!==false), by=new Map();
  for(const l of lots){const x=by.get(l.productId)||{available:0,blocked:0};x.available+=num(l.quantidadeDisponivel);x.blocked+=num(l.quantidadeBloqueada);by.set(l.productId,x);}
  const zero=products.filter(p=>(by.get(p.id)?.available||0)<=0);
  const low=products.filter(p=>{const q=by.get(p.id)?.available||0,m=num(p.estoqueMinimo);return m>0&&q>0&&q<m;});
  const blocked=[...by.values()].reduce((a,x)=>a+x.blocked,0);
  const daily=[];for(let i=6;i>=0;i--){const d=daysAgo(i),val=sumOrders(confirmed.filter(o=>iso(o.criadoEm||o.data)===d));daily.push({date:d,revenue:val});}
  const avgDaily=daily.reduce((a,x)=>a+x.revenue,0)/7;
  return {generatedAt:new Date().toISOString(),revenue30,previousRevenue30:prevRevenue,revenueChangePct:pct(revenue30,prevRevenue),orders30:cur30.length,ticket30:cur30.length?revenue30/cur30.length:0,projectedNext30:avgDaily*30,avgDaily7:avgDaily,pendingOrders,backlogPending,losses30,zeroStock:zero.length,lowStock:low.length,blockedUnits:blocked,zeroProducts:zero.slice(0,5).map(p=>p.nome),lowProducts:low.slice(0,5).map(p=>({name:p.nome,available:by.get(p.id)?.available||0,min:num(p.estoqueMinimo)})),exits30:exits.filter(x=>iso(x.horarioSaida)>=from30).length};
}

function card({id,severity='info',category,title,summary,detail,confidence='alta',evidence=[],metrics:cardMetrics={},actions=[]}){return{id,severity,category,title,summary,detail,confidence,evidence,metrics:cardMetrics,actions};}
function proactive(req){
  const m=metrics(req), cards=[];
  if(m.zeroStock)cards.push(card({id:'stock-zero',severity:'critical',category:'Estoque',title:`${m.zeroStock} produto(s) sem estoque`,summary:'Há risco imediato de ruptura e perda de venda.',detail:`Produtos sem disponibilidade: ${m.zeroProducts.join(', ')||'consulte o estoque'}. AION recomenda validar demanda recente, backlog e reposição antes de liberar novos pedidos.`,evidence:['Estoque disponível atual'],metrics:{zerados:m.zeroStock},actions:[{id:'open-stock',label:'Abrir estoque',type:'navigate',target:'stock'},{id:'analyze-replenishment',label:'AION analisar reposição',type:'agent',prompt:'Analise os produtos sem estoque, priorize a reposição por impacto comercial e me diga o melhor plano de ação.'}]}));
  if(m.lowStock)cards.push(card({id:'stock-low',severity:'warning',category:'Estoque',title:`${m.lowStock} produto(s) abaixo do mínimo`,summary:'O estoque está abaixo da faixa planejada para alguns itens.',detail:`Itens prioritários: ${m.lowProducts.map(x=>`${x.name} (${x.available}/${x.min})`).join(', ')}.`,evidence:['Estoque mínimo cadastrado','Saldo disponível'],metrics:{abaixoMinimo:m.lowStock},actions:[{id:'review-min',label:'Revisar estoque',type:'navigate',target:'stock'},{id:'plan-stock',label:'Criar plano com AION',type:'agent',prompt:'Monte um plano de reposição para os itens abaixo do estoque mínimo, considerando prioridade, risco e próximos passos.'}]}));
  if(m.backlogPending)cards.push(card({id:'backlog',severity:'warning',category:'Operação',title:`${m.backlogPending} item(ns) pendentes no backlog`,summary:'Estoque bloqueado pode estar reduzindo a disponibilidade real.',detail:'Tratar backlog antes de novas liberações melhora a leitura do estoque e evita prometer produto indisponível.',evidence:['Backlog operacional'],actions:[{id:'open-backlog',label:'Abrir backlog',type:'navigate',target:'backlog'},{id:'analyze-backlog',label:'AION priorizar backlog',type:'agent',prompt:'Analise o backlog atual e me diga o que devo tratar primeiro e por quê.'}]}));
  if(m.pendingOrders)cards.push(card({id:'pending-orders',severity:'info',category:'Comercial',title:`${m.pendingOrders} pedido(s) aguardando aprovação`,summary:'Há demanda comercial parada antes da separação.',detail:'AION recomenda revisar disponibilidade, condição do cliente e impacto da fila antes da aprovação.',evidence:['Pedidos enviados'],actions:[{id:'open-orders',label:'Abrir pedidos',type:'navigate',target:'commercialOrders'},{id:'analyze-orders',label:'AION priorizar pedidos',type:'agent',prompt:'Analise os pedidos aguardando aprovação e sugira uma ordem de prioridade com justificativa.'}]}));
  const change=m.revenueChangePct;
  if(change!==null)cards.push(card({id:'sales-trend',severity:change<-10?'warning':'success',category:'Gestão',title:`Faturamento 30d ${change>=0?'subiu':'caiu'} ${Math.abs(change).toFixed(1)}%`,summary:`Atual ${money(m.revenue30)} vs. ${money(m.previousRevenue30)} nos 30 dias anteriores.`,detail:`Ticket médio atual: ${money(m.ticket30)}. Mantido o ritmo dos últimos 7 dias, projeção simples para os próximos 30 dias: ${money(m.projectedNext30)}.`,confidence:'média',evidence:['Pedidos confirmados dos últimos 60 dias','Ritmo dos últimos 7 dias'],metrics:{faturamento30:m.revenue30,variacaoPct:change,projecao30:m.projectedNext30},actions:[{id:'deep-sales',label:'Análise completa',type:'agent',prompt:'Faça uma análise completa do desempenho comercial: compare períodos, explique tendências, riscos, oportunidades e projeções e recomende as melhores ações.'}]}));
  if(m.losses30>0)cards.push(card({id:'losses',severity:'info',category:'Eficiência',title:`${m.losses30} unidade(s) em perdas/avarias em 30 dias`,summary:'Vale acompanhar recorrência por produto e causa.',detail:'Cruzar perdas com entradas, lotes e movimentação ajuda a identificar causa recorrente e oportunidade de redução.',evidence:['Avarias e perdas registradas'],actions:[{id:'open-loss',label:'Abrir perdas',type:'navigate',target:'losses'},{id:'analyze-loss',label:'AION investigar',type:'agent',prompt:'Analise perdas e avarias recentes, procure padrões, possíveis causas e ações para reduzir recorrência.'}]}));
  if(!cards.length)cards.push(card({id:'healthy',severity:'success',category:'Gestão',title:'Operação sem alertas críticos',summary:'AION não detectou ruptura, backlog ou fila crítica neste momento.',detail:'Aproveite o cenário estável para revisar tendências, projeções e oportunidades comerciais.',actions:[{id:'full-review',label:'Fazer análise geral',type:'agent',prompt:'Faça uma análise geral da empresa com métricas, comparativos, projeções, riscos, oportunidades e prioridades para os próximos dias.'}]}));
  return {coreVersion:CORE_VERSION,metrics:m,cards:cards.slice(0,6)};
}
function saveMemory(req,{type='regra',title,content,tags=[]}){if(!title||!content)throw new Error('Título e conteúdo são obrigatórios.');const id=`aionmem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;const row={id,type,title:String(title).slice(0,140),content:String(content).slice(0,3000),tags:Array.isArray(tags)?tags.slice(0,10):[],createdAt:new Date().toISOString(),createdBy:req?.authUser?.id||null};Data.upsert('aion_memory',id,row);return row;}
function memories(){return docs('aion_memory').slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,100);}
function plan({goal,context={}}){const g=String(goal||'').trim();if(!g)throw new Error('Informe o objetivo.');return{coreVersion:CORE_VERSION,goal:g,intent:'planejar-executar',steps:[{step:1,action:'consultar_contexto',description:'Ler dados e estado atual relacionados ao objetivo.'},{step:2,action:'analisar',description:'Comparar métricas, histórico, riscos e alternativas.'},{step:3,action:'coletar_dados_faltantes',description:'Pedir somente os dados que não podem ser inferidos do sistema.'},{step:4,action:'preparar_execucao',description:'Montar a ação estruturada com parâmetros e validações.'},{step:5,action:'confirmar_se_critico',description:'Solicitar confirmação apenas quando houver risco, irreversibilidade, efeito financeiro ou movimentação de estoque.'},{step:6,action:'executar_e_verificar',description:'Executar pelo endpoint autorizado e verificar o resultado real.'}],context};}
module.exports={CORE_VERSION,metrics,proactive,saveMemory,memories,plan};