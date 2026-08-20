/* ============================================================
   FISCAL ROUTES — central de Notas Fiscais

   Esta camada guarda e consulta NF-e já emitidas/autorizadas.
   Ela NÃO simula autorização SEFAZ. Quando um emissor fiscal
   for integrado, o mesmo cadastro poderá ser preenchido de forma
   automática com XML autorizado e DANFE/PDF retornados pelo provedor.
   ============================================================ */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Data, DATA_DIR } = require('./db');

const router = express.Router();
const FISCAL_DIR = path.join(DATA_DIR,'fiscal');
if(!fs.existsSync(FISCAL_DIR)) fs.mkdirSync(FISCAL_DIR,{recursive:true});

function uid(prefix){ return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`; }
function auditLabel(req){ return req.authUser?.auditLabel || `${req.authUser?.nome||'Usuário'} (${req.authUser?.username||'-'})`; }
function now(){ return new Date().toISOString(); }
function normalizeDigits(v){ return String(v||'').replace(/\D/g,''); }
function safeBase64(v){
  const s=String(v||'');
  const i=s.indexOf('base64,');
  return i>=0?s.slice(i+7):s;
}
function saveBinary(invoiceId, filename, b64){
  if(!b64) return null;
  const dir=path.join(FISCAL_DIR,invoiceId); fs.mkdirSync(dir,{recursive:true});
  const fp=path.join(dir,filename);
  fs.writeFileSync(fp,Buffer.from(safeBase64(b64),'base64'));
  return fp;
}
function resolveFiscalPath(row, kind){
  if(!row) return null;
  const current = kind === 'pdf' ? row.pdfPath : row.xmlPath;
  if(current && fs.existsSync(current)) return current;
  const filename = kind === 'pdf' ? 'danfe.pdf' : 'nfe.xml';
  const fallback = path.join(FISCAL_DIR, row.id, filename);
  return fs.existsSync(fallback) ? fallback : null;
}
function invoicePublic(row){
  if(!row) return null;
  const { pdfPath, xmlPath, ...publicRow } = row;
  return {...publicRow, hasPdf:!!resolveFiscalPath(row,'pdf'), hasXml:!!resolveFiscalPath(row,'xml')};
}
function saveHistory(req,tipo,motivo,observacoes=''){
  const row={id:uid('hist'),timestamp:now(),usuario:auditLabel(req),tipo,motivo,observacoes};
  Data.upsert('history',row.id,row);
}
function findOrder(orderId){ return orderId ? Data.get('orders',orderId) : null; }

router.get('/invoices',(req,res)=>{
  let rows=Data.all('fiscalInvoices');
  const q=String(req.query.q||'').trim().toLowerCase();
  const numero=String(req.query.numero||'').trim().toLowerCase();
  const cliente=String(req.query.cliente||'').trim().toLowerCase();
  const status=String(req.query.status||'').trim().toLowerCase();
  const from=String(req.query.from||'').slice(0,10);
  const to=String(req.query.to||'').slice(0,10);
  if(numero) rows=rows.filter(x=>String(x.numero||'').toLowerCase().includes(numero)||String(x.chaveAcesso||'').includes(numero));
  if(cliente) rows=rows.filter(x=>String(x.clienteNome||'').toLowerCase().includes(cliente));
  if(status) rows=rows.filter(x=>String(x.status||'').toLowerCase()===status);
  if(from) rows=rows.filter(x=>String(x.emitidaEm||x.criadoEm||'').slice(0,10)>=from);
  if(to) rows=rows.filter(x=>String(x.emitidaEm||x.criadoEm||'').slice(0,10)<=to);
  if(q) rows=rows.filter(x=>[x.numero,x.serie,x.chaveAcesso,x.clienteNome,x.cnpjCliente,x.pedidoNumero,x.status].some(v=>String(v||'').toLowerCase().includes(q)));
  rows.sort((a,b)=>String(b.emitidaEm||b.criadoEm||'').localeCompare(String(a.emitidaEm||a.criadoEm||'')));
  res.json(rows.map(invoicePublic));
});

router.get('/invoices/:id',(req,res)=>{
  const row=Data.get('fiscalInvoices',req.params.id);
  if(!row) return res.status(404).json({error:'Nota fiscal não encontrada.'});
  res.json(invoicePublic(row));
});

router.post('/invoices/import',(req,res)=>{
  try{
    const b=req.body||{};
    const numero=String(b.numero||'').trim();
    if(!numero) return res.status(400).json({error:'Informe o número da NF-e.'});
    const chaveAcesso=normalizeDigits(b.chaveAcesso);
    if(chaveAcesso && chaveAcesso.length!==44) return res.status(400).json({error:'A chave de acesso da NF-e deve ter 44 dígitos.'});
    if(chaveAcesso){
      const dup=Data.all('fiscalInvoices').find(x=>normalizeDigits(x.chaveAcesso)===chaveAcesso);
      if(dup) return res.status(409).json({error:'Esta chave de acesso já está cadastrada.',invoiceId:dup.id});
    }
    const order=findOrder(b.orderId);
    const id=uid('nfe');
    const emitidaEm=b.emitidaEm?new Date(b.emitidaEm).toISOString():now();
    const row={
      id,
      numero,
      serie:String(b.serie||'').trim(),
      chaveAcesso,
      status:String(b.status||'autorizada').trim().toLowerCase(),
      emitidaEm,
      valorTotal:Number(b.valorTotal ?? order?.total ?? 0),
      clienteId:b.clienteId||order?.clienteId||null,
      clienteNome:String(b.clienteNome||order?.clienteNome||'').trim(),
      cnpjCliente:String(b.cnpjCliente||'').trim(),
      pedidoId:order?.id||b.orderId||null,
      pedidoNumero:order?.numero||String(b.pedidoNumero||'').trim(),
      protocolo:String(b.protocolo||'').trim(),
      ambiente:String(b.ambiente||'producao').trim().toLowerCase(),
      naturezaOperacao:String(b.naturezaOperacao||'').trim(),
      observacoes:String(b.observacoes||'').trim(),
      origem:String(b.origem||'registro_manual'),
      criadoEm:now(),
      criadoPor:auditLabel(req),
      atualizadoEm:now(),
      atualizadoPor:auditLabel(req),
      pdfPath:null,
      xmlPath:null
    };
    if(b.pdfBase64) row.pdfPath=saveBinary(id,'danfe.pdf',b.pdfBase64);
    if(b.xmlBase64) row.xmlPath=saveBinary(id,'nfe.xml',b.xmlBase64);
    Data.upsert('fiscalInvoices',id,row);
    if(order){
      order.nfNumero=numero;
      order.nfSerie=row.serie;
      order.nfChave=chaveAcesso;
      order.nfStatus=row.status;
      order.fiscalInvoiceId=id;
      if(['autorizada','emitida'].includes(row.status) && ['aprovado','separacao'].includes(order.status)) order.status='faturado';
      order.historicoStatus=(order.historicoStatus||[]).concat({status:'nf_registrada',data:now(),por:auditLabel(req),observacao:`NF ${numero} vinculada`});
      Data.upsert('orders',order.id,order);
    }
    saveHistory(req,'nota_fiscal_registrada',`NF-e ${numero} registrada`,`${row.clienteNome||'Cliente não informado'} · ${row.status}`);
    res.status(201).json(invoicePublic(row));
  }catch(e){res.status(500).json({error:'Falha ao registrar NF-e: '+e.message});}
});

router.put('/invoices/:id',(req,res)=>{
  const row=Data.get('fiscalInvoices',req.params.id);
  if(!row) return res.status(404).json({error:'Nota fiscal não encontrada.'});
  const b=req.body||{};
  if(b.status!==undefined) row.status=String(b.status||row.status).toLowerCase();
  if(b.observacoes!==undefined) row.observacoes=String(b.observacoes||'');
  if(b.pdfBase64) row.pdfPath=saveBinary(row.id,'danfe.pdf',b.pdfBase64);
  if(b.xmlBase64) row.xmlPath=saveBinary(row.id,'nfe.xml',b.xmlBase64);
  row.atualizadoEm=now(); row.atualizadoPor=auditLabel(req);
  Data.upsert('fiscalInvoices',row.id,row);
  saveHistory(req,'nota_fiscal_atualizada',`NF-e ${row.numero} atualizada`,row.status);
  res.json(invoicePublic(row));
});

router.get('/invoices/:id/pdf',(req,res)=>{
  const row=Data.get('fiscalInvoices',req.params.id);
  if(!row) return res.status(404).json({error:'Nota fiscal não encontrada.'});
  const pdfPath=resolveFiscalPath(row,'pdf');
  if(!pdfPath) return res.status(404).json({error:'Esta NF-e ainda não possui DANFE/PDF armazenado para segunda via.'});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`inline; filename="NF-${String(row.numero).replace(/[^\w.-]/g,'_')}.pdf"`);
  fs.createReadStream(pdfPath).pipe(res);
});

router.get('/invoices/:id/xml',(req,res)=>{
  const row=Data.get('fiscalInvoices',req.params.id);
  if(!row) return res.status(404).json({error:'Nota fiscal não encontrada.'});
  const xmlPath=resolveFiscalPath(row,'xml');
  if(!xmlPath) return res.status(404).json({error:'Esta NF-e não possui XML autorizado armazenado.'});
  res.setHeader('Content-Type','application/xml; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="NF-${String(row.numero).replace(/[^\w.-]/g,'_')}.xml"`);
  fs.createReadStream(xmlPath).pipe(res);
});

router.get('/orders-ready',(req,res)=>{
  const rows=Data.all('orders').filter(o=>!o.fiscalInvoiceId && ['aprovado','faturado','separacao'].includes(o.status));
  rows.sort((a,b)=>String(b.aprovadoEm||b.criadoEm||'').localeCompare(String(a.aprovadoEm||a.criadoEm||'')));
  res.json(rows);
});

router.get('/capabilities',(req,res)=>{
  res.json({
    mode:process.env.FISCAL_PROVIDER||'manual',
    automaticEmissionConfigured:!!process.env.FISCAL_API_KEY,
    message:process.env.FISCAL_API_KEY ? 'Integração fiscal configurada.' : 'Central pronta para armazenar NF-e emitidas. Emissão automática requer provedor fiscal/certificado.'
  });
});

module.exports=router;
