/* ============================================================
   AION UNIFIED INTELLIGENCE — Life Sucos / Life Vendas

   Camada compartilhada entre o sistema operacional e o comercial.
   Prioriza respostas determinísticas para dados internos e procedimentos,
   usa análise local para gestão e, opcionalmente, uma IA externa com busca
   na web quando o servidor estiver configurado para isso.

   Segurança:
   - nenhuma ação crítica é executada pela IA externa;
   - chaves ficam apenas no servidor via variáveis de ambiente;
   - buscas externas recebem contexto agregado, sem listas de clientes;
   - Responses API é chamada com store:false.
   ============================================================ */

const { Data } = require('../db');
const svc = require('./inventoryService');
const AionSkill = require('./aionSkill');

function norm(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}
function money(v){ return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function today(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function firstDayOfMonth(){ return today().slice(0,8)+'01'; }
function dateOf(v){ return String(v||'').slice(0,10); }
function docs(name){ try{return Data.all(name)||[];}catch{return [];} }
function activeCustomers(req){
  let rows=docs('customers').filter(c=>c.ativo!==false);
  if(req?.authUser?.perfil==='Vendedor') rows=rows.filter(c=>c.vendedorId===req.authUser.id);
  return rows;
}
function visibleOrders(req){
  let rows=docs('orders');
  if(req?.authUser?.perfil==='Vendedor') rows=rows.filter(o=>o.vendedorId===req.authUser.id);
  return rows;
}
function salesOrders(rows){
  const ok=new Set(['aprovado','faturando','faturado','separacao','em_rota','entregue']);
  return rows.filter(o=>ok.has(String(o.status||'').toLowerCase()));
}
function currentMonth(rows,field='criadoEm'){
  const from=firstDayOfMonth(),to=today();
  return rows.filter(x=>{const d=dateOf(x[field]||x.data||x.horarioSaida);return d>=from&&d<=to;});
}
function topEntries(obj,n=5){ return Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n); }
function inventorySummary(){
  const products=docs('products').filter(p=>p.ativo!==false);
  let lots=[]; try{lots=svc.listAllLots();}catch{}
  const by=new Map();
  for(const l of lots){
    if(!by.has(l.productId)) by.set(l.productId,{available:0,blocked:0});
    const x=by.get(l.productId); x.available+=Number(l.quantidadeDisponivel||0); x.blocked+=Number(l.quantidadeBloqueada||0);
  }
  const zero=products.filter(p=>(by.get(p.id)?.available||0)<=0);
  const low=products.filter(p=>{const q=by.get(p.id)?.available||0;const min=Number(p.estoqueMinimo||0);return min>0&&q>0&&q<min;});
  return {products,lots,by,zero,low};
}


function isoDate(y,m,d){
  const mm=String(m).padStart(2,'0'),dd=String(d).padStart(2,'0');
  return `${y}-${mm}-${dd}`;
}
function dateParts(iso){const [y,m,d]=String(iso||'').slice(0,10).split('-').map(Number);return {y,m,d};}
function daysInMonth(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate();}
function shiftMonth(y,m,delta){const dt=new Date(Date.UTC(y,m-1+delta,1));return {y:dt.getUTCFullYear(),m:dt.getUTCMonth()+1};}
function monthStart(y,m){return isoDate(y,m,1);}
function sumRevenue(rows){return salesOrders(rows).reduce((a,o)=>a+Number(o.total||0),0);}
function percentChange(current,previous){if(!Number.isFinite(previous)||previous===0)return null;return ((current-previous)/Math.abs(previous))*100;}
function fmtPct(v){if(v===null||v===undefined||!Number.isFinite(v))return 'n/d';return `${v>=0?'+':''}${v.toFixed(1)}%`;}
function avg(values){const a=values.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;}
function pearson(xs,ys){
  if(xs.length!==ys.length||xs.length<4)return null;
  const ax=avg(xs),ay=avg(ys);let num=0,dx=0,dy=0;
  for(let i=0;i<xs.length;i++){const x=xs[i]-ax,y=ys[i]-ay;num+=x*y;dx+=x*x;dy+=y*y;}
  if(!dx||!dy)return null;return num/Math.sqrt(dx*dy);
}
function monthlyBuckets(rows,months=13){
  const t=dateParts(today()),result=[];
  for(let back=months;back>=1;back--){
    const x=shiftMonth(t.y,t.m,-back),from=monthStart(x.y,x.m),to=isoDate(x.y,x.m,daysInMonth(x.y,x.m));
    const monthRows=rows.filter(o=>{const d=dateOf(o.criadoEm||o.data||o.horarioSaida);return d>=from&&d<=to;});
    const confirmed=salesOrders(monthRows),revenue=confirmed.reduce((a,o)=>a+Number(o.total||0),0);
    result.push({month:`${x.y}-${String(x.m).padStart(2,'0')}`,revenue,orders:confirmed.length,avgTicket:confirmed.length?revenue/confirmed.length:0});
  }
  return result;
}
function projectionScenarios(baseMonthly,horizon){
  const base=Math.max(0,baseMonthly||0)*horizon;
  return {conservative:Number((base*0.85).toFixed(2)),base:Number(base.toFixed(2)),optimistic:Number((base*1.15).toFixed(2))};
}
function findConfiguredTargets(){
  const metas=docs('meta');
  const candidates=[];
  for(const row of metas){
    if(!row||typeof row!=='object')continue;
    const pairs=[['meta',row.metaVendasMensal??row.salesTarget??row.metaMensal],['orcamento',row.orcamentoVendasMensal??row.salesBudget??row.budget],['forecast',row.forecastVendasMensal??row.salesForecast??row.forecast]];
    for(const [kind,value] of pairs){const n=Number(value);if(Number.isFinite(n)&&n>0)candidates.push([kind,n]);}
  }
  return Object.fromEntries(candidates);
}
function advancedAnalytics(req,scope='operational'){
  const allSales=salesOrders(visibleOrders(req));
  const t=dateParts(today());
  const pm=shiftMonth(t.y,t.m,-1),py={y:t.y-1,m:t.m};
  const curFrom=monthStart(t.y,t.m),curTo=today();
  const prevFrom=monthStart(pm.y,pm.m),prevTo=isoDate(pm.y,pm.m,Math.min(t.d,daysInMonth(pm.y,pm.m)));
  const yoyFrom=monthStart(py.y,py.m),yoyTo=isoDate(py.y,py.m,Math.min(t.d,daysInMonth(py.y,py.m)));
  const between=(from,to)=>allSales.filter(o=>{const d=dateOf(o.criadoEm||o.data||o.horarioSaida);return d>=from&&d<=to;});
  const cur=between(curFrom,curTo),prev=between(prevFrom,prevTo),yoy=between(yoyFrom,yoyTo);
  const curRev=sumRevenue(cur),prevRev=sumRevenue(prev),yoyRev=sumRevenue(yoy);
  const ytd=between(`${t.y}-01-01`,curTo),priorYtd=between(`${t.y-1}-01-01`,isoDate(t.y-1,t.m,Math.min(t.d,daysInMonth(t.y-1,t.m))));
  const ytdRev=sumRevenue(ytd),priorYtdRev=sumRevenue(priorYtd);
  const months=monthlyBuckets(allSales,13);
  const completed=months.slice(-12),revenues=completed.map(x=>x.revenue),counts=completed.map(x=>x.orders);
  const ma3=avg(revenues.slice(-3)),ma6=avg(revenues.slice(-6)),ma12=avg(revenues.slice(-12));
  const recent=revenues.slice(-6);let slope=null;
  if(recent.length>=3){const first=avg(recent.slice(0,Math.ceil(recent.length/2))),last=avg(recent.slice(-Math.ceil(recent.length/2)));if(first&&last!==null)slope=((last-first)/Math.abs(first))*100;}
  const lastCompleted=completed.at(-1)?.revenue||0, anomalyPct=ma3?((lastCompleted-ma3)/ma3)*100:null;
  const corr=pearson(revenues,counts);
  let baseMonthly=ma3??ma6??ma12??curRev;
  if(slope!==null) baseMonthly=Math.max(0,baseMonthly*(1+Math.max(-0.20,Math.min(0.20,slope/100))/2));
  const targets=findConfiguredTargets();
  return {
    scope,
    currentMTD:{revenue:curRev,orders:cur.length,avgTicket:cur.length?curRev/cur.length:0},
    previousMTD:{revenue:prevRev,orders:prev.length},
    yearAgoMTD:{revenue:yoyRev,orders:yoy.length},
    comparisons:{momPct:percentChange(curRev,prevRev),yoyPct:percentChange(curRev,yoyRev),ytdPct:percentChange(ytdRev,priorYtdRev)},
    ytd:{revenue:ytdRev,priorYearRevenue:priorYtdRev},
    movingAverages:{m3:ma3,m6:ma6,m12:ma12},
    trend:{direction:slope===null?'dados insuficientes':slope>5?'alta':slope<-5?'queda':'estável',changePct:slope},
    seasonality:completed.length>=12?'histórico de 12 meses disponível para comparação sazonal':'histórico insuficiente para afirmar sazonalidade',
    anomaly:{lastCompletedVsMA3Pct:anomalyPct,flag:anomalyPct!==null&&Math.abs(anomalyPct)>=25},
    correlation:{revenueVsOrders:corr,interpretation:corr===null?'dados insuficientes':Math.abs(corr)>=0.75?'forte':Math.abs(corr)>=0.45?'moderada':'fraca'},
    configuredTargets:targets,
    variances:{meta:targets.meta?percentChange(curRev,targets.meta):null,orcamento:targets.orcamento?percentChange(curRev,targets.orcamento):null,forecast:targets.forecast?percentChange(curRev,targets.forecast):null},
    projections:{m1:projectionScenarios(baseMonthly,1),m3:projectionScenarios(baseMonthly,3),m6:projectionScenarios(baseMonthly,6),m12:projectionScenarios(baseMonthly,12)},
    monthlyHistory:completed
  };
}

function rangeFor(message){
  const q=norm(message),to=today();
  if(/hoje/.test(q)) return {from:to,to,label:'hoje'};
  if(/este mes|esse mes|mes atual/.test(q)) return {from:firstDayOfMonth(),to,label:'este mês'};
  if(/esta semana|essa semana/.test(q)){
    const d=new Date(`${to}T12:00:00-03:00`),dow=d.getDay(),back=dow===0?6:dow-1,start=new Date(d);
    start.setDate(d.getDate()-back); return {from:start.toLocaleDateString('sv-SE'),to,label:'esta semana'};
  }
  return null;
}
function inQueryRange(rows,range){
  if(!range)return rows; return rows.filter(x=>{const d=dateOf(x.criadoEm||x.data||x.horarioSaida);return d>=range.from&&d<=range.to;});
}
function findSharedCustomer(req,message){
  const q=norm(message),rows=activeCustomers(req);
  const direct=rows.filter(c=>{const n=norm(c.nome||c.nomeFantasia||c.razaoSocial||'');return n.length>=3&&q.includes(n);}).sort((a,b)=>norm(b.nome||'').length-norm(a.nome||'').length);
  if(direct[0])return direct[0];
  const m=q.match(/cliente\s+(.+?)(?:\s+(?:comprou|compra|compras|gastou|pediu|este|esse|no|na|quanto|quantos|valor)\b|$)/),probe=norm(m?.[1]||'');
  if(!probe)return null; return rows.find(c=>norm(c.nome||c.nomeFantasia||c.razaoSocial||'').includes(probe))||null;
}
function findSharedProduct(message){
  const q=norm(message),products=docs('products').filter(p=>p.ativo!==false),code=(q.match(/\b\d{3,}\b/)||[])[0];
  if(code){const p=products.find(x=>String(x.codigoInterno||'')===code||String(x.codigoBarras||'')===code);if(p)return p;}
  let best=null,bestScore=0;
  for(const p of products){const n=norm(`${p.nome||''} ${p.sabor||''} ${p.volume||''} ${p.embalagem||''}`),tokens=n.split(' ').filter(x=>x.length>3),score=tokens.reduce((a,t)=>a+(q.includes(t)?1:0),0);if(score>bestScore){bestScore=score;best=p;}}
  return bestScore>=2?best:null;
}

function normalizeHistory(history){
  if(!Array.isArray(history)) return [];
  return history.slice(-10).map(x=>({role:x?.role==='assistant'?'assistant':'user',content:String(x?.content||x?.text||'').slice(0,1200)})).filter(x=>x.content.trim());
}
function conversationProbe(message,history=[]){
  return [...normalizeHistory(history).map(x=>x.content),String(message||'')].join(' \n ');
}
function packagingKey(p){return `${Number(p?.unidadesPorFardo||p?.qtdPorEmbalagem||1)}|${Number(p?.fardosPorPalete||0)}|${p?.nomeFardo||'Fardo'}`;}
function productForConversion(message,history=[]){
  const probe=conversationProbe(message,history);
  const direct=findSharedProduct(probe); if(direct) return {product:direct,label:direct.nome||'Produto'};
  const q=norm(probe),products=docs('products').filter(p=>p.ativo!==false);
  const code=(q.match(/\b\d{3,}\b/g)||[]).reverse().find(c=>products.some(p=>String(p.codigoInterno||'')===c||String(p.codigoBarras||'')===c));
  if(code){const product=products.find(p=>String(p.codigoInterno||'')===code||String(p.codigoBarras||'')===code);return {product,label:product.nome||`produto ${code}`};}
  const vm=[...q.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(ml|l)\b/g)].at(-1);
  if(vm){
    const raw=`${vm[1]}${vm[2]}`.replace(',','.');
    const targetMl=vm[2]==='l'?Number(vm[1].replace(',','.'))*1000:Number(vm[1].replace(',','.'));
    const matches=products.filter(p=>{
      const pv=norm(p.volume||'').replace(',','.').replace(/\s+/g,'');
      const ml=Number(p.volumeMl||0)||(/ml$/.test(pv)?Number(pv.replace('ml','')):/l$/.test(pv)?Number(pv.replace('l',''))*1000:0);
      return ml===targetMl;
    });
    if(matches.length){const keys=new Set(matches.map(packagingKey));if(keys.size===1)return {product:matches[0],label:`linha ${vm[1].replace('.',',')} ${vm[2]}`};}
  }
  if(/\bbag\b/.test(q)){
    const matches=products.filter(p=>norm(p.embalagem)==='bag');
    if(matches.length&&new Set(matches.map(packagingKey)).size===1)return {product:matches[0],label:'produtos Bag'};
  }
  return null;
}
function unitKind(raw){
  const u=norm(raw);
  if(/unidade|\bun\b|\bund\b/.test(u))return 'unit';
  if(/meio.*pal|1\/2.*pal/.test(u))return 'half';
  if(/pallet|palete/.test(u))return 'pallet';
  if(/fardo|caixa|\bcx\b|\bfd\b/.test(u))return 'pack';
  return null;
}
function unitLabel(kind,product,count=2){
  if(kind==='unit')return count===1?'unidade':'unidades';
  if(kind==='pallet')return count===1?'pallet':'pallets';
  if(kind==='half')return 'meio pallet';
  const n=product?.nomeFardo||'Fardo';return count===1?n.toLowerCase():`${n.toLowerCase()}s`;
}
function parseConversionRequest(message,history=[]){
  const current=String(message||''), q=norm(current), prior=conversationProbe('',history);
  const conversionWords=/converter|converta|convert|equivale|equivalem|transform|quant[oa]s?|em\s+(?:fard|caix|pallet|palet|unidade)|para\s+(?:fard|caix|pallet|palet|unidade)/.test(q);
  if(!conversionWords)return null;
  const qm=[...current.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(unidades?|un\b|und\b|fardos?|fd\b|caixas?|cx\b|pallets?|paletes?|meio\s+pallet|meio\s+palete|1\/2\s*pallet|1\/2\s*palete)?/gi)]
    .filter(m=>Number.isFinite(Number(m[1].replace(',','.'))));
  let amount=null,from=null;
  for(const m of qm){const k=unitKind(m[2]||'');if(k){amount=Number(m[1].replace(',','.'));from=k;break;}}
  if(amount===null && qm.length){
    const m=qm[0]; amount=Number(m[1].replace(',','.'));
  }
  const targetMatch=current.match(/(?:em|para)\s+(unidades?|un\b|und\b|fardos?|fd\b|caixas?|cx\b|pallets?|paletes?|meio\s+pallet|meio\s+palete)/i);
  let to=unitKind(targetMatch?.[1]||'');
  if(!to){
    if(/quant[oa]s?\s+(?:fard|caix)/.test(q)||/\bem\s+(?:fard|caix)/.test(q))to='pack';
    else if(/quant[oa]s?\s+(?:pallet|palet)/.test(q))to='pallet';
    else if(/quant[oa]s?\s+unidade/.test(q))to='unit';
  }
  // continuação: "e em caixas?" reaproveita quantidade/unidade anterior
  if((amount===null||!from) && history.length){
    for(const h of [...normalizeHistory(history)].reverse()){
      if(h.role!=='user')continue;
      const old=parseConversionRequest(h.content,[]);
      if(old){amount=amount??old.amount;from=from||old.from;break;}
    }
  }
  if(amount!==null && !from && to) from=to==='unit'?'pack':'unit';
  return {amount,from,to};
}
function packagingReference(message,history=[]){
  const q=norm(message);
  if(!/(quantas?.*unidades?.*(?:fardo|caixa)|unidades?.*por.*(?:fardo|caixa)|quantos?.*(?:fardos|caixas).*pallet|como.*embalad|embalagem)/.test(q))return null;
  const hit=productForConversion(message,history);
  if(hit){const p=hit.product,upf=Number(p.unidadesPorFardo||p.qtdPorEmbalagem||1),fpp=Number(p.fardosPorPalete||0),name=p.nomeFardo||'Fardo';return {reply:`${hit.label}: cada ${name.toLowerCase()} tem ${upf} unidade(s)${fpp?` e cada pallet tem ${fpp} ${name.toLowerCase()}(s), totalizando ${upf*fpp} unidades.`:'.'}`,source:'local-calculator'};}
  return {reply:'Na configuração padrão da Life: 300 ml = 24 un./fardo; 900 ml = 12; 1,5 L = 6; 2,5 L e 3,5 L = 4; produtos Bag = 7 un./caixa. Para pallet, a quantidade de fardos/caixas depende do tamanho. Se você citar o produto, código ou volume, eu faço a conversão exata na hora.',source:'local-calculator'};
}
function conversionAnswer(message,history=[]){
  const ref=packagingReference(message,history); if(ref)return ref;
  const r=parseConversionRequest(message,history); if(!r||r.amount===null||!r.from||!r.to||r.from===r.to)return null;
  const hit=productForConversion(message,history);
  if(!hit)return {reply:'Faço essa conta na hora. Só preciso identificar qual produto ou tamanho você está usando, porque a quantidade por fardo/caixa muda. Pode citar, por exemplo, “código 100”, “300 ml”, “900 ml” ou “Bag”.',source:'local-calculator'};
  const p=hit.product,upf=Number(p.unidadesPorFardo||p.qtdPorEmbalagem||1),fpp=Number(p.fardosPorPalete||0),perPallet=upf*fpp;
  const factor={unit:1,pack:upf,pallet:perPallet,half:perPallet/2};
  if((r.from==='pallet'||r.from==='half'||r.to==='pallet'||r.to==='half')&&!fpp)return {reply:`${hit.label} não tem a quantidade por pallet configurada. Consigo converter normalmente entre unidades e ${unitLabel('pack',p)} usando ${upf} unidades por ${unitLabel('pack',p,1)}.`,source:'local-calculator'};
  const baseUnits=r.amount*factor[r.from], result=baseUnits/factor[r.to];
  const fromLabel=unitLabel(r.from,p,r.amount),toLabel=unitLabel(r.to,p,result);
  let detail='';
  if(r.to==='pack'&&!Number.isInteger(result)){const full=Math.floor(result),rem=Math.round((baseUnits-full*upf)*100)/100;detail=` Isso dá ${full} ${unitLabel('pack',p,full)} completos + ${rem} ${unitLabel('unit',p,rem)}.`;}
  else if(r.to==='pallet'&&!Number.isInteger(result)){const full=Math.floor(result),remUnits=baseUnits-full*perPallet,fullPacks=Math.floor(remUnits/upf),loose=Math.round((remUnits-fullPacks*upf)*100)/100;if(full===0){const missing=Math.max(0,perPallet-baseUnits),missingPacks=Math.ceil(missing/upf);detail=` Ainda não fecha 1 pallet: isso corresponde a ${fullPacks} ${unitLabel('pack',p,fullPacks)}${loose?` + ${loose} unidade(s)`:''}. Faltam ${missing} unidades (aprox. ${missingPacks} ${unitLabel('pack',p,missingPacks)}) para completar 1 pallet.`;}else{detail=` Na prática: ${full} pallet(s) completo(s), ${fullPacks} ${unitLabel('pack',p,fullPacks)} e ${loose} unidade(s) restantes.`;}}
  const rule=r.to==='unit'?`${upf} un. por ${unitLabel('pack',p,1)}${fpp?` · ${fpp} ${unitLabel('pack',p)} por pallet`:''}`:r.to==='pack'?`${upf} un. por ${unitLabel('pack',p,1)}`:fpp?`${fpp} ${unitLabel('pack',p)} por pallet · ${perPallet} un. por pallet`:'';
  const shown=Number.isInteger(result)?String(result):result.toLocaleString('pt-BR',{maximumFractionDigits:result<1?3:2});
  return {reply:`${r.amount.toLocaleString('pt-BR')} ${fromLabel} de ${hit.label} = ${shown} ${toLabel}.${detail}${rule?` Regra cadastrada: ${rule}.`:''}`,source:'local-calculator',calculation:{productId:p.id,amount:r.amount,from:r.from,to:r.to,result,unitsPerPack:upf,packsPerPallet:fpp}};
}

