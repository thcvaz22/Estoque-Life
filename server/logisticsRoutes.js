/* ============================================================
   LOGISTICSROUTES.JS — Fluxo operacional de romaneio -> saída
   Montar ANTES de commercialRoutes em /api/commercial.
   ============================================================ */
const express = require('express');
const { db, Data } = require('./db');
const svc = require('./services/inventoryService');
const { todayLocalISO, nowUTCISOString } = require('./time');

const router = express.Router();
const STAFF = new Set(['Gerente','Operador']);

function uid(prefix){ return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`; }
function isStaff(req){ return STAFF.has(req.authUser?.perfil); }
function requireStaff(req,res,next){ if(!isStaff(req)) return res.status(403).json({error:'Acesso restrito à equipe operacional.',code:'STAFF_REQUIRED'}); next(); }
function auditLabel(req){ return req.authUser?.auditLabel || `${req.authUser?.nome || 'Usuário'} (${req.authUser?.username || '-'})`; }
function saveHistory(req,tipo,motivo,observacoes=''){
  const row={id:uid('hist'),timestamp:nowUTCISOString(),usuario:auditLabel(req),tipo,motivo,observacoes};
  Data.upsert('history',row.id,row); return row;
}
function getOrder(id){ return Data.get('orders',id); }
function getCustomer(id){ return Data.get('customers',id); }
function getProduct(id){ return Data.get('products',id); }
function vehicles(){ return Data.all('meta').filter(x=>x && x.kind==='vehicle'); }
function normalizePlate(v){ return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').trim(); }
function displayPlate(v){ const p=normalizePlate(v); return p.length===7?`${p.slice(0,3)}-${p.slice(3)}`:String(v||'').toUpperCase().trim(); }
function breakdown(product,totalUnits){
  let rem=Number(totalUnits)||0;
  const upf=Number(product?.unidadesPorFardo||product?.qtdPorEmbalagem||1),fpp=Number(product?.fardosPorPalete||0),pallet=upf*fpp;
  const result={pallets:0,meioPallets:0,fardos:0,unidades:0,nomeFardo:product?.nomeFardo||'Fardo'};
  if(pallet>0){result.pallets=Math.floor(rem/pallet);rem-=result.pallets*pallet;const half=pallet/2;if(Number.isInteger(half)&&half>0&&rem>=half){result.meioPallets=1;rem-=half;}}
  if(upf>0){result.fardos=Math.floor(rem/upf);rem-=result.fardos*upf;}result.unidades=rem;return result;
}
function manifestTotals(orders){
  const grouped={};
  for(const o of orders)for(const it of(o.itens||[])){if(!grouped[it.produtoId])grouped[it.produtoId]={produtoId:it.produtoId,produtoNome:it.produtoNome,codigoInterno:it.codigoInterno,quantidadeUnidades:0};grouped[it.produtoId].quantidadeUnidades+=Number(it.quantidadeUnidades||0);}
  return Object.values(grouped).map(g=>({...g,conversao:breakdown(getProduct(g.produtoId),g.quantidadeUnidades)}));
}
function manifestOrders(orders){return orders.map(o=>({pedidoId:o.id,numero:o.numero,cliente:o.clienteNome,nfNumero:o.nfNumero||o.numero,itens:o.itens}));}
function manifestNfs(orders){return orders.map(o=>({numero:o.nfNumero||o.numero,cliente:o.clienteNome,itens:(o.itens||[]).map(i=>({produtoId:i.produtoId,quantidade:i.quantidadeUnidades,unidadeMovimentacao:'Unidade'}))}));}

router.get('/vehicles',requireStaff,(req,res)=>res.json(vehicles().sort((a,b)=>String(a.placa||'').localeCompare(String(b.placa||''),'pt-BR'))));
router.post('/vehicles',requireStaff,(req,res)=>{
  const b=req.body||{},placa=displayPlate(b.placa),veiculo=String(b.veiculo||b.modelo||'').trim();
  if(!placa)return res.status(400).json({error:'Informe a placa do veículo.'});if(!veiculo)return res.status(400).json({error:'Informe o veículo/modelo.'});
  const key=normalizePlate(placa);if(vehicles().some(v=>v.ativo!==false&&normalizePlate(v.placa)===key))return res.status(409).json({error:'Já existe um veículo ativo com esta placa.'});
  const id=uid('vehicle'),row={id,kind:'vehicle',placa,veiculo,modelo:String(b.modelo||veiculo).trim(),tipo:String(b.tipo||'').trim(),capacidadeKg:Number(b.capacidadeKg||0)||null,capacidadeObservacao:String(b.capacidadeObservacao||'').trim(),observacoes:String(b.observacoes||'').trim(),ativo:true,criadoEm:nowUTCISOString(),criadoPor:auditLabel(req)};
  Data.upsert('meta',id,row);saveHistory(req,'veiculo_cadastrado',`Veículo ${row.veiculo} · ${row.placa} cadastrado`);res.status(201).json(row);
});
router.put('/vehicles/:id',requireStaff,(req,res)=>{
  const row=Data.get('meta',req.params.id);if(!row||row.kind!=='vehicle')return res.status(404).json({error:'Veículo não encontrado.'});
  const b=req.body||{},placa=displayPlate(b.placa??row.placa),veiculo=String(b.veiculo??b.modelo??row.veiculo??'').trim();if(!placa||!veiculo)return res.status(400).json({error:'Informe veículo e placa.'});
  const key=normalizePlate(placa);if(vehicles().some(v=>v.id!==row.id&&v.ativo!==false&&normalizePlate(v.placa)===key))return res.status(409).json({error:'Já existe outro veículo ativo com esta placa.'});
  Object.assign(row,{placa,veiculo,modelo:String(b.modelo??row.modelo??veiculo).trim(),tipo:String(b.tipo??row.tipo??'').trim(),capacidadeKg:b.capacidadeKg===undefined?row.capacidadeKg:(Number(b.capacidadeKg||0)||null),capacidadeObservacao:String(b.capacidadeObservacao??row.capacidadeObservacao??'').trim(),observacoes:String(b.observacoes??row.observacoes??'').trim(),ativo:b.ativo===undefined?row.ativo!==false:!!b.ativo,alteradoEm:nowUTCISOString(),alteradoPor:auditLabel(req)});
  Data.upsert('meta',row.id,row);saveHistory(req,'veiculo_alterado',`Veículo ${row.veiculo} · ${row.placa} atualizado`);res.json(row);
});
router.delete('/vehicles/:id',requireStaff,(req,res)=>{
  const row=Data.get('meta',req.params.id);if(!row||row.kind!=='vehicle')return res.status(404).json({error:'Veículo não encontrado.'});row.ativo=false;row.inativadoEm=nowUTCISOString();row.inativadoPor=auditLabel(req);Data.upsert('meta',row.id,row);saveHistory(req,'veiculo_inativado',`Veículo ${row.veiculo} · ${row.placa} inativado`);res.json(row);
});

router.post('/orders/:id/approve',requireStaff,(req,res)=>{
  try{const o=getOrder(req.params.id);if(!o)return res.status(404).json({error:'Pedido não encontrado.'});if(o.status!=='enviado')return res.status(409).json({error:'Somente pedidos enviados podem ser aprovados.'});
    const active=Number(db.prepare("SELECT COUNT(*) AS q FROM stock_reservations WHERE orderId=? AND status='active'").get(o.id)?.q||0);if(!active)return res.status(409).json({error:'O pedido não possui reserva ativa de estoque. Reabra/edite o pedido para validar o estoque antes de aprovar.'});
    o.status='aprovado';o.statusAprovacao='aprovado';o.aprovadoPor=auditLabel(req);o.aprovadoEm=nowUTCISOString();o.exitId=null;o.manifestId=null;o.historicoStatus=(o.historicoStatus||[]).concat({status:'aprovado',data:nowUTCISOString(),por:auditLabel(req),observacao:'Estoque reservado. A baixa física ocorrerá ao gerar o romaneio com os dados da saída.'});Data.upsert('orders',o.id,o);saveHistory(req,'pedido_aprovado',`Pedido ${o.numero} aprovado`,'Estoque reservado · aguardando romaneio e dados logísticos para criação da saída');res.json({order:o,exit:null,manifest:null,stockMovementDeferred:true});
  }catch(e){res.status(e.status||500).json({error:e.message});}
});

router.get('/separation/available',requireStaff,(req,res)=>{
  const rows=Data.all('orders').filter(o=>o.status==='aprovado'&&!o.manifestId).map(o=>{const c=getCustomer(o.clienteId)||{},legacyExit=o.exitId?Data.get('exits',o.exitId):null;return {...o,legacyExit:!!legacyExit,separationMeta:{nfNumero:o.nfNumero||o.numero,cliente:o.clienteNome||c.nome||'',fornecedor:o.fornecedorNome||c.fornecedor||'',cidade:c.cidade||'',bairro:c.bairro||'',regiao:c.regiao||'',vendedor:o.vendedorNome||c.vendedorNome||''}};});res.json(rows);
});

router.post('/separation/manifests',requireStaff,(req,res)=>{
  try{const b=req.body||{},ids=Array.isArray(b.orderIds)?[...new Set(b.orderIds.map(String))]:[];if(!ids.length)return res.status(400).json({error:'Selecione ao menos um pedido aprovado.'});const orders=ids.map(getOrder);if(orders.some(o=>!o||o.status!=='aprovado'||o.manifestId))return res.status(409).json({error:'Há pedido inválido, não aprovado ou já incluído em romaneio.'});
    let vehicle=null;if(b.vehicleId){vehicle=Data.get('meta',b.vehicleId);if(!vehicle||vehicle.kind!=='vehicle'||vehicle.ativo===false)return res.status(400).json({error:'Selecione um veículo ativo cadastrado.'});}
    const motorista=String(b.motorista||'').trim(),veiculo=String(vehicle?.veiculo||b.veiculo||'').trim(),placa=displayPlate(vehicle?.placa||b.placa||'');if(!motorista)return res.status(400).json({error:'Informe o motorista antes de gerar o romaneio.'});if(!veiculo)return res.status(400).json({error:'Selecione ou informe o veículo antes de gerar o romaneio.'});if(!placa)return res.status(400).json({error:'Informe a placa do veículo antes de gerar o romaneio.'});
    const legacyExits=orders.map(o=>o.exitId?Data.get('exits',o.exitId):null),legacyCount=legacyExits.filter(Boolean).length;if(legacyCount>0&&legacyCount!==orders.length)return res.status(409).json({error:'Há mistura de pedidos do fluxo antigo e novo. Gere romaneios separados para evitar baixa duplicada de estoque.'});
    const id=uid('manifest'),numero=`ROM${Date.now().toString().slice(-7)}`,totals=manifestTotals(orders),row={id,numero,data:todayLocalISO(),orderIds:ids,pedidos:manifestOrders(orders),totais:totals,status:'aberto',motorista,vehicleId:vehicle?.id||null,veiculo,placa,ajudante:String(b.ajudante||'').trim(),observacoes:String(b.observacoes||'').trim(),horarioSaida:b.horarioSaida||nowUTCISOString(),criadoEm:nowUTCISOString(),criadoPor:auditLabel(req),exitId:null,exitIds:[]};
    const run=db.transaction(()=>{if(legacyCount===orders.length){for(const exit of legacyExits){exit.motorista=motorista;exit.veiculo=veiculo;exit.placa=placa;exit.status='separacao';exit.origemRomaneio=true;exit.romaneioNumero=numero;exit.ajudante=row.ajudante;exit.observacoesSaida=row.observacoes;exit.horarioSaida=row.horarioSaida;exit.atualizadoEm=nowUTCISOString();Data.upsert('exits',exit.id,exit);row.exitIds.push(exit.id);}row.exitId=row.exitIds.length===1?row.exitIds[0]:null;}else{
      const placeholders=ids.map(()=>'?').join(',');db.prepare(`UPDATE stock_reservations SET status='manifest_processing', updatedAt=? WHERE orderId IN (${placeholders}) AND status='active'`).run(nowUTCISOString(),...ids);
      const exit=svc.createExit({operationId:`manifest_exit_${id}`,motorista,veiculo,placa,cliente:orders.map(o=>o.clienteNome).filter(Boolean).join(', '),horarioSaida:row.horarioSaida,status:'separacao',nfs:manifestNfs(orders),origemRomaneio:true,romaneioNumero:numero,usuario:auditLabel(req)});
      db.prepare(`UPDATE stock_reservations SET status='consumed', updatedAt=? WHERE orderId IN (${placeholders}) AND status='manifest_processing'`).run(nowUTCISOString(),...ids);row.exitId=exit.id;row.exitIds=[exit.id];}
      Data.upsert('shippingManifests',id,row);for(const o of orders){o.manifestId=id;o.status='separacao';if(!o.exitId&&row.exitIds.length===1)o.exitId=row.exitIds[0];o.historicoStatus=(o.historicoStatus||[]).concat({status:'separacao',data:nowUTCISOString(),por:auditLabel(req),observacao:`Romaneio ${numero} · ${motorista} · ${veiculo} ${placa}`});Data.upsert('orders',o.id,o);}return row;});
    const saved=run();saveHistory(req,'romaneio_gerado',`Romaneio ${saved.numero} gerado e saída criada`,`${orders.length} pedido(s) · ${totals.reduce((a,x)=>a+x.quantidadeUnidades,0)} unidades · ${motorista} · ${veiculo} ${placa} · Saída(s): ${saved.exitIds.join(', ')}`);res.status(201).json(saved);
  }catch(e){res.status(e.status||500).json({error:e.message});}
});

module.exports=router;
