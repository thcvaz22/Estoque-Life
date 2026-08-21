/* ============================================================
   COMMERCIALROUTES.JS — Ecossistema Life Vendas + Life Operação
   Clientes por carteira, aprovação, preços, pedidos, reservas e
   romaneio consolidado. O vendedor nunca escreve estoque direto.
   ============================================================ */
const express = require('express');
const { db, Data } = require('./db');
const svc = require('./services/inventoryService');
const AionUnified = require('./services/aionUnified');
const { toBaseUnits, normalizeMovementUnit } = require('./catalog');
const { todayLocalISO, nowUTCISOString } = require('./time');

const router = express.Router();
const STAFF = new Set(['Gerente','Operador']);

function uid(prefix){ return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`; }
function err(status,msg){ const e=new Error(msg); e.status=status; throw e; }
function auditLabel(req){ return req.authUser?.auditLabel || `${req.authUser?.nome || 'Usuário'} (${req.authUser?.username || '-'})`; }
function isManager(req){ return req.authUser?.perfil === 'Gerente'; }
function isStaff(req){ return STAFF.has(req.authUser?.perfil); }
function isSeller(req){ return req.authUser?.perfil === 'Vendedor'; }
function requireStaff(req,res,next){ if(!isStaff(req)) return res.status(403).json({error:'Acesso restrito à equipe operacional.',code:'STAFF_REQUIRED'}); next(); }
function requireManager(req,res,next){ if(!isManager(req)) return res.status(403).json({error:'Acesso restrito ao gerente.',code:'MANAGER_REQUIRED'}); next(); }
function getProduct(id){ return Data.get('products',id); }
function getCustomer(id){ return Data.get('customers',id); }
function getOrder(id){ return Data.get('orders',id); }
function saveHistory(req,tipo,motivo,observacoes=''){
  const row={id:uid('hist'),timestamp:nowUTCISOString(),usuario:auditLabel(req),tipo,motivo,observacoes};
  Data.upsert('history',row.id,row); return row;
}
function docs(store){ return Data.all(store); }
function clientOperationId(req){ return String(req.body?.clientOperationId || req.headers['x-life-seller-offline-id'] || '').trim(); }
function clientOperationCached(id){
  if(!id) return null;
  const r=db.prepare('SELECT result FROM operations WHERE id=?').get(id);
  if(!r) return null;
  try{return JSON.parse(r.result);}catch{return null;}
}
function saveClientOperation(id,result){
  if(!id)return;
  db.prepare('INSERT OR IGNORE INTO operations(id,result,createdAt) VALUES(?,?,?)').run(id,JSON.stringify(result),nowUTCISOString());
}
function productAvailableRaw(productId){
  const today=todayLocalISO();
  const row=db.prepare(`SELECT COALESCE(SUM(quantidadeDisponivel),0) AS q FROM lots WHERE productId=? AND (validade IS NULL OR validade >= ?)`).get(productId,today);
  return Number(row?.q||0);
}
function reserved(productId,excludeOrderId=null){
  if(excludeOrderId){
    const r=db.prepare(`SELECT COALESCE(SUM(quantity),0) AS q FROM stock_reservations WHERE productId=? AND status='active' AND orderId<>?`).get(productId,excludeOrderId);
    return Number(r?.q||0);
  }
  const r=db.prepare(`SELECT COALESCE(SUM(quantity),0) AS q FROM stock_reservations WHERE productId=? AND status='active'`).get(productId);
  return Number(r?.q||0);
}
function availableForSale(productId,excludeOrderId=null){ return Math.max(0, productAvailableRaw(productId)-reserved(productId,excludeOrderId)); }
function activeCustomer(c){ return c && c.ativo !== false && c.statusAprovacao === 'aprovado'; }
function sellerCanSeeCustomer(req,c){ return isStaff(req) || isManager(req) || (isSeller(req) && c.vendedorId===req.authUser.id); }
function tableForCustomer(tableId,customerId){
  const t=Data.get('priceTables',tableId);
  if(!t || t.ativo===false) return null;
  if(t.tipo==='personalizada' && t.clienteId && t.clienteId!==customerId) return null;
  return t;
}
function priceFor(t,productId){ return Number((t?.precos||{})[productId]||0); }
function paymentInfo(customer,forma,total){
  const f=String(forma||'').trim();
  const allowed = customer.classificacao==='Verde' ? ['Pix','Dinheiro','Boleto'] : ['Pix','Dinheiro'];
  if(!allowed.includes(f)) err(400, `Forma de pagamento ${f || '(não informada)'} não liberada para cliente ${customer.classificacao || 'sem classificação'}.`);
  if(f!=='Boleto') return {formaPagamento:f,prazoBoletoDias:null,vencimentoBoleto:null};
  if(total < 150) err(400,'Boleto disponível somente para pedidos a partir de R$ 150,00.');
  const dias = total >= 300 ? 14 : 7;
  const dt=new Date(); dt.setDate(dt.getDate()+dias);
  return {formaPagamento:'Boleto',prazoBoletoDias:dias,vencimentoBoleto:dt.toLocaleDateString('sv-SE')};
}
function normalizeOrderItems(items,table,customerId,{allowPriceOverride=false}={}){
  if(!Array.isArray(items)||!items.length) err(400,'Adicione ao menos um item ao pedido.');
  const out=[]; const needs={};
  for(const it of items){
    const p=getProduct(it.produtoId); if(!p||p.ativo===false) err(400,'Produto inválido ou inativo no pedido.');
    const unidade=normalizeMovementUnit(it.unidadeMovimentacao||'Unidade');
    let unidades; try{ unidades=toBaseUnits(p,Number(it.quantidade),unidade); }catch(e){ err(400,e.message); }
    if(!Number.isInteger(unidades)) err(400,`A conversão de ${p.nome} resultou em quantidade fracionada. Use uma unidade compatível.`);
    let preco=priceFor(table,p.id);
    if(allowPriceOverride && it.precoUnitario!==undefined && Number(it.precoUnitario)>=0) preco=Number(it.precoUnitario);
    if(!(preco>0)) err(400,`O produto ${p.nome} não possui preço definido na tabela ${table.nome}.`);
    const subtotal=Number((unidades*preco).toFixed(2));
    out.push({produtoId:p.id,produtoNome:p.nome,codigoInterno:p.codigoInterno||'',quantidade:Number(it.quantidade),unidadeMovimentacao:unidade,quantidadeUnidades:unidades,precoUnitario:preco,subtotal});
    needs[p.id]=(needs[p.id]||0)+unidades;
  }
  return {items:out,needs,total:Number(out.reduce((a,i)=>a+i.subtotal,0).toFixed(2))};
}
function replaceReservations(orderId,needs){
  db.prepare(`UPDATE stock_reservations SET status='released', updatedAt=? WHERE orderId=? AND status='active'`).run(nowUTCISOString(),orderId);
  for(const [productId,qty] of Object.entries(needs)){
    const avail=availableForSale(productId,orderId);
    if(avail<qty){ const p=getProduct(productId); err(409,`Estoque disponível insuficiente para ${p?.nome||productId}. Disponível para venda: ${avail}; solicitado: ${qty}.`); }
  }
  const ins=db.prepare(`INSERT INTO stock_reservations (id,orderId,productId,quantity,status,createdAt,updatedAt) VALUES (?,?,?,?, 'active', ?, ?)`);
  const now=nowUTCISOString(); for(const [productId,qty] of Object.entries(needs)) ins.run(uid('res'),orderId,productId,qty,now,now);
}
function releaseReservations(orderId,status='released'){
  db.prepare(`UPDATE stock_reservations SET status=?, updatedAt=? WHERE orderId=? AND status='active'`).run(status,nowUTCISOString(),orderId);
}
function breakdown(product,totalUnits){
  let rem=Number(totalUnits)||0;
  const upf=Number(product.unidadesPorFardo||product.qtdPorEmbalagem||1);
  const fpp=Number(product.fardosPorPalete||0);
  const pallet=upf*fpp;
  const result={pallets:0,meioPallets:0,fardos:0,unidades:0,nomeFardo:product.nomeFardo||'Fardo'};
  if(pallet>0){ result.pallets=Math.floor(rem/pallet); rem-=result.pallets*pallet; const half=pallet/2; if(Number.isInteger(half)&&half>0&&rem>=half){result.meioPallets=1; rem-=half;} }
  if(upf>0){ result.fardos=Math.floor(rem/upf); rem-=result.fardos*upf; }
  result.unidades=rem; return result;
}

function buildManifestPayload(orders, base = {}){
  const grouped={};
  for(const o of orders) for(const it of (o.itens||[])){
    if(!grouped[it.produtoId]) grouped[it.produtoId]={produtoId:it.produtoId,produtoNome:it.produtoNome,codigoInterno:it.codigoInterno,quantidadeUnidades:0};
    grouped[it.produtoId].quantidadeUnidades += Number(it.quantidadeUnidades||0);
  }
  const totals=Object.values(grouped).map(g=>({...g,conversao:breakdown(getProduct(g.produtoId),g.quantidadeUnidades)}));
  return {...base,orderIds:orders.map(o=>o.id),pedidos:orders.map(o=>({pedidoId:o.id,numero:o.numero,cliente:o.clienteNome,nfNumero:o.nfNumero||o.numero,itens:o.itens})),totais,atualizadoEm:nowUTCISOString()};
}
function visibleOrders(req){
  const all=docs('orders');
  if(isSeller(req)) return all.filter(o=>o.vendedorId===req.authUser.id);
  return all;
}
function orderNumber(){
  const max=docs('orders').reduce((m,o)=>Math.max(m,Number(String(o.numero||'').replace(/\D/g,''))||0),0);
  return `PED${String(max+1).padStart(6,'0')}`;
}

// ---------- Estoque comercial (já descontando reservas) ----------
router.get('/stock', (req,res)=>{
  const data=docs('products').filter(p=>p.ativo!==false).map(p=>({id:p.id,codigoInterno:p.codigoInterno,nome:p.nome,volume:p.volume,embalagem:p.embalagem,unidadesPorFardo:p.unidadesPorFardo,fardosPorPalete:p.fardosPorPalete,nomeFardo:p.nomeFardo,disponivel:availableForSale(p.id),fisico:productAvailableRaw(p.id),reservado:reserved(p.id)}));
  res.json(data);
});

// ---------- Clientes / carteiras ----------
router.get('/customers',(req,res)=>{
  let all=docs('customers').filter(c=>c.ativo!==false);
  if(isSeller(req)) all=all.filter(c=>c.vendedorId===req.authUser.id);
  res.json(all.sort((a,b)=>String(a.nome||a.razaoSocial||'').localeCompare(String(b.nome||b.razaoSocial||''),'pt-BR')));
});
router.get('/customers/pending',requireStaff,(req,res)=>res.json(docs('customers').filter(c=>c.ativo!==false&&['pendente','pre_cadastro'].includes(c.statusAprovacao))));
router.post('/customers',(req,res)=>{
  if(!isSeller(req) && !isStaff(req)) return res.status(403).json({error:'Perfil sem permissão para cadastrar cliente.'});
  const _clientOp=clientOperationId(req); const _cached=clientOperationCached(_clientOp); if(_cached) return res.json(_cached);
  const b=req.body||{}; const nome=String(b.nome||b.nomeFantasia||b.razaoSocial||'').trim(); if(!nome) return res.status(400).json({error:'Informe o nome do cliente.'});
  const cnpj=String(b.cnpj||'').replace(/\D/g,'');
  if(cnpj){ const existing=docs('customers').find(c=>String(c.cnpj||'').replace(/\D/g,'')===cnpj); if(existing) return res.status(409).json({error: existing.vendedorId && existing.vendedorId!==req.authUser.id ? 'Este cliente já pertence à carteira de outro vendedor. Solicite transferência ao gerente.' : 'Este CNPJ já está cadastrado.', customerId:existing.id}); }
  const id=uid('cli'); const seller=isSeller(req)?req.authUser:null;
  const row={id,nome,razaoSocial:b.razaoSocial||'',nomeFantasia:b.nomeFantasia||nome,cnpj:b.cnpj||'',inscricaoEstadual:b.inscricaoEstadual||'',telefone:b.telefone||'',whatsapp:b.whatsapp||'',email:b.email||'',endereco:b.endereco||'',bairro:b.bairro||'',cidade:b.cidade||'',uf:b.uf||'',regiao:b.regiao||'',fornecedor:b.fornecedor||'',observacoes:b.observacoes||'',vendedorId:seller?.id||b.vendedorId||null,vendedorNome:seller?.nome||b.vendedorNome||'',statusAprovacao:isSeller(req)?'pendente':'aprovado',classificacao:isSeller(req)?null:(b.classificacao||'Verde'),tabelaPrecoId:b.tabelaPrecoId||null,ativo:true,criadoEm:nowUTCISOString(),criadoPor:auditLabel(req)};
  Data.upsert('customers',id,row); saveHistory(req,'cadastro_cliente',`Novo cliente ${nome}`,isSeller(req)?'Aguardando aprovação da operação.':'Cadastro criado pela equipe operacional.');
  saveClientOperation(_clientOp,row); res.status(201).json(row);
});

router.put('/customers/:id',requireStaff,(req,res)=>{
  try{
    const c=getCustomer(req.params.id); if(!c||c.ativo===false) return res.status(404).json({error:'Cliente não encontrado.'});
    const b=req.body||{};
    const nome=String(b.nome||b.nomeFantasia||b.razaoSocial||c.nome||'').trim(); if(!nome) return res.status(400).json({error:'Informe o nome do cliente.'});
    const cnpj=String(b.cnpj??c.cnpj??'').replace(/\D/g,'');
    if(cnpj){ const duplicate=docs('customers').find(x=>x.id!==c.id&&x.ativo!==false&&String(x.cnpj||'').replace(/\D/g,'')===cnpj); if(duplicate) return res.status(409).json({error:'Este CNPJ já está cadastrado em outro cliente.',customerId:duplicate.id}); }
    let vendedorId=b.vendedorId===undefined?c.vendedorId:(b.vendedorId||null); let vendedorNome=b.vendedorNome===undefined?c.vendedorNome:String(b.vendedorNome||'');
    if(vendedorId){ const seller=db.prepare(`SELECT id,nome,perfil,ativo FROM users WHERE id=?`).get(vendedorId); if(!seller||seller.perfil!=='Vendedor'||Number(seller.ativo)!==1) return res.status(400).json({error:'Selecione um vendedor ativo.'}); vendedorNome=seller.nome; }
    else vendedorNome='';
    const before={nome:c.nome,cnpj:c.cnpj,cidade:c.cidade,bairro:c.bairro,regiao:c.regiao,vendedorNome:c.vendedorNome,classificacao:c.classificacao,tabelaPrecoId:c.tabelaPrecoId};
    Object.assign(c,{
      nome,razaoSocial:String(b.razaoSocial??c.razaoSocial??''),nomeFantasia:String(b.nomeFantasia??c.nomeFantasia??nome),cnpj:String(b.cnpj??c.cnpj??''),
      inscricaoEstadual:String(b.inscricaoEstadual??c.inscricaoEstadual??''),telefone:String(b.telefone??c.telefone??''),whatsapp:String(b.whatsapp??c.whatsapp??''),email:String(b.email??c.email??''),
      endereco:String(b.endereco??c.endereco??''),bairro:String(b.bairro??c.bairro??''),cidade:String(b.cidade??c.cidade??''),uf:String(b.uf??c.uf??''),regiao:String(b.regiao??c.regiao??''),
      fornecedor:String(b.fornecedor??c.fornecedor??''),observacoes:String(b.observacoes??c.observacoes??''),vendedorId,vendedorNome,
      classificacao:b.classificacao??c.classificacao,tabelaPrecoId:b.tabelaPrecoId===undefined?c.tabelaPrecoId:(b.tabelaPrecoId||null),
      atualizadoEm:nowUTCISOString(),atualizadoPor:auditLabel(req)
    });
    Data.upsert('customers',c.id,c);
    saveHistory(req,'cliente_editado',`Cliente ${c.nome} alterado`,`Antes: ${JSON.stringify(before)} · Depois: ${JSON.stringify({nome:c.nome,cnpj:c.cnpj,cidade:c.cidade,bairro:c.bairro,regiao:c.regiao,vendedorNome:c.vendedorNome,classificacao:c.classificacao,tabelaPrecoId:c.tabelaPrecoId})}`);
    res.json(c);
  }catch(e){res.status(e.status||500).json({error:e.message});}
});

router.delete('/customers/:id',requireStaff,(req,res)=>{
  const c=getCustomer(req.params.id); if(!c||c.ativo===false) return res.status(404).json({error:'Cliente não encontrado.'});
  c.ativo=false; c.excluidoEm=nowUTCISOString(); c.excluidoPor=auditLabel(req); c.atualizadoEm=c.excluidoEm; c.atualizadoPor=c.excluidoPor;
  Data.upsert('customers',c.id,c);
  saveHistory(req,'cliente_excluido',`Cliente ${c.nome} excluído`,`Exclusão lógica para preservar pedidos, notas fiscais e auditoria vinculados.`);
  res.json({ok:true,id:c.id});
});

router.post('/customers/:id/approve',requireStaff,(req,res)=>{
  const c=getCustomer(req.params.id); if(!c) return res.status(404).json({error:'Cliente não encontrado.'});
  const cls=String(req.body?.classificacao||''); if(!['Verde','Amarelo'].includes(cls)) return res.status(400).json({error:'Selecione a classificação Verde ou Amarelo.'});
  c.statusAprovacao='aprovado'; c.classificacao=cls; c.tabelaPrecoId=req.body?.tabelaPrecoId||c.tabelaPrecoId||null; c.cadastroIncompleto=false; c.dadosPendentes=[]; c.aprovadoPor=auditLabel(req); c.aprovadoEm=nowUTCISOString(); c.motivoReprovacao='';
  Data.upsert('customers',c.id,c); saveHistory(req,'cliente_aprovado',`Cliente ${c.nome} aprovado como ${cls}`,`Vendedor: ${c.vendedorNome||'-'}`); res.json(c);
});
router.post('/customers/:id/reject',requireStaff,(req,res)=>{
  const c=getCustomer(req.params.id); if(!c) return res.status(404).json({error:'Cliente não encontrado.'});
  c.statusAprovacao='reprovado'; c.motivoReprovacao=String(req.body?.observacao||'Cadastro reprovado'); c.reprovadoPor=auditLabel(req); c.reprovadoEm=nowUTCISOString();
  Data.upsert('customers',c.id,c); saveHistory(req,'cliente_reprovado',`Cadastro de ${c.nome} reprovado`,c.motivoReprovacao); res.json(c);
});
router.post('/customers/:id/transfer',requireManager,(req,res)=>{
  const c=getCustomer(req.params.id); if(!c) return res.status(404).json({error:'Cliente não encontrado.'});
  const seller=db.prepare(`SELECT id,nome,username,perfil,ativo FROM users WHERE id=?`).get(req.body?.vendedorId); if(!seller||seller.perfil!=='Vendedor'||Number(seller.ativo)!==1) return res.status(400).json({error:'Selecione um vendedor ativo.'});
  const before=c.vendedorNome||'Sem vendedor'; c.vendedorId=seller.id;c.vendedorNome=seller.nome;c.transferidoEm=nowUTCISOString();c.transferidoPor=auditLabel(req); Data.upsert('customers',c.id,c);
  saveHistory(req,'cliente_transferido',`Cliente ${c.nome} transferido`,`${before} → ${seller.nome}`); res.json(c);
});

// ---------- Vendedores ----------
router.get('/sellers',requireStaff,(req,res)=>{ const rows=db.prepare(`SELECT id,username,nome,perfil,ativo FROM users WHERE perfil='Vendedor' ORDER BY nome COLLATE NOCASE`).all(); res.json(rows.map(r=>({...r,ativo:Number(r.ativo)===1}))); });

// ---------- Tabelas de preço ----------
router.get('/price-tables',(req,res)=>{
  let tables=docs('priceTables').filter(t=>t.ativo!==false);
  if(isSeller(req)){
    const clientIds=new Set(docs('customers').filter(c=>c.vendedorId===req.authUser.id).map(c=>c.id));
    tables=tables.filter(t=>t.tipo!=='personalizada'||clientIds.has(t.clienteId));
  }
  res.json(tables);
});
router.post('/price-tables',requireManager,(req,res)=>{
  const b=req.body||{}; if(!String(b.nome||'').trim()) return res.status(400).json({error:'Informe o nome da tabela.'});
  const id=uid('price'); const row={id,nome:String(b.nome).trim(),tipo:b.tipo==='personalizada'?'personalizada':'padrao',clienteId:b.clienteId||null,ativo:true,precos:b.precos&&typeof b.precos==='object'?b.precos:{},criadoEm:nowUTCISOString(),criadoPor:auditLabel(req)};
  Data.upsert('priceTables',id,row); if(row.tipo==='personalizada'&&row.clienteId){const c=getCustomer(row.clienteId);if(c){c.tabelaPrecoId=id;Data.upsert('customers',c.id,c);}} saveHistory(req,'tabela_preco_cadastrada',`Tabela ${row.nome} cadastrada`,row.clienteId?`Personalizada para cliente ${row.clienteId}`:'Tabela padrão'); res.status(201).json(row);
});
router.put('/price-tables/:id',requireManager,(req,res)=>{
  const t=Data.get('priceTables',req.params.id); if(!t) return res.status(404).json({error:'Tabela não encontrada.'}); const b=req.body||{};
  t.nome=String(b.nome??t.nome).trim(); t.tipo=b.tipo==='personalizada'?'personalizada':(b.tipo==='padrao'?'padrao':t.tipo); t.clienteId=b.clienteId!==undefined?b.clienteId:t.clienteId; t.precos=b.precos&&typeof b.precos==='object'?b.precos:t.precos; t.ativo=b.ativo!==undefined?!!b.ativo:t.ativo; t.atualizadoEm=nowUTCISOString();t.atualizadoPor=auditLabel(req);
  Data.upsert('priceTables',t.id,t); saveHistory(req,'tabela_preco_editada',`Tabela ${t.nome} alterada`); res.json(t);
});

// ---------- Custos ----------
router.get('/costs',requireStaff,(req,res)=>res.json(docs('products').map(p=>({produtoId:p.id,codigoInterno:p.codigoInterno,nome:p.nome,custoAtual:Number(p.custoAtual||0)}))));
router.post('/costs/:productId',requireManager,(req,res)=>{
  const p=getProduct(req.params.productId); if(!p) return res.status(404).json({error:'Produto não encontrado.'}); const custo=Number(req.body?.custo); if(!Number.isFinite(custo)||custo<0) return res.status(400).json({error:'Custo inválido.'});
  const before=Number(p.custoAtual||0); p.custoAtual=custo;p.custoAtualizadoEm=nowUTCISOString();p.custoAtualizadoPor=auditLabel(req);Data.upsert('products',p.id,p);
  const h={id:uid('cost'),produtoId:p.id,produtoNome:p.nome,custoAnterior:before,custoNovo:custo,data:nowUTCISOString(),responsavel:auditLabel(req)};Data.upsert('costHistory',h.id,h);saveHistory(req,'custo_alterado',`Custo de ${p.nome} alterado`,`R$ ${before.toFixed(2)} → R$ ${custo.toFixed(2)}`);res.json(h);
});

// ---------- Pedidos ----------
router.get('/orders',(req,res)=>res.json(visibleOrders(req).sort((a,b)=>String(b.criadoEm||'').localeCompare(String(a.criadoEm||'')))));
router.post('/orders',(req,res)=>{
  if(!isSeller(req)&&!isStaff(req)) return res.status(403).json({error:'Perfil sem permissão para criar pedidos.'});
  const _clientOp=clientOperationId(req); const _cached=clientOperationCached(_clientOp); if(_cached) return res.json(_cached);
  try{
    const b=req.body||{}; const c=getCustomer(b.clienteId); if(!activeCustomer(c)) err(400,'Cliente ainda não está aprovado para pedidos.'); if(isSeller(req)&&c.vendedorId!==req.authUser.id) err(403,'Este cliente não pertence à sua carteira.');
    const tableId=b.tabelaPrecoId||c.tabelaPrecoId; const table=tableForCustomer(tableId,c.id); if(!table) err(400,'Selecione uma tabela de preço válida.');
    const norm=normalizeOrderItems(b.itens,table,c.id,{allowPriceOverride:isStaff(req)}); const pay=paymentInfo(c,b.formaPagamento,norm.total); const id=uid('order');
    const run=db.transaction(()=>{ replaceReservations(id,norm.needs); const row={id,numero:orderNumber(),clienteId:c.id,clienteNome:c.nome||c.nomeFantasia||c.razaoSocial,vendedorId:isSeller(req)?req.authUser.id:(b.vendedorId||c.vendedorId||req.authUser.id),vendedorNome:isSeller(req)?req.authUser.nome:(b.vendedorNome||c.vendedorNome||req.authUser.nome),tabelaPrecoId:table.id,tabelaPrecoNome:table.nome,itens:norm.items,total:norm.total,...pay,observacoes:String(b.observacoes||''),fornecedorNome:String(b.fornecedorNome||c.fornecedor||''),status:'enviado',statusAprovacao:'pendente',nfStatus:b.nfNumero?'informada':'pendente',nfNumero:String(b.nfNumero||''),criadoEm:nowUTCISOString(),criadoPor:auditLabel(req),historicoStatus:[{status:'enviado',data:nowUTCISOString(),por:auditLabel(req)}]}; Data.upsert('orders',id,row); return row; });
    const row=run(); saveHistory(req,'pedido_enviado',`Pedido ${row.numero} enviado`,`Cliente: ${row.clienteNome} · Total R$ ${row.total.toFixed(2)}`); saveClientOperation(_clientOp,row); res.status(201).json(row);
  }catch(e){res.status(e.status||500).json({error:e.message});}
});
router.post('/orders/:id/resubmit',(req,res)=>{
  if(!isSeller(req)) return res.status(403).json({error:'Somente o vendedor responsável pode reenviar o pedido.'});
  try{ const old=getOrder(req.params.id); if(!old||old.vendedorId!==req.authUser.id) err(404,'Pedido não encontrado.'); if(!['refazer','reprovado'].includes(old.status)) err(409,'Este pedido não está disponível para refazer.'); const c=getCustomer(old.clienteId); if(!activeCustomer(c)) err(400,'Cliente não aprovado.'); const table=tableForCustomer(req.body?.tabelaPrecoId||old.tabelaPrecoId,c.id); if(!table) err(400,'Tabela inválida.'); const norm=normalizeOrderItems(req.body?.itens||old.itens,table,c.id); const pay=paymentInfo(c,req.body?.formaPagamento||old.formaPagamento,norm.total); const run=db.transaction(()=>{replaceReservations(old.id,norm.needs);Object.assign(old,{itens:norm.items,total:norm.total,...pay,tabelaPrecoId:table.id,tabelaPrecoNome:table.nome,observacoes:req.body?.observacoes??old.observacoes,status:'enviado',statusAprovacao:'pendente',observacaoOperador:'',atualizadoEm:nowUTCISOString()});old.historicoStatus=(old.historicoStatus||[]).concat({status:'reenviado',data:nowUTCISOString(),por:auditLabel(req)});Data.upsert('orders',old.id,old);return old;}); const row=run();saveHistory(req,'pedido_reenviado',`Pedido ${row.numero} reenviado`);res.json(row);}catch(e){res.status(e.status||500).json({error:e.message});}
});
router.post('/orders/:id/rework',requireStaff,(req,res)=>{
  const o=getOrder(req.params.id); if(!o) return res.status(404).json({error:'Pedido não encontrado.'}); if(!['enviado'].includes(o.status)) return res.status(409).json({error:'Somente pedidos enviados podem ser devolvidos para refazer.'}); releaseReservations(o.id);o.status='refazer';o.statusAprovacao='refazer';o.observacaoOperador=String(req.body?.observacao||'Ajustes necessários');o.historicoStatus=(o.historicoStatus||[]).concat({status:'refazer',data:nowUTCISOString(),por:auditLabel(req),observacao:o.observacaoOperador});Data.upsert('orders',o.id,o);saveHistory(req,'pedido_refazer',`Pedido ${o.numero} devolvido para refazer`,o.observacaoOperador);res.json(o);
});
router.post('/orders/:id/reject',requireStaff,(req,res)=>{
  const o=getOrder(req.params.id);if(!o)return res.status(404).json({error:'Pedido não encontrado.'});if(['aprovado','faturado'].includes(o.status))return res.status(409).json({error:'Pedido já aprovado/faturado não pode ser reprovado por este fluxo.'});releaseReservations(o.id);o.status='reprovado';o.statusAprovacao='reprovado';o.observacaoOperador=String(req.body?.observacao||'Pedido reprovado');o.historicoStatus=(o.historicoStatus||[]).concat({status:'reprovado',data:nowUTCISOString(),por:auditLabel(req),observacao:o.observacaoOperador});Data.upsert('orders',o.id,o);saveHistory(req,'pedido_reprovado',`Pedido ${o.numero} reprovado`,o.observacaoOperador);res.json(o);
});
router.put('/orders/:id',requireStaff,(req,res)=>{
  try{const o=getOrder(req.params.id);if(!o)err(404,'Pedido não encontrado.');if(!['enviado','refazer'].includes(o.status))err(409,'Este pedido não pode mais ser alterado.');const c=getCustomer(req.body?.clienteId||o.clienteId);if(!activeCustomer(c))err(400,'Cliente inválido.');const table=tableForCustomer(req.body?.tabelaPrecoId||o.tabelaPrecoId,c.id);if(!table)err(400,'Tabela inválida.');const norm=normalizeOrderItems(req.body?.itens||o.itens,table,c.id,{allowPriceOverride:true});const pay=paymentInfo(c,req.body?.formaPagamento||o.formaPagamento,norm.total);const run=db.transaction(()=>{replaceReservations(o.id,norm.needs);Object.assign(o,{clienteId:c.id,clienteNome:c.nome||c.nomeFantasia||c.razaoSocial,tabelaPrecoId:table.id,tabelaPrecoNome:table.nome,itens:norm.items,total:norm.total,...pay,observacoes:req.body?.observacoes??o.observacoes,nfNumero:req.body?.nfNumero!==undefined?String(req.body.nfNumero||''):o.nfNumero,nfStatus:req.body?.nfNumero!==undefined?(req.body.nfNumero?'informada':'pendente'):o.nfStatus,fornecedorNome:req.body?.fornecedorNome!==undefined?String(req.body.fornecedorNome||''):o.fornecedorNome,status:'enviado',statusAprovacao:'pendente',alteradoPor:auditLabel(req),alteradoEm:nowUTCISOString()});o.historicoStatus=(o.historicoStatus||[]).concat({status:'alterado_operacao',data:nowUTCISOString(),por:auditLabel(req)});Data.upsert('orders',o.id,o);return o;});const row=run();saveHistory(req,'pedido_alterado',`Pedido ${row.numero} alterado pela operação`);res.json(row);}catch(e){res.status(e.status||500).json({error:e.message});}
});
router.post('/orders/:id/approve',requireStaff,(req,res)=>{
  try{
    const o=getOrder(req.params.id);
    if(!o) err(404,'Pedido não encontrado.');
    if(o.status!=='enviado') err(409,'Somente pedidos enviados podem ser aprovados.');
    const opId=`approve_${o.id}`;
    const nfs=[{numero:o.nfNumero||o.numero,cliente:o.clienteNome,itens:o.itens.map(i=>({produtoId:i.produtoId,quantidade:i.quantidadeUnidades,unidadeMovimentacao:'Unidade'}))}];
    const run=db.transaction(()=>{
      const exit=svc.createExit({operationId:opId,motorista:'A definir',veiculo:'',placa:'',cliente:o.clienteNome,horarioSaida:nowUTCISOString(),status:'aguardando_romaneio',nfs,usuario:auditLabel(req),reservationOrderId:o.id});
      releaseReservations(o.id,'consumed');
      o.status='aprovado';
      o.statusAprovacao='aprovado';
      o.aprovadoPor=auditLabel(req);
      o.aprovadoEm=nowUTCISOString();
      o.exitId=exit.id;
      o.manifestId=null;
      o.historicoStatus=(o.historicoStatus||[]).concat({status:'aprovado',data:nowUTCISOString(),por:auditLabel(req),observacao:'Aguardando seleção manual para romaneio.'});
      Data.upsert('orders',o.id,o);
      return {order:o,exit,manifest:null};
    });
    const result=run();
    saveHistory(req,'pedido_aprovado',`Pedido ${o.numero} aprovado`,`Saída: ${result.exit.id} · Aguardando romaneio manual`);
    res.json(result);
  }catch(e){res.status(e.status||500).json({error:e.message});}
});

// ---------- Separação / romaneio consolidado ----------
router.get('/separation/available',requireStaff,(req,res)=>{
  const rows=docs('orders').filter(o=>o.status==='aprovado'&&!o.manifestId).map(o=>{
    const c=getCustomer(o.clienteId)||{};
    return {...o,separationMeta:{
      nfNumero:o.nfNumero||o.numero,
      cliente:o.clienteNome||c.nome||'',
      fornecedor:o.fornecedorNome||c.fornecedor||'',
      cidade:c.cidade||'',
      bairro:c.bairro||'',
      regiao:c.regiao||'',
      vendedor:o.vendedorNome||c.vendedorNome||''
    }};
  });
  res.json(rows);
});
router.post('/separation/manifests',requireStaff,(req,res)=>{
  try{const ids=Array.isArray(req.body?.orderIds)?req.body.orderIds:[];if(!ids.length)err(400,'Selecione ao menos um pedido aprovado.');const orders=ids.map(getOrder);if(orders.some(o=>!o||o.status!=='aprovado'||o.manifestId))err(409,'Há pedido inválido, não aprovado ou já incluído em romaneio.');const grouped={};for(const o of orders)for(const it of o.itens){if(!grouped[it.produtoId])grouped[it.produtoId]={produtoId:it.produtoId,produtoNome:it.produtoNome,codigoInterno:it.codigoInterno,quantidadeUnidades:0};grouped[it.produtoId].quantidadeUnidades+=it.quantidadeUnidades;}const totals=Object.values(grouped).map(g=>{const p=getProduct(g.produtoId);return {...g,conversao:breakdown(p,g.quantidadeUnidades)};});const id=uid('manifest');const row={id,numero:`ROM${Date.now().toString().slice(-7)}`,data:todayLocalISO(),orderIds:ids,pedidos:orders.map(o=>({pedidoId:o.id,numero:o.numero,cliente:o.clienteNome,nfNumero:o.nfNumero||o.numero,itens:o.itens})),totais:totals,status:'aberto',criadoEm:nowUTCISOString(),criadoPor:auditLabel(req)};const run=db.transaction(()=>{Data.upsert('shippingManifests',id,row);for(const o of orders){o.manifestId=id;o.status='separacao';o.historicoStatus=(o.historicoStatus||[]).concat({status:'separacao',data:nowUTCISOString(),por:auditLabel(req)});Data.upsert('orders',o.id,o);}return row;});const saved=run();saveHistory(req,'romaneio_gerado',`Romaneio ${saved.numero} gerado`,`${orders.length} pedido(s) · ${totals.reduce((a,x)=>a+x.quantidadeUnidades,0)} unidades`);res.status(201).json(saved);}catch(e){res.status(e.status||500).json({error:e.message});}
});
router.get('/separation/manifests',requireStaff,(req,res)=>res.json(docs('shippingManifests').sort((a,b)=>String(b.criadoEm||'').localeCompare(String(a.criadoEm||'')))));
router.post('/separation/manifests/:id/close',requireStaff,(req,res)=>{const m=Data.get('shippingManifests',req.params.id);if(!m)return res.status(404).json({error:'Romaneio não encontrado.'});m.status='fechado';m.fechadoEm=nowUTCISOString();m.fechadoPor=auditLabel(req);Data.upsert('shippingManifests',m.id,m);saveHistory(req,'romaneio_fechado',`Romaneio ${m.numero} fechado`);res.json(m);});

// ---------- Dashboard / relatórios do vendedor ----------
router.get('/dashboard',(req,res)=>{
  let orders=visibleOrders(req);const customers=isSeller(req)?docs('customers').filter(c=>c.vendedorId===req.authUser.id):docs('customers');const total=orders.reduce((a,o)=>a+Number(o.total||0),0);const byClient={},byProduct={};for(const o of orders){byClient[o.clienteNome]=(byClient[o.clienteNome]||0)+Number(o.total||0);for(const i of o.itens||[])byProduct[i.produtoNome]=(byProduct[i.produtoNome]||0)+Number(i.quantidadeUnidades||0);}const top=(obj,n=5)=>Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([nome,valor])=>({nome,valor}));const pendingCustomers=customers.filter(c=>c.statusAprovacao==='pendente').length;const suggestions=[];const inactive=customers.filter(c=>c.statusAprovacao==='aprovado'&&!orders.some(o=>o.clienteId===c.id));if(inactive.length)suggestions.push(`${inactive.length} cliente(s) aprovado(s) ainda não possuem pedidos. Uma abordagem de apresentação do mix pode gerar oportunidade.`);const topProd=top(byProduct,1)[0];if(topProd)suggestions.push(`${topProd.nome} é seu produto de maior saída (${topProd.valor} un.). Use-o como âncora para oferecer itens complementares.`);const refazer=orders.filter(o=>o.status==='refazer').length;if(refazer)suggestions.push(`Você possui ${refazer} pedido(s) para refazer. Priorize-os para não perder a negociação.`);if(!suggestions.length)suggestions.push('Sua carteira está em dia. Revise clientes com maior intervalo desde a última compra e planeje os próximos contatos.');res.json({pedidos:orders.length,aprovados:orders.filter(o=>['aprovado','separacao','em_rota','entregue'].includes(o.status)).length,refazer,totalVendido:total,clientes:customers.length,cadastrosPendentes:pendingCustomers,melhoresClientes:top(byClient),produtosMaisVendidos:top(byProduct),sugestoes:suggestions});
});
router.get('/reports',(req,res)=>{let orders=visibleOrders(req);const from=req.query.from,to=req.query.to;if(from)orders=orders.filter(o=>String(o.criadoEm||'').slice(0,10)>=from);if(to)orders=orders.filter(o=>String(o.criadoEm||'').slice(0,10)<=to);res.json({from:from||null,to:to||null,totalPedidos:orders.length,totalValor:Number(orders.reduce((a,o)=>a+Number(o.total||0),0).toFixed(2)),orders});});

function assistantNorm(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}
function assistantMoney(value){
  return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}
function assistantVisibleCustomers(req){
  let rows=docs('customers').filter(c=>c.ativo!==false);
  if(isSeller(req)) rows=rows.filter(c=>c.vendedorId===req.authUser.id);
  return rows;
}
function assistantRange(q){
  const today=todayLocalISO();
  if(/este mes|esse mes|mes atual/.test(q)) return {from:today.slice(0,8)+'01',to:today,label:'este mês'};
  if(/hoje/.test(q)) return {from:today,to:today,label:'hoje'};
  const d=new Date(`${today}T12:00:00-03:00`);
  if(/esta semana|essa semana/.test(q)){
    const dow=d.getDay(); const back=dow===0?6:dow-1; const start=new Date(d); start.setDate(d.getDate()-back);
    return {from:start.toLocaleDateString('sv-SE'),to:today,label:'esta semana'};
  }
  return null;
}
function assistantOrdersInRange(orders,range){
  if(!range) return orders;
  return orders.filter(o=>{const d=String(o.criadoEm||'').slice(0,10);return d>=range.from&&d<=range.to;});
}
function assistantSaleOrders(orders){
  const ok=new Set(['aprovado','faturando','faturado','separacao','em_rota','entregue']);
  return orders.filter(o=>ok.has(String(o.status||'').toLowerCase()));
}
function assistantFindCustomer(req,q){
  const customers=assistantVisibleCustomers(req);
  const direct=customers.filter(c=>{
    const name=assistantNorm(c.nome||c.nomeFantasia||c.razaoSocial||'');
    return name.length>=3 && q.includes(name);
  }).sort((a,b)=>assistantNorm(b.nome||b.nomeFantasia||b.razaoSocial||'').length-assistantNorm(a.nome||a.nomeFantasia||a.razaoSocial||'').length);
  if(direct[0]) return direct[0];
  const m=q.match(/cliente\s+(.+?)(?:\s+(?:comprou|compra|compras|gastou|pediu|vendeu|este|esse|no|na|quanto|quantos)\b|$)/);
  const probe=assistantNorm(m?.[1]||'');
  if(!probe) return null;
  let best=null,bestScore=0;
  for(const c of customers){
    const name=assistantNorm(c.nome||c.nomeFantasia||c.razaoSocial||'');
    if(name.includes(probe)||probe.includes(name)) return c;
    const tokens=probe.split(' ').filter(x=>x.length>2);
    const score=tokens.reduce((n,t)=>n+(name.includes(t)?1:0),0);
    if(score>bestScore){bestScore=score;best=c;}
  }
  return bestScore>0?best:null;
}
function assistantFindProduct(q){
  const products=docs('products').filter(p=>p.ativo!==false);
  const code=(q.match(/\b\d{3,}\b/)||[])[0];
  if(code){const p=products.find(x=>String(x.codigoInterno||'')===code||String(x.codigoBarras||'')===code);if(p)return p;}
  let best=null,bestScore=0;
  for(const p of products){
    const name=assistantNorm(`${p.nome||''} ${p.sabor||''} ${p.volume||''} ${p.embalagem||''}`);
    if(name.length>3&&q.includes(name)) return p;
    const tokens=name.split(' ').filter(x=>x.length>3);
    const score=tokens.reduce((n,t)=>n+(q.includes(t)?1:0),0);
    if(score>bestScore){bestScore=score;best=p;}
  }
  return bestScore>=2?best:null;
}
function assistantHelpText(q){
  if(/relatorio/.test(q)) return 'Para gerar um relatório no Life Vendas:\n1. Abra a aba Relatórios.\n2. Escolha a data inicial e final.\n3. Toque em “Gerar resumo” para conferir os números.\n4. Para salvar, toque em “Gerar PDF”.\n\nSe não gerar, confira se o período está preenchido corretamente e tente novamente. Se aparecer uma mensagem de erro, me diga exatamente o que apareceu que eu te ajudo a identificar.';
  if(/como.*cadastr.*cliente|como.*adicion.*cliente|cadastr(?:ar|e|o).*cliente|adicion.*cliente|novo cliente/.test(q)) return 'Para cadastrar um cliente:\n1. Abra Clientes.\n2. Preencha Nome/Fantasia e os dados disponíveis, como CNPJ, WhatsApp, e-mail e endereço.\n3. Toque em “Enviar para aprovação”.\n4. O cadastro irá para a operação como pendente.\n5. Operador ou Gerente classifica o cliente como Verde ou Amarelo e aprova.\n\nDepois da aprovação, ele fica liberado para novos pedidos conforme as formas de pagamento permitidas.';
  if(/nota fiscal|nf fiscal|nfe|nf-e|gerar nf|emitir nf/.test(q)) return 'A emissão fiscal automática ainda depende da integração com um provedor fiscal e certificado digital. No sistema atual, a operação usa a aba Notas Fiscais para registrar uma NF-e já autorizada, vinculá-la ao pedido, armazenar XML/DANFE e emitir 2ª via.\n\nQuando a integração fiscal estiver configurada, a AION poderá orientar o fluxo de emissão diretamente pelo pedido sem simular autorização da SEFAZ.';
  if(/pedido/.test(q)&&/como|criar|cadastr|novo|fazer/.test(q)) return 'Para criar um pedido:\n1. Abra Novo pedido.\n2. Escolha um cliente aprovado.\n3. Selecione a tabela de preço e a forma de pagamento.\n4. Adicione os produtos e quantidades.\n5. Revise as observações e envie para aprovação.\n\nBoleto: de R$ 150 a R$ 299,99 = 7 dias; a partir de R$ 300 = 14 dias. Cliente Amarelo não usa Boleto.';
  if(/estoque/.test(q)&&/como|ver|consult/.test(q)) return 'Para consultar estoque no Life Vendas, abra Novo pedido. Cada produto mostra a quantidade disponível para venda em tempo real, já descontando reservas de outros pedidos. Você também pode me perguntar “quanto tem do produto 700?” ou citar o nome do produto.';
  if(/refazer/.test(q)) return 'Quando a operação marca um pedido como Refazer, abra Pedidos, confira a observação enviada pela operação, corrija o pedido e envie novamente. A prioridade é resolver esses pedidos antes de criar novas negociações para o mesmo cliente.';
  return null;
}

router.get('/assistant-status',(req,res)=>res.json(AionUnified.status()));

router.post('/assistant',async (req,res)=>{
  const raw=String(req.body?.message||'').trim();
  const q=assistantNorm(raw);
  const history=Array.isArray(req.body?.history)?req.body.history.slice(-10):[];
  if(!q) return res.status(400).json({error:'Escreva uma pergunta para a AION IA.'});
  const orders=visibleOrders(req);
  const customers=assistantVisibleCustomers(req);
  const range=assistantRange(q);

  const sharedData=AionUnified.dataAnswer(req,raw,'sales',history);
  if(sharedData) return res.json({...sharedData,text:sharedData.reply});

  const help=AionUnified.howTo(raw,'sales') || assistantHelpText(q);
  if(help) return res.json({text:help,reply:help,source:'local-knowledge'});

  const customer=assistantFindCustomer(req,q);
  if(customer && /(comprou|compras|gastou|quanto|quantos|valor|pediu)/.test(q)){
    const customerOrders=orders.filter(o=>o.clienteId===customer.id || assistantNorm(o.clienteNome)===assistantNorm(customer.nome||customer.nomeFantasia||customer.razaoSocial));
    const period=range||(/mes/.test(q)?assistantRange('este mes'):null);
    const periodOrders=assistantOrdersInRange(customerOrders,period);
    const confirmed=assistantSaleOrders(periodOrders);
    const confirmedTotal=confirmed.reduce((a,o)=>a+Number(o.total||0),0);
    const pending=periodOrders.filter(o=>!confirmed.includes(o)&&!['reprovado','cancelado'].includes(String(o.status||'').toLowerCase()));
    const label=period?.label||'no período disponível';
    let answer=`${customer.nome||customer.nomeFantasia||customer.razaoSocial} comprou ${assistantMoney(confirmedTotal)} em ${confirmed.length} pedido(s) confirmado(s) ${label}.`;
    if(pending.length) answer+=` Há também ${pending.length} pedido(s) ainda em andamento, somando ${assistantMoney(pending.reduce((a,o)=>a+Number(o.total||0),0))}.`;
    return res.json({text:answer});
  }

  if((/quanto|total|valor/.test(q))&&(/vendi|vendido|vendas/.test(q))){
    const periodOrders=assistantOrdersInRange(orders,range);
    const confirmed=assistantSaleOrders(periodOrders);
    const total=confirmed.reduce((a,o)=>a+Number(o.total||0),0);
    const label=range?.label||'no período total';
    return res.json({text:`Você tem ${confirmed.length} pedido(s) confirmado(s) ${label}, somando ${assistantMoney(total)}.`});
  }

  if(/melhor cliente|maior cliente|cliente que mais/.test(q)){
    const periodOrders=assistantSaleOrders(assistantOrdersInRange(orders,range));
    const by={}; for(const o of periodOrders) by[o.clienteNome]=(by[o.clienteNome]||0)+Number(o.total||0);
    const top=Object.entries(by).sort((a,b)=>b[1]-a[1])[0];
    return res.json({text:top?`Seu cliente com maior volume ${range?.label||'no período analisado'} é ${top[0]}, com ${assistantMoney(top[1])}.`:'Ainda não há pedidos confirmados suficientes para montar esse ranking.'});
  }

  if(/produto.*mais vendido|mais vendido|maior saida|produto que mais/.test(q)){
    const periodOrders=assistantSaleOrders(assistantOrdersInRange(orders,range));
    const by={}; for(const o of periodOrders) for(const i of (o.itens||[])) by[i.produtoNome]=(by[i.produtoNome]||0)+Number(i.quantidadeUnidades||i.quantidade||0);
    const top=Object.entries(by).sort((a,b)=>b[1]-a[1])[0];
    return res.json({text:top?`${top[0]} é o produto com maior saída ${range?.label||'no período analisado'}, com ${top[1]} unidade(s).`:'Ainda não há vendas confirmadas suficientes para calcular o produto de maior saída.'});
  }

  if(/status.*pedido|pedido.*status|como esta.*pedido|situacao.*pedido/.test(q)){
    const number=(raw.match(/(?:PED)?\s*0*(\d{1,6})/i)||[])[1];
    const order=number?orders.find(o=>String(o.numero||'').replace(/\D/g,'').endsWith(String(number))):null;
    return res.json({text:order?`O pedido ${order.numero} de ${order.clienteNome} está com status “${order.status}”. Valor: ${assistantMoney(order.total)}.${order.observacaoOperador?` Observação da operação: ${order.observacaoOperador}`:''}`:'Não encontrei esse pedido entre os pedidos que seu usuário pode visualizar.'});
  }

  if(/refazer/.test(q)) return res.json({text:`Há ${orders.filter(o=>o.status==='refazer').length} pedido(s) aguardando correção no momento.`});

  if(/quantos? clientes?|minha carteira|clientes cadastrados/.test(q)){
    const approved=customers.filter(c=>c.statusAprovacao==='aprovado').length;
    const pending=customers.filter(c=>c.statusAprovacao==='pendente').length;
    return res.json({text:`Você tem acesso a ${customers.length} cliente(s): ${approved} aprovado(s) e ${pending} aguardando aprovação.`});
  }

  const product=assistantFindProduct(q);
  if(product && /estoque|quanto tem|disponivel|disponível/.test(q)){
    const available=availableForSale(product.id);
    return res.json({text:`${product.nome}: ${available} unidade(s) disponíveis para novas vendas neste momento.`});
  }

  if(/estoque/.test(q)){
    const active=docs('products').filter(p=>p.ativo!==false);
    const zero=active.filter(p=>availableForSale(p.id)<=0);
    const low=active.filter(p=>{const min=Number(p.estoqueMinimo||0),qtd=availableForSale(p.id);return min>0&&qtd>0&&qtd<min;});
    return res.json({text:`Neste momento há ${zero.length} produto(s) sem estoque disponível para venda e ${low.length} abaixo do estoque mínimo. Se quiser, pergunte pelo nome ou código de um produto específico.`});
  }

  if(/clientes? sem compra|clientes? inativos|nao compram|não compram/.test(q)){
    const confirmed=assistantSaleOrders(orders); const ids=new Set(confirmed.map(o=>o.clienteId));
    const inactive=customers.filter(c=>c.statusAprovacao==='aprovado'&&!ids.has(c.id));
    return res.json({text:`Há ${inactive.length} cliente(s) aprovado(s) sem compra confirmada no histórico visível para seu usuário.${inactive.length?` Alguns deles: ${inactive.slice(0,5).map(c=>c.nome||c.nomeFantasia||c.razaoSocial).join(', ')}.`:''}`});
  }

  try {
    const answer=await AionUnified.unifiedFallback({req,message:raw,scope:'sales',history});
    if(answer) return res.json({...answer,text:answer.reply});
  } catch(err){
    console.warn('[AION Vendas] fallback unificado:',err.message);
  }
  const fallback='Posso explicar qualquer função do Life Vendas, analisar sua carteira, pedidos, clientes, estoque e sugerir prioridades de gestão.';
  return res.json({text:fallback,reply:fallback,source:'local-fallback'});
});

module.exports = router;