function dataAnswer(req,message,scope='operational',history=[]){
  const conversion=conversionAnswer(message,history); if(conversion) return conversion;
  const q=norm(message),orders=visibleOrders(req),customers=activeCustomers(req),range=rangeFor(message);
  const customer=findSharedCustomer(req,message);
  if(customer&&/(comprou|compras|gastou|quanto|quantos|valor|pediu)/.test(q)){
    const rows=inQueryRange(orders.filter(o=>o.clienteId===customer.id||norm(o.clienteNome)===norm(customer.nome||customer.nomeFantasia||customer.razaoSocial)),range||(/mes/.test(q)?{from:firstDayOfMonth(),to:today(),label:'este mês'}:null));
    const confirmed=salesOrders(rows),total=confirmed.reduce((a,o)=>a+Number(o.total||0),0);
    return {reply:`${customer.nome||customer.nomeFantasia||customer.razaoSocial} comprou ${money(total)} em ${confirmed.length} pedido(s) confirmado(s) ${range?.label||(/mes/.test(q)?'este mês':'no período disponível')}.${confirmed.length?` Ticket médio aproximado: ${money(total/confirmed.length)}.`:''} Se quiser, eu também consigo comparar esse cliente com o período anterior ou mostrar os produtos que ele mais comprou.`,source:'local-data'};
  }
  if((/quanto|total|valor|fatur/.test(q))&&(/vendi|vendido|vendas|faturamento/.test(q))){const rows=salesOrders(inQueryRange(orders,range)),total=rows.reduce((a,o)=>a+Number(o.total||0),0),ticket=rows.length?total/rows.length:0;return {reply:`Você tem ${rows.length} pedido(s) confirmado(s) ${range?.label||'no período visível'}, somando ${money(total)}.${rows.length?` O ticket médio está em ${money(ticket)}.`:''} Posso comparar com o mês anterior se você quiser entender se houve crescimento ou queda.`,source:'local-data'};}
  if(/melhor cliente|maior cliente|cliente que mais/.test(q)){const by={};for(const o of salesOrders(inQueryRange(orders,range)))by[o.clienteNome]=(by[o.clienteNome]||0)+Number(o.total||0);const ranking=topEntries(by,3),top=ranking[0];return {reply:top?`${top[0]} lidera ${range?.label||'no período analisado'}, com ${money(top[1])}.${ranking.length>1?` Depois vêm ${ranking.slice(1).map(([n,v])=>`${n} (${money(v)})`).join(' e ')}.`:''} Isso ajuda a enxergar concentração da carteira; posso calcular a participação desses clientes no total.`:'Ainda não há vendas confirmadas suficientes para calcular o maior cliente.',source:'local-data'};}
  if(/produto.*mais vendido|mais vendido|maior saida|maior saída|produto que mais/.test(q)){const by={};for(const o of salesOrders(inQueryRange(orders,range)))for(const i of (o.itens||[])){const n=i.produtoNome||'Produto';by[n]=(by[n]||0)+Number(i.quantidadeUnidades||i.quantidade||0);}const ranking=topEntries(by,3),top=ranking[0];return {reply:top?`${top[0]} é o produto de maior saída ${range?.label||'no período analisado'}, com ${top[1]} unidades.${ranking.length>1?` Na sequência: ${ranking.slice(1).map(([n,v])=>`${n} (${v} un.)`).join(' e ')}.`:''} Se quiser, converto essas quantidades para fardos/caixas ou pallets.`:'Ainda não há vendas confirmadas suficientes para calcular o produto de maior saída.',source:'local-data'};}
  if(/status.*pedido|pedido.*status|como esta.*pedido|como está.*pedido|situacao.*pedido|situação.*pedido/.test(q)){const n=(String(message).match(/(?:PED)?\s*0*(\d{1,6})/i)||[])[1],o=n?orders.find(x=>String(x.numero||'').replace(/\D/g,'').endsWith(String(n))):null;return {reply:o?`O pedido ${o.numero} de ${o.clienteNome} está com status “${o.status}”. Valor: ${money(o.total)}.`:'Não encontrei esse pedido entre os dados que seu usuário pode visualizar.',source:'local-data'};}
  if(/quantos?.*refazer|pedido.*refazer|refazer.*pedido/.test(q))return {reply:`Há ${orders.filter(o=>o.status==='refazer').length} pedido(s) aguardando correção.`,source:'local-data'};
  if(/quantos? clientes?|minha carteira|clientes cadastrados/.test(q)){const approved=customers.filter(c=>c.statusAprovacao==='aprovado').length,pending=customers.filter(c=>c.statusAprovacao==='pendente').length;return {reply:`Sua carteira tem ${customers.length} cliente(s): ${approved} aprovado(s)${pending?` e ${pending} aguardando aprovação`:''}. Posso também separar quem ainda não comprou, quem mais compra ou quais clientes merecem contato primeiro.`,source:'local-data'};}
  const product=findSharedProduct(message);
  if(product&&/estoque|quanto tem|disponivel|disponível|quantidade/.test(q)){const inv=inventorySummary(),x=inv.by.get(product.id)||{available:0,blocked:0},upf=Number(product.unidadesPorFardo||product.qtdPorEmbalagem||1),pack=product.nomeFardo||'Fardo';const eq=upf>1?` Isso equivale a ${Math.floor(x.available/upf)} ${pack.toLowerCase()}(s) completo(s)${x.available%upf?` + ${x.available%upf} unidade(s)`:''}.`:'';return {reply:`${product.nome}: ${x.available} unidade(s) disponíveis e ${x.blocked} bloqueada(s).${eq} Se quiser, eu também converto para pallet ou verifico se está abaixo do mínimo.`,source:'local-data'};}
  if(/estoque/.test(q)&&/(zerado|sem estoque|abaixo|minimo|mínimo|critico|crítico)/.test(q)){const inv=inventorySummary();return {reply:`Neste momento há ${inv.zero.length} produto(s) sem estoque disponível e ${inv.low.length} abaixo do estoque mínimo.${scope==='sales'?' Considere isso antes de fechar pedidos grandes.':' Priorize reposição dos itens recorrentes e revise o backlog antes de liberar estoque.'}`,source:'local-data'};}
  return null;
}


