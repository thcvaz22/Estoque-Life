/* ============================================================
   SERVER/AIONROUTES.JS — AION IA operacional (modo local)

   O objetivo desta camada é facilitar as tarefas do dia a dia sem
   colocar uma IA externa no caminho das regras críticas de estoque.
   Ela interpreta comandos frequentes, consulta o banco local, monta
   relatórios e prepara RASCUNHOS de cadastros. Toda movimentação de
   estoque continua dependendo da conferência humana e dos endpoints
   transacionais de /api/stock/*.

   Nenhuma imagem/dado é enviado para serviços externos por esta camada.
   ============================================================ */

const express = require('express');
const { Data } = require('./db');
const svc = require('./services/inventoryService');
const AionUnified = require('./services/aionUnified');

const router = express.Router();

function norm(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}
function dateOnly(value) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
}
function todayBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
}
function addDays(iso, delta) {
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y,m-1,d));
  dt.setUTCDate(dt.getUTCDate()+delta);
  return dt.toISOString().slice(0,10);
}
function parseBrDate(text) {
  const m = String(text || '').match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}
function parseDateRange(text) {
  const n = norm(text);
  const today = todayBR();
  if (/\bhoje\b/.test(n)) return { start: today, end: today, label: 'hoje' };
  if (/\bontem\b/.test(n)) { const d=addDays(today,-1); return { start:d,end:d,label:'ontem' }; }
  const last = n.match(/(?:ultim(?:os|as)|ultimos|ultimas)\s+(\d{1,3})\s+dias?/);
  if (last) {
    const days = Math.max(1, Math.min(365, Number(last[1])));
    return { start: addDays(today, -(days-1)), end: today, label: `últimos ${days} dias` };
  }
  if (/\besta semana\b|\bessa semana\b/.test(n)) {
    const d = new Date(`${today}T12:00:00-03:00`); const dow = d.getDay(); const offset = dow === 0 ? 6 : dow-1;
    return { start:addDays(today,-offset), end:today, label:'esta semana' };
  }
  if (/\beste mes\b|\besse mes\b|\bmes atual\b/.test(n)) return { start: today.slice(0,8)+'01', end: today, label:'este mês' };
  const range = String(text || '').match(/(?:de|entre)\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\s+(?:a|ate|até|e)\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i);
  if (range) {
    const a=parseBrDate(range[1]), b=parseBrDate(range[2]);
    if (a && b) return { start:a<=b?a:b, end:a<=b?b:a, label:`${range[1]} a ${range[2]}` };
  }
  return { start:addDays(today,-6), end:today, label:'últimos 7 dias' };
}
function inRange(value, range) {
  const d = dateOnly(value);
  return !!d && d >= range.start && d <= range.end;
}
function getProductRef(text) {
  const products = Data.all('products').filter(p => p.ativo !== false);
  const raw = String(text || '');
  const codes = raw.match(/\b\d{3}\b/g) || [];
  for (const code of codes) {
    const p = products.find(x => String(x.codigoInterno || '') === code);
    if (p) return p;
  }
  const n = norm(raw);
  // nomes/sabores/tamanhos: escolhe o match mais específico
  let best = null, score = 0;
  for (const p of products) {
    const tokens = norm(`${p.nome} ${p.sabor||''} ${p.volume||''} ${p.embalagem||''}`).split(' ').filter(x => x.length > 2);
    const s = tokens.reduce((a,t)=>a+(n.includes(t)?1:0),0);
    if (s > score) { score=s; best=p; }
  }
  return score >= 2 ? best : null;
}
function parseQuantityAndUnit(text) {
  const raw = String(text || '');
  const m = raw.match(/\b(\d+(?:[.,]\d+)?)\s*(unidades?|un\b|und\b|fardos?|caixas?|cx\b|pallets?|paletes?|meio\s+pallet|meio\s+palete)\b/i);
  if (!m) return { quantidade:null, unidade:'Unidade' };
  const q = Number(m[1].replace(',','.'));
  const u = norm(m[2]);
  let unidade='Unidade';
  if (/fardo|caixa|cx/.test(u)) unidade='Fardo';
  else if (/meio/.test(u)) unidade='Meio Pallet';
  else if (/pallet|palete/.test(u)) unidade='Pallet';
  return { quantidade:q, unidade };
}
function findAfterKeyword(text, keywords) {
  const raw = String(text || '');
  for (const k of keywords) {
    const re = new RegExp(`${k}\\s*[:\\-]?\\s*([^,;]+)`, 'i');
    const m = raw.match(re);
    if (m) return m[1].trim();
  }
  return '';
}