function status(){
  const aiFlag=String(process.env.AION_EXTERNAL_AI_ENABLED||'auto').toLowerCase();
  const enabled=!!process.env.OPENAI_API_KEY && aiFlag!=='false';
  const web=enabled && String(process.env.AION_WEB_SEARCH_ENABLED||'true').toLowerCase()!=='false';
  return {
    externalAI:enabled,
    webSearch:web,
    model:enabled?(process.env.AION_MODEL||'gpt-5-mini'):null,
    mode:enabled?(web?'conversacional + IA externa + web':'conversacional + IA externa'):'conversacional local',
    skill:AionSkill.publicSummary(),
    marketAwareness:true,
    advancedAnalytics:true
  };
}

function howTo(message,scope='operational'){
  const q=norm(message);
  const sales=scope==='sales';
  if(/relatorio|relatório|pdf/.test(q)) return sales
    ? 'Para gerar um relatório no Life Vendas: abra Relatórios, escolha a data inicial e final, toque em “Gerar resumo” para conferir os números e depois em “Gerar PDF”. Se não gerar, confirme se o período é válido e me diga a mensagem de erro. Dica: para ganhar tempo, use períodos fechados como “este mês” ou “últimos 30 dias” e compare com o período anterior.'
    : 'No sistema operacional, abra Relatórios, escolha o tipo de relatório e aplique os filtros de período, produto, cliente, NF, fornecedor, motorista, usuário ou status. Depois gere PDF, Excel ou impressão. Você também pode me pedir em linguagem natural, por exemplo: “relatório de avarias dos últimos 30 dias” ou “vendas por cliente este mês”.';
  if(/cadastr.*cliente|adicion.*cliente|novo cliente|clientes?.*cadastr/.test(q)) return sales
    ? 'Para cadastrar cliente: abra Clientes, toque em “Adicionar cliente”, preencha ao menos Nome/Fantasia e os dados disponíveis e envie. No perfil Vendedor, o cadastro fica pendente para aprovação da operação. A forma mais rápida é preencher primeiro Nome, CNPJ, WhatsApp, cidade e bairro; depois complete os demais dados quando necessário.'
    : 'Para cadastrar cliente: abra Clientes → “Adicionar cliente”, preencha os dados e salve. Operador/Gerente podem classificar como Verde ou Amarelo e definir a tabela de preço. Dica: mantenha CNPJ, WhatsApp, cidade, bairro, região e vendedor responsável completos para melhorar filtros, relatórios, separação e análise comercial.';
  if(/nota fiscal|nf-e|nfe|gerar nf|emitir nf|segunda via/.test(q)) return 'A aba Notas Fiscais concentra as NF-e emitidas. Você pode filtrar, abrir uma nota, visualizar DANFE/PDF, baixar XML e emitir 2ª via. A emissão automática de uma NF-e nova exige integração fiscal real e certificado/provedor autorizado; o sistema não simula autorização da SEFAZ. Depois de configurada essa integração, o fluxo ideal é Pedido aprovado → emissão fiscal → NF vinculada → separação/romaneio.';
  if(/pedido/.test(q)&&/como|criar|cadastr|novo|fazer|registr/.test(q)) return sales
    ? 'Para criar pedido: Novo pedido → escolha um cliente aprovado → selecione tabela de preço e pagamento → adicione produtos/quantidades → revise → envie. Dica: confira o estoque disponível antes de negociar grandes volumes e use as observações para registrar condições especiais.'
    : 'Na operação, use Pedidos → “Adicionar pedido” quando precisar lançar um pedido diretamente. Selecione cliente, vendedor, tabela, pagamento, itens e observações. Após aprovação o estoque é baixado e a NF fica disponível para o fluxo de separação/romaneio manual.';
  if(/entrada|recebimento|xml|foto da nf/.test(q)) return 'Para registrar entrada: abra Entradas. O caminho mais rápido é importar o XML da NF-e quando disponível; como alternativa use foto/OCR ou cadastro manual. Sempre confira fornecedor, NF, produtos, quantidades, lote e validade antes de confirmar.';
  if(/saida|saída|romaneio|separacao|separação/.test(q)) return 'Para separação: pedidos aprovados ficam disponíveis em Separação. Use os filtros de NF, fornecedor, cidade, bairro, região ou vendedor, marque as NFs que irão no mesmo romaneio e clique em “Gerar romaneio”. O sistema consolida as quantidades e permite visualizar, salvar e imprimir o PDF.';
  if(/backlog/.test(q)) return 'Backlog registra retorno de NFs/itens não entregues. Esses itens retornam ao estoque bloqueado até uma decisão de reentrega/liberação. A forma mais segura é tratar o backlog antes de planejar novas cargas, evitando considerar estoque bloqueado como disponível.';
  if(/inventario|inventário/.test(q)) return 'O Inventário compara a contagem física com o estoque do sistema. Faça por produto/lote, registre a contagem e revise divergências antes do ajuste. Para reduzir erros, conte por área física e finalize um grupo de produtos antes de iniciar outro.';
  if(/avaria|perda/.test(q)) return 'Em Avarias/Perdas, informe produto, quantidade, origem e motivo. A movimentação reduz o estoque e fica vinculada ao usuário. Para gestão, separe motivos como vazamento, vencimento e quebra; isso ajuda a identificar causa recorrente e custo evitável.';
  if(/usuario|usuário|operador|gerente|vendedor|permiss/.test(q)) return 'Perfis: Gerente administra configurações e operações sensíveis; Operador executa a rotina operacional; Vendedor usa o Life Vendas e enxerga sua carteira/pedidos. Todas as alterações relevantes ficam vinculadas ao usuário no histórico.';
  if(/barra.*busca|pesquis|buscar|localizar/.test(q)) return 'A busca superior é global: pesquise por número de pedido, NF, produto/código, cliente, entrada, saída, backlog, lote ou fornecedor. Digite parte do número ou nome e abra o resultado correspondente. Para pedido/NF, normalmente só os últimos dígitos já são suficientes.';
  if(/pagamento|boleto|pix|dinheiro/.test(q)) return 'Formas de pagamento: Pix, Dinheiro e Boleto conforme classificação do cliente. Verde pode usar boleto; Amarelo fica restrito a Pix/Dinheiro. Boleto de R$150 a R$299,99 usa 7 dias e a partir de R$300 usa 14 dias.';
  if(/tabela.*preco|tabela.*preço|preco|preço/.test(q)) return 'Use Tabelas de Preço para padronizar a venda e reduzir digitação. Mantenha uma tabela-base por perfil de cliente e use tabela personalizada apenas quando houver acordo específico. Isso melhora margem, consistência comercial e auditoria.';
  if(/aprovar.*pedido|pedido.*aprovad|o que acontece.*pedido/.test(q)) return 'Quando um pedido é aprovado pela operação, ele passa a valer no fluxo operacional: a reserva deixa de ser apenas comercial, o estoque é efetivamente tratado pelo fluxo de saída e o pedido fica disponível para separação/romaneio. A AION não aprova silenciosamente por você; essa etapa continua exigindo a ação autorizada do operador/gerente.';
  if(/estoque.*bloquead|bloquead.*estoque|disponivel.*bloquead|disponível.*bloquead/.test(q)) return 'Estoque disponível é o que pode entrar normalmente em novas movimentações/vendas. Estoque bloqueado existe fisicamente, mas não deve ser prometido como disponível — normalmente porque veio de backlog, devolução ou outra situação que precisa de decisão. Separar os dois evita vender um produto que ainda está pendente de liberação.';
  if(/validade|40 dias|vencimento/.test(q)) return 'Nas entradas, o Life sugere validade de 40 dias após a chegada como padrão operacional, mas o campo é editável. A data real do lote deve prevalecer sempre que estiver disponível na embalagem, NF ou conferência física.';
  if(/verde|amarelo|classifica.*cliente/.test(q)) return 'A classificação controla principalmente a condição comercial: cliente Verde pode usar Pix, Dinheiro e Boleto; cliente Amarelo fica em Pix e Dinheiro. No boleto, R$150 a R$299,99 usa 7 dias e R$300 ou mais usa 14 dias. Essa regra fica centralizada para evitar condição incorreta no pedido.';
  if(/ocr|foto.*romaneio|foto.*nota|ler.*foto/.test(q)) return 'O OCR serve para acelerar digitação, não para substituir conferência. Em NF/romaneio por foto, o sistema tenta identificar produto, quantidade, cliente/entregador e outros campos, mas mostra o resultado para revisão antes de qualquer movimentação definitiva.';
  if(/o que.*aion|aion.*faz|o que voce consegue|o que você consegue|como pode ajudar/.test(q)) return 'Pode me usar como um copiloto do Life. Eu explico telas e regras, respondo dúvidas de processo, consulto os dados que seu perfil pode enxergar, faço contas e conversões de embalagem, preparo relatórios/rascunhos, analiso indicadores e sugiro prioridades. Quando a conexão externa está ativa, também comparo a operação com tendências e referências do mercado.';
  if(/senha|trocar.*senha|minha conta/.test(q)&&sales) return 'No Life Vendas, abra Minha conta → Trocar senha. Informe a senha atual, digite a nova senha duas vezes e salve. Depois da alteração o sistema encerra a sessão para você entrar novamente com a nova senha.';
  return null;
}

function managementInsight(req,scope='operational'){
  const orders=visibleOrders(req), customers=activeCustomers(req), monthSales=salesOrders(currentMonth(orders));
  const monthRevenue=monthSales.reduce((a,o)=>a+Number(o.total||0),0);
  const byClient={},byProduct={};
  for(const o of monthSales){
    const cn=o.clienteNome||'Cliente'; byClient[cn]=(byClient[cn]||0)+Number(o.total||0);
    for(const i of (o.itens||[])){const pn=i.produtoNome||'Produto';byProduct[pn]=(byProduct[pn]||0)+Number(i.quantidadeUnidades||i.quantidade||0);}
  }
  const topClient=topEntries(byClient,1)[0], topProduct=topEntries(byProduct,1)[0];
  const rework=orders.filter(o=>o.status==='refazer').length;
  const pending=orders.filter(o=>['enviado','pendente'].includes(String(o.status||'').toLowerCase())).length;
  const activeWithOrder=new Set(salesOrders(orders).map(o=>o.clienteId));
  const inactive=customers.filter(c=>c.statusAprovacao==='aprovado'&&!activeWithOrder.has(c.id)).length;
  const inv=inventorySummary(),analytics=advancedAnalytics(req,scope);
  const backlog=docs('backlog').filter(b=>['bloqueado','em_reentrega'].includes(String(b.status||''))).length;
  const losses=currentMonth(docs('losses'),'data'),lossQty=losses.reduce((a,x)=>a+Number(x.quantidade||x.quantidadeUnidades||0),0);
  const lines=[];
  lines.push(`Visão AION · Skill v${AionSkill.SKILL.version} — análise executiva ${scope==='sales'?'comercial':'operacional'}`);
  lines.push('1. Onde estamos');
  lines.push(`• Mês atual: ${monthSales.length} pedido(s) confirmado(s), ${money(monthRevenue)}.`);
  if(topClient) lines.push(`• Maior cliente: ${topClient[0]} (${money(topClient[1])}).`);
  if(topProduct) lines.push(`• Produto de maior saída: ${topProduct[0]} (${topProduct[1]} un.).`);
  lines.push('2. O que mudou / histórico');
  lines.push(`• MoM (mesmo intervalo do mês anterior): ${fmtPct(analytics.comparisons.momPct)}.`);
  lines.push(`• YoY (mesmo intervalo do ano anterior): ${fmtPct(analytics.comparisons.yoyPct)}.`);
  lines.push(`• YTD vs ano anterior: ${fmtPct(analytics.comparisons.ytdPct)}.`);
  const ma=[]; if(analytics.movingAverages.m3!==null)ma.push(`3m ${money(analytics.movingAverages.m3)}`);if(analytics.movingAverages.m6!==null)ma.push(`6m ${money(analytics.movingAverages.m6)}`);if(analytics.movingAverages.m12!==null)ma.push(`12m ${money(analytics.movingAverages.m12)}`);if(ma.length)lines.push(`• Médias móveis mensais: ${ma.join(' · ')}.`);
  lines.push(`• Tendência recente: ${analytics.trend.direction}${analytics.trend.changePct!==null?` (${fmtPct(analytics.trend.changePct)})`:''}.`);
  if(analytics.anomaly.flag)lines.push(`• Anomalia: o último mês completo desviou ${fmtPct(analytics.anomaly.lastCompletedVsMA3Pct)} da média móvel de 3 meses.`);
  if(analytics.correlation.revenueVsOrders!==null)lines.push(`• Correlação faturamento x número de pedidos: ${analytics.correlation.interpretation} (${analytics.correlation.revenueVsOrders.toFixed(2)}).`);
  if(!Object.keys(analytics.configuredTargets).length)lines.push('• Meta/orçamento/forecast: ainda não configurados no sistema; a AION não inventará esses valores.');
  lines.push('3. Riscos e oportunidades');
  if(rework) lines.push(`• Prioridade alta: ${rework} pedido(s) para refazer.`);
  if(pending) lines.push(`• ${pending} pedido(s) aguardando avanço no fluxo.`);
  if(inactive) lines.push(`• Oportunidade: ${inactive} cliente(s) aprovado(s) ainda sem compra confirmada no histórico visível.`);
  if(scope!=='sales'){
    lines.push(`• Estoque: ${inv.zero.length} item(ns) zerados e ${inv.low.length} abaixo do mínimo.`);
    if(backlog) lines.push(`• Backlog ativo: ${backlog} item(ns) bloqueados/em reentrega.`);
    if(lossQty) lines.push(`• Avarias/perdas no mês: ${lossQty} unidade(s) em ${losses.length} ocorrência(s).`);
  }
  lines.push('4. Previsão');
  const p=analytics.projections.m1;lines.push(`• Próximo mês (referência estatística): conservador ${money(p.conservative)} · base ${money(p.base)} · otimista ${money(p.optimistic)}.`);
  lines.push('5. Decisão recomendada / próxima melhor ação');
  const priorities=[];if(rework)priorities.push('resolver pedidos para refazer');if(scope!=='sales'&&inv.zero.length)priorities.push('repor itens zerados de maior giro');if(scope!=='sales'&&backlog)priorities.push('tratar backlog bloqueado');if(inactive)priorities.push('reativar clientes aprovados sem compra');
  lines.push(`• ${priorities.length?`Priorize ${priorities.join(' → ')}.`:'A operação não mostra exceções críticas nos indicadores disponíveis; concentre-se em crescimento comercial e prevenção de rupturas.'}`);
  lines.push('6. Mercado e benchmark');
  lines.push(status().webSearch?'• A camada de mercado está habilitada; a AION complementará esta leitura com benchmark e tendências atuais na resposta externa.':'• A camada de mercado requer a conexão externa ativa para benchmarking atualizado; a análise interna continua disponível.');
  return lines.join('\n');
}