function parseMasterPayload(rest) {
  const raw=String(rest||'').trim();
  const cnpj=(raw.match(/\bcnpj\s*[:#-]?\s*([0-9.\/\-]{14,18})/i)||[])[1]||'';
  const telefone=(raw.match(/\b(?:telefone|fone|celular)\s*[:#-]?\s*([0-9() +\-]{8,20})/i)||[])[1]||'';
  const observacoes=(raw.match(/\b(?:obs|observacao|observação)\s*[:#-]?\s*(.+)$/i)||[])[1]||'';
  const nome=raw
    .replace(/\bcnpj\s*[:#-]?\s*[0-9.\/\-]{14,18}/ig,'')
    .replace(/\b(?:telefone|fone|celular)\s*[:#-]?\s*[0-9() +\-]{8,20}/ig,'')
    .replace(/\b(?:obs|observacao|observação)\s*[:#-]?\s*.+$/ig,'')
    .replace(/[;,]+$/,'').trim();
  return {nome,cnpj,telefone,observacoes};
}

function currentAudit(req) {
  const u=req.authUser;
  return u?.auditLabel || (u ? `${u.nome} (${u.username})` : 'Usuário autenticado');
}
function history(tipo, req, motivo) {
  const row={ id:uid('hist'), timestamp:new Date().toISOString(), tipo, usuario:currentAudit(req), motivo };
  Data.upsert('history', row.id, row); return row;
}
function rowsForExitDetails(range, clientFilter='') {
  const products = new Map(Data.all('products').map(p=>[p.id,p]));
  const f = norm(clientFilter);
  const rows=[];
  for (const e of Data.all('exits')) {
    if (!inRange(e.horarioSaida, range)) continue;
    for (const nf of (e.nfs||[])) {
      const cliente = nf.cliente || e.cliente || 'Não informado';
      if (f && !norm(cliente).includes(f)) continue;
      for (const it of (nf.itens||[])) {
        rows.push({
          data: dateOnly(e.horarioSaida), cliente, nf:nf.numero || '',
          produto: products.get(it.produtoId)?.nome || it.produtoNome || it.produtoId || 'Produto',
          quantidade:Number(it.quantidadeUnidades || it.quantidade || 0), motorista:e.motorista || '', status:e.status || ''
        });
      }
    }
  }
  return rows;
}
function groupSalesByClient(range) {
  const detail=rowsForExitDetails(range);
  const map=new Map();
  for (const r of detail) {
    const k=r.cliente || 'Não informado';
    if(!map.has(k)) map.set(k,{cliente:k,nfs:new Set(),quantidade:0,itens:0});
    const x=map.get(k); x.nfs.add(r.nf); x.quantidade+=r.quantidade; x.itens++;
  }
  return [...map.values()].map(x=>({cliente:x.cliente,nfs:x.nfs.size,itens:x.itens,quantidade:x.quantidade})).sort((a,b)=>b.quantidade-a.quantidade);
}
function reportSpec(text) {
  const n=norm(text), range=parseDateRange(text);
  const wantsClient=/\bcliente(s)?\b/.test(n);
  const wantsSupplier=/fornecedor/.test(n);
  const wantsLoss=/avaria|perda/.test(n);
  const wantsBacklog=/backlog|pendencia|pendente/.test(n);
  const wantsStock=/estoque/.test(n) && !/baixo|zerado/.test(n);
  const wantsValidity=/validade|vencimento|vencer/.test(n);
  const wantsEntries=/entrada|recebimento/.test(n);

  if (wantsLoss) {
    const rows=Data.all('losses').filter(x=>inRange(x.data,range)).map(x=>({data:dateOnly(x.data),produto:x.produtoNome||'',quantidade:Number(x.quantidade||0),motivo:x.motivo||'',responsavel:x.responsavel||''}));
    return { title:`Avarias e Perdas — ${range.label}`, headers:['Data','Produto','Quantidade','Motivo','Responsável'], keys:['data','produto','quantidade','motivo','responsavel'], rows, summary:`${rows.length} registro(s) no período.` };
  }
  if (wantsBacklog) {
    const rows=Data.all('backlog').filter(x=>!x.dataRetorno || inRange(x.dataRetorno,range)).map(x=>({retorno:dateOnly(x.dataRetorno),cliente:x.cliente||'',nf:x.nf||'',produto:x.produtoNome||'',quantidade:Number(x.quantidade||0),motivo:x.motivo||'',status:x.status||''}));
    return { title:`Backlog — ${range.label}`, headers:['Retorno','Cliente','NF','Produto','Quantidade','Motivo','Status'], keys:['retorno','cliente','nf','produto','quantidade','motivo','status'], rows, summary:`${rows.length} item(ns) de backlog.` };
  }
  if (wantsValidity) {
    const products=new Map(Data.all('products').map(p=>[p.id,p]));
    const rows=svc.listAllLots().filter(l=>l.validade).map(l=>({produto:products.get(l.productId)?.nome||l.productId,lote:l.lote,validade:l.validade,disponivel:l.quantidadeDisponivel,bloqueado:l.quantidadeBloqueada})).sort((a,b)=>String(a.validade).localeCompare(String(b.validade)));
    return { title:'Validade dos Lotes', headers:['Produto','Lote','Validade','Disponível','Bloqueado'], keys:['produto','lote','validade','disponivel','bloqueado'], rows, summary:`${rows.length} lote(s) com validade cadastrada.` };
  }
  if (wantsStock) {
    const products=new Map(Data.all('products').map(p=>[p.id,p]));
    const rows=svc.listAllLots().map(l=>({produto:products.get(l.productId)?.nome||l.productId,lote:l.lote,disponivel:l.quantidadeDisponivel,bloqueado:l.quantidadeBloqueada,total:Number(l.quantidadeDisponivel||0)+Number(l.quantidadeBloqueada||0),validade:l.validade||''}));
    return { title:'Posição Atual de Estoque', headers:['Produto','Lote','Disponível','Bloqueado','Total','Validade'], keys:['produto','lote','disponivel','bloqueado','total','validade'], rows, summary:`${rows.reduce((a,r)=>a+r.disponivel,0)} unidade(s) disponíveis.` };
  }
  if (wantsSupplier || wantsEntries) {
    const rows=Data.all('entries').filter(e=>inRange(e.data||e.dataChegada,range)).map(e=>({data:dateOnly(e.data||e.dataChegada),fornecedor:e.fornecedor||'',nf:e.nf||'',itens:(e.itens||[]).length,quantidade:(e.itens||[]).reduce((a,i)=>a+Number(i.quantidadeUnidades||i.quantidade||0),0),responsavel:e.responsavel||''}));
    return { title:`Entradas por Fornecedor — ${range.label}`, headers:['Data','Fornecedor','NF','Itens','Quantidade','Responsável'], keys:['data','fornecedor','nf','itens','quantidade','responsavel'], rows, summary:`${rows.length} entrada(s) no período.` };
  }

  if (wantsClient && /\bpor\s+cliente|\bclientes\b/.test(n)) {
    const rows=groupSalesByClient(range);
    return { title:`Saídas por Cliente — ${range.label}`, headers:['Cliente','NFs','Linhas de itens','Quantidade'], keys:['cliente','nfs','itens','quantidade'], rows, summary:`${rows.length} cliente(s) atendido(s) no período.` };
  }
  // tenta um cliente explícito depois da palavra cliente
  let cf='';
  const cm=String(text||'').match(/cliente\s+(.+?)(?:\s+(?:dos|das|de|entre|ultimos|últimos|hoje|ontem)\b|$)/i);
  if(cm) cf=cm[1].trim();
  const rows=rowsForExitDetails(range, cf);
  return { title:`Saídas / Vendas — ${range.label}${cf?` — ${cf}`:''}`, headers:['Data','Cliente','NF','Produto','Quantidade','Motorista','Status'], keys:['data','cliente','nf','produto','quantidade','motorista','status'], rows, summary:`${rows.length} linha(s) de produto no período.` };
}

function systemHelp(text) {
  const n=norm(text);
  if (/backlog/.test(n)) return 'Backlog é o retorno de NFs não entregues. Os itens retornam como estoque bloqueado e ficam em evidência até serem liberados ou reenviados.';
  if (/entrada|recebimento|nf/.test(n)) return 'Em Entradas você pode cadastrar manualmente, importar XML ou fotografar a NF. A validade é sugerida para 40 dias após a chegada e pode ser ajustada antes da confirmação.';
  if (/saida|pedido|romaneio|entrega/.test(n)) return 'Em Saídas você pode cadastrar a carga manualmente ou importar o romaneio por foto. Cada NF mantém cliente, produtos e quantidades; o estoque só é baixado depois da conferência.';
  if (/inventario/.test(n)) return 'O Inventário compara a contagem física com o estoque disponível e bloqueado. Divergências são registradas com o usuário responsável.';
  if (/avaria|perda/.test(n)) return 'Avarias e perdas descontam o produto do estoque, com motivo, quantidade, origem e responsável. A AION IA pode abrir o formulário já preenchido para conferência.';
  if (/usuario|operador|gerente|permiss/.test(n)) return 'Somente Gerentes administram usuários e ajustes manuais sensíveis. Operadores podem executar a rotina operacional; todas as ações ficam vinculadas ao login.';
  if (/relatorio|pdf/.test(n)) return 'Você pode pedir relatórios em linguagem natural, por exemplo: “gere PDF de vendas dos últimos 15 dias”, “relatório por clientes este mês” ou “relatório de avarias dos últimos 30 dias”.';
  return 'Posso ajudar com estoque, entradas, saídas, backlog, inventário, avarias, cadastros rápidos e relatórios em PDF. Também posso explicar como usar qualquer parte do Life Sucos.';
}

function operationalSnapshot() {
  const products=Data.all('products').filter(p=>p.ativo!==false);
  const lots=svc.listAllLots();
  const byProd=new Map();
  for(const l of lots){ if(!byProd.has(l.productId)) byProd.set(l.productId,{d:0,b:0}); const x=byProd.get(l.productId); x.d+=Number(l.quantidadeDisponivel||0); x.b+=Number(l.quantidadeBloqueada||0); }
  const zero=products.filter(p=>(byProd.get(p.id)?.d||0)===0);
  const low=products.filter(p=>{const q=byProd.get(p.id)?.d||0; return q>0 && q<Number(p.estoqueMinimo||0);});
  const backlog=Data.all('backlog').filter(b=>['bloqueado','em_reentrega'].includes(b.status));
  const routes=Data.all('exits').filter(e=>e.status==='em_rota');
  return { products,lots,zero,low,backlog,routes,byProd };
}

router.get('/status', (req,res)=>res.json(AionUnified.status()));

router.get('/catalogs', (req,res)=>{
  res.json({ customers:Data.all('customers'), suppliers:Data.all('suppliers') });
});

router.post('/master/customer', (req,res)=>{
  const b=req.body||{}; if(!String(b.nome||'').trim()) return res.status(400).json({error:'Informe o nome do cliente.'});
  const existing=Data.all('customers').find(x=>norm(x.nome)===norm(b.nome));
  if(existing) return res.json({item:existing,created:false,message:'Cliente já cadastrado.'});
  const item={id:uid('cli'),nome:String(b.nome).trim(),cnpj:String(b.cnpj||'').trim(),telefone:String(b.telefone||'').trim(),observacoes:String(b.observacoes||'').trim(),ativo:true,criadoEm:new Date().toISOString(),responsavel:currentAudit(req)};
  Data.upsert('customers',item.id,item); history('cadastro_cliente',req,`Cliente cadastrado pela AION IA: ${item.nome}`);
  res.json({item,created:true,message:`Cliente ${item.nome} cadastrado.`});
});
router.post('/master/supplier', (req,res)=>{
  const b=req.body||{}; if(!String(b.nome||'').trim()) return res.status(400).json({error:'Informe o nome do fornecedor.'});
  const existing=Data.all('suppliers').find(x=>norm(x.nome)===norm(b.nome));
  if(existing) return res.json({item:existing,created:false,message:'Fornecedor já cadastrado.'});
  const item={id:uid('forn'),nome:String(b.nome).trim(),cnpj:String(b.cnpj||'').trim(),telefone:String(b.telefone||'').trim(),observacoes:String(b.observacoes||'').trim(),ativo:true,criadoEm:new Date().toISOString(),responsavel:currentAudit(req)};
  Data.upsert('suppliers',item.id,item); history('cadastro_fornecedor',req,`Fornecedor cadastrado pela AION IA: ${item.nome}`);
  res.json({item,created:true,message:`Fornecedor ${item.nome} cadastrado.`});
});

router.post('/ask', async (req,res)=>{
  const text=String(req.body?.message||'').trim();
  if(!text) return res.status(400).json({error:'Escreva uma pergunta ou solicitação.'});
  const n=norm(text);
  const snap=operationalSnapshot();

  const sharedData=AionUnified.dataAnswer(req,text,'operational');
  if(sharedData) return res.json(sharedData);

  // Relatórios e PDFs
  if (/relatorio|relatório|pdf|vendas|saidas|saídas/.test(n) && (/relatorio|relatório|pdf|vendas/.test(n))) {
    const report=reportSpec(text);
    return res.json({ reply:`Preparei “${report.title}”. ${report.summary} Confira a prévia e use “Gerar PDF”.`, action:{type:'report',report} });
  }

  // Cadastros rápidos simples
  let m=text.match(/(?:cadastrar|cadastre|novo|nova|adicionar)\s+cliente\s+(.+)/i);
  if(m){ const payload=parseMasterPayload(m[1]); return res.json({reply:`Posso cadastrar o cliente “${payload.nome}”. Confirme os dados antes de gravar com seu usuário como responsável.`,action:{type:'confirm_master',kind:'customer',payload}}); }
  m=text.match(/(?:cadastrar|cadastre|novo|nova|adicionar)\s+fornecedor\s+(.+)/i);
  if(m){ const payload=parseMasterPayload(m[1]); return res.json({reply:`Posso cadastrar o fornecedor “${payload.nome}”. Confirme os dados antes de gravar.`,action:{type:'confirm_master',kind:'supplier',payload}}); }

  // Rascunho de entrada
  if (/\b(?:nova entrada|registrar entrada|cadastrar entrada|recebimento)\b/.test(n)) {
    const product=getProductRef(text); const q=parseQuantityAndUnit(text);
    let fornecedor=findAfterKeyword(text,['fornecedor']);
    fornecedor=fornecedor.replace(/\s+(?:nf|produto|codigo|código)\b.*$/i,'').trim();
    if(!fornecedor){ const fm=text.match(/(?:de|do fornecedor)\s+([^,;]+?)(?:\s+produto|\s+codigo|\s+código|\s+\d{3}\b|$)/i); if(fm) fornecedor=fm[1].trim(); }
    const nf=(text.match(/\bnf\s*[:#-]?\s*([\w.-]+)/i)||[])[1]||'';
    const draft={data:todayBR(),fornecedor,nf,itens:product&&q.quantidade?[{produtoId:product.id,produtoNome:product.nome,quantidade:q.quantidade,embalagem:q.unidade}]:[]};
    return res.json({reply:`Abro a Entrada já com o que consegui identificar${product?`: ${product.nome}`:''}. Confira os dados antes de registrar.`,action:{type:'open_entry',draft}});
  }

  // Rascunho de saída/pedido
  if (/\b(?:novo pedido|nova saida|nova saída|registrar saida|registrar saída|cadastrar pedido)\b/.test(n)) {
    const product=getProductRef(text); const q=parseQuantityAndUnit(text);
    let cliente=findAfterKeyword(text,['cliente']);
    if(cliente) cliente=cliente.replace(/\s+(?:nf|produto|codigo|código|motorista|entregador)\b.*$/i,'').trim();
    const nf=(text.match(/\bnf\s*[:#-]?\s*([\w.-]+)/i)||[])[1]||'';
    const motorista=findAfterKeyword(text,['motorista','entregador']).replace(/\s+(?:cliente|nf|produto|codigo|código)\b.*$/i,'').trim();
    const draft={cliente,motorista,nfs:[{numero:nf,cliente,itens:product&&q.quantidade?[{produtoId:product.id,quantidade:q.quantidade,embalagem:q.unidade}]:[{}]}]};
    return res.json({reply:'Preparei um rascunho da saída/pedido. A operação só será registrada depois da sua conferência e confirmação.',action:{type:'open_exit',draft}});
  }

  // Avaria/perda
  if (/\b(?:registrar|cadastrar|nova|novo)?\s*(?:avaria|perda)\b/.test(n)) {
    const product=getProductRef(text); const q=parseQuantityAndUnit(text);
    let motivo='Outro';
    if(/vazamento/.test(n)) motivo='Vazamento'; else if(/quebrad/.test(n)) motivo='Produto quebrado'; else if(/vencid/.test(n)) motivo='Produto vencido'; else if(/danific/.test(n)) motivo='Produto danificado';
    return res.json({reply:`Vou abrir o registro de avaria/perda${product?` para ${product.nome}`:''}. Confira antes de baixar do estoque.`,action:{type:'open_loss',draft:{produtoId:product?.id||'',quantidade:q.quantidade||'',motivo,origem:/bloquead|backlog/.test(n)?'bloqueado':'disponivel'}}});
  }

  // Produto
  if (/\b(?:cadastrar|novo|nova|adicionar)\s+produto\b/.test(n)) {
    const code=(text.match(/\bc[oó]digo\s*[:#-]?\s*(\d+)/i)||[])[1]||'';
    const name=(text.match(/produto\s+(.+?)(?:\s+c[oó]digo\b|$)/i)||[])[1]||'';
    return res.json({reply:'Abro o cadastro de produto como rascunho. Você confirma antes de salvar.',action:{type:'open_product',draft:{codigoInterno:code,nome:name.trim()}}});
  }

  // Perguntas sobre situação operacional
  if (/estoque zerado|sem estoque|zerad/.test(n)) {
    const names=snap.zero.slice(0,8).map(p=>p.nome);
    return res.json({reply:`Há ${snap.zero.length} produto(s) com estoque disponível zerado.${names.length?` Principais: ${names.join(', ')}.`:''}`});
  }
  if (/estoque baixo|abaixo do minimo|abaixo do mínimo/.test(n)) {
    const names=snap.low.slice(0,8).map(p=>p.nome);
    return res.json({reply:`Há ${snap.low.length} produto(s) abaixo do estoque mínimo.${names.length?` ${names.join(', ')}.`:''}`});
  }
  if (/quant[oa].*backlog|backlog.*quant/.test(n)) return res.json({reply:`Existem ${snap.backlog.length} item(ns) em backlog ativo neste momento.`});
  if (/entregas?.*rota|motoristas?.*rota/.test(n)) return res.json({reply:`Há ${snap.routes.length} entrega(s) em rota.${snap.routes.length?` Motoristas: ${snap.routes.slice(0,8).map(x=>x.motorista).filter(Boolean).join(', ')}.`:''}`});

  const product=getProductRef(text);
  if(product && /estoque|quantidade|tem quanto|quanto tem/.test(n)) {
    const x=snap.byProd.get(product.id)||{d:0,b:0};
    return res.json({reply:`${product.nome}: ${x.d} unidade(s) disponíveis e ${x.b} bloqueada(s).`});
  }

  // Camada unificada: ajuda ampla, análise gerencial e IA externa/web opcional.
  try {
    const answer = await AionUnified.unifiedFallback({req,message:text,scope:'operational'});
    if (answer) return res.json(answer);
  } catch (err) {
    console.warn('[AION] fallback unificado:', err.message);
  }

  return res.json({reply:systemHelp(text),source:'local-knowledge'});
});

module.exports = router;