function isManagementQuestion(message){
  const q=norm(message);
  return /analise|análise|gestao|gestão|sugest|prioriz|oportunidade|melhoria|diagnostico|diagnóstico|como esta|como está|visao|visão|indicadores|performance|desempenho|compar|projec|previs|cenario|cenário|mom|yoy|ytd|media movel|média móvel|sazonal|anomalia|correlacao|correlação/.test(q);
}
function wantsExternalWeb(message){
  const q=norm(message);
  return /mercado|tendencia|tendência|extern|concorr|noticia|notícia|setor|preco de mercado|preço de mercado|economia|consumo no brasil|benchmark|benchmarking|novidade|regulacao|regulação|inovacao|inovação|tecnologia|automacao|automação|boas praticas|boas práticas/.test(q);
}
function safeContext(req,scope){
  const orders=visibleOrders(req),customers=activeCustomers(req),sales=currentMonth(salesOrders(orders));
  const revenue=sales.reduce((a,o)=>a+Number(o.total||0),0), inv=inventorySummary(),analytics=advancedAnalytics(req,scope);
  return {
    sistema:scope==='sales'?'Life Vendas':'Life Sucos Operacional',
    perfil:req?.authUser?.perfil||'usuário',
    setor:'distribuição de sucos e bebidas no Brasil',
    aionSkill:AionSkill.publicSummary(),
    conhecimentoSistema:{
      modulos:scope==='sales'?['Painel','Clientes','Novo pedido','Pedidos','Relatórios','Minha conta','AION IA']:['Dashboard','Produtos','Entradas','Saídas','Backlog','Inventário','Avarias/Perdas','Clientes','Pedidos','Separação/Romaneio','Notas Fiscais','Relatórios','Configurações','AION IA'],
      regras:['Cliente Verde: Pix, Dinheiro e Boleto','Cliente Amarelo: Pix e Dinheiro','Boleto R$150–299,99: 7 dias; R$300+: 14 dias','Validade sugerida em entradas: 40 dias, editável','Backlog retorna itens não entregues para estoque bloqueado'],
      logisticaProdutos:docs('products').filter(p=>p.ativo!==false).slice(0,80).map(p=>({codigo:p.codigoInterno,nome:p.nome,volume:p.volume,embalagem:p.embalagem,unidadesPorFardo:Number(p.unidadesPorFardo||p.qtdPorEmbalagem||1),nomeFardo:p.nomeFardo||'Fardo',fardosPorPalete:Number(p.fardosPorPalete||0)}))
    },
    indicadoresAgregados:{
      vendasConfirmadasMes:sales.length,
      faturamentoPedidosMes:Number(revenue.toFixed(2)),
      clientesVisiveis:customers.length,
      pedidosParaRefazer:orders.filter(o=>o.status==='refazer').length,
      produtosSemEstoque:inv.zero.length,
      produtosAbaixoMinimo:inv.low.length,
      comparacoes:analytics.comparisons,
      ytd:analytics.ytd,
      mediasMoveis:analytics.movingAverages,
      tendencia:analytics.trend,
      sazonalidade:analytics.seasonality,
      anomalia:analytics.anomaly,
      correlacao:analytics.correlation,
      variacaoVsMetasConfiguradas:analytics.variances,
      projecoes:analytics.projections
    }
  };
}

function extractOutputText(data){
  if(typeof data?.output_text==='string'&&data.output_text.trim()) return data.output_text.trim();
  const parts=[];
  for(const item of (data?.output||[])) for(const c of (item?.content||[])) if(c?.type==='output_text'&&c.text) parts.push(c.text);
  return parts.join('\n').trim();
}
async function externalAnswer({req,message,scope='operational',forceWeb=false,history=[]}){
  const st=status(); if(!st.externalAI) return null;
  const useWeb=!!(st.webSearch&&(forceWeb||wantsExternalWeb(message)||isManagementQuestion(message)));
  const context=safeContext(req,scope);
  const instructions=AionSkill.systemInstructions({scope,useWeb});
  const recentHistory=normalizeHistory(history);
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),22000);
  try{
    const body={model:process.env.AION_MODEL||'gpt-5-mini',store:false,input:`${instructions}\n\nContexto seguro do sistema: ${JSON.stringify(context)}\n\nHistórico recente da conversa: ${JSON.stringify(recentHistory)}\n\nPergunta atual do usuário: ${String(message||'').slice(0,4000)}`};
    if(useWeb) body.tools=[{type:'web_search'}];
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data?.error?.message||`OpenAI HTTP ${r.status}`);
    const reply=extractOutputText(data); if(!reply) return null;
    return {reply,source:'external-ai',webUsed:useWeb};
  }catch(err){
    console.warn('[AION] IA externa indisponível:',err.message);
    return null;
  }finally{clearTimeout(timer);}
}

async function unifiedFallback({req,message,scope='operational',history=[]}){
  const help=howTo(message,scope);
  if(help){
    const external=await externalAnswer({req,message:`Pergunta do usuário: ${message}\n\nBase interna confiável do sistema: ${help}\n\nResponda de forma natural e útil. Comece pela resposta direta, complemente com contexto apenas se ajudar e não invente regras além da base interna/contexto seguro.`,scope,history});
    if(external) return {...external,knowledgeGrounded:true};
    return {reply:help,source:'local-knowledge'};
  }
  if(isManagementQuestion(message)){
    const local=managementInsight(req,scope);
    const external=await externalAnswer({req,message:`${message}\n\nFaça análise empresarial avançada e, com web disponível, benchmarking do setor de distribuição de sucos/bebidas. Compare mercado x operação e entregue gap, oportunidade, impacto, complexidade, prioridade, recomendação e próximas ações.`,scope,forceWeb:true,history});
    if(external) return {reply:`${local}\n\n7. Mercado, benchmark e aprofundamento AION\n${external.reply}`,source:external.source,webUsed:!!external.webUsed,skillVersion:AionSkill.SKILL.version};
    return {reply:local,source:'local-analytics',skillVersion:AionSkill.SKILL.version};
  }
  if(wantsExternalWeb(message)){
    const external=await externalAnswer({req,message,scope,forceWeb:true,history});
    if(external) return external;
    return {reply:'Eu consigo pesquisar informações externas de mercado quando a IA externa estiver configurada no servidor. Nesta instalação, continuo funcionando com os dados e regras internas. Para ativar a pesquisa de mercado, configure OPENAI_API_KEY, AION_EXTERNAL_AI_ENABLED=true e AION_WEB_SEARCH_ENABLED=true no servidor.',source:'local-fallback'};
  }
  const external=await externalAnswer({req,message,scope,history});
  if(external) return external;
  return {reply:`Pode perguntar do seu jeito. Eu consigo explicar funções do ${scope==='sales'?'Life Vendas':'Life Sucos'}, tirar dúvidas de processo, consultar os dados que seu usuário pode ver, fazer contas e conversões de embalagem, analisar indicadores e sugerir próximos passos. Se você me disser o que quer descobrir ou fazer, eu respondo diretamente.`,source:'local-fallback'};
}

module.exports={norm,status,howTo,dataAnswer,conversionAnswer,advancedAnalytics,managementInsight,isManagementQuestion,wantsExternalWeb,externalAnswer,unifiedFallback};
