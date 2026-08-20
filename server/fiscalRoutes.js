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
function requireManager(req,res){
  if(!req.authUser || req.authUser.perfil!=='Gerente'){res.status(403).json({error:'Acesso negado — devoluções fiscais exigem permissão de gerente.',code:'MANAGER_REQUIRED'});return false;}
  return true;
}

router.get('/invoices',(req,res)=>{
  let rows=Data.all('fiscalInvoices').filter(x=>!(x.tipoDocumento==='devolucao_fornecedor' && x.status==='rascunho'));
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


/* ---------- Devoluções a fornecedor ---------- */
router.get('/returns',(req,res)=>{
  const rows=Data.all('fiscalInvoices').filter(x=>x.tipoDocumento==='devolucao_fornecedor');
  rows.sort((a,b)=>String(b.criadoEm||'').localeCompare(String(a.criadoEm||'')));
  res.json(rows.map(invoicePublic));
});

router.post('/returns/draft',(req,res)=>{
  if(!requireManager(req,res)) return;
  try{
    const b=req.body||{};
    const supplier=Data.get('suppliers',b.supplierId);
    if(!supplier||supplier.ativo===false) return res.status(400).json({error:'Selecione um fornecedor ativo.'});
    const entry=Data.get('entries',b.entryId);
    if(!entry) return res.status(400).json({error:'Selecione a NF de origem da mercadoria.'});
    const supplierDoc=normalizeDigits(supplier.cnpjCpf||supplier.cnpj||supplier.cpf||'');
    const entryDoc=normalizeDigits(entry.cnpjFornecedor||'');
    const supplierName=String(supplier.razaoSocial||supplier.nome||'').trim().toLowerCase();
    const entryName=String(entry.fornecedor||'').trim().toLowerCase();
    const sameSupplier=(entry.fornecedorId&&entry.fornecedorId===supplier.id)||(supplierDoc&&entryDoc&&supplierDoc===entryDoc)||(supplierName&&entryName&&supplierName===entryName);
    if(!sameSupplier) return res.status(400).json({error:'A NF de origem selecionada não pertence ao fornecedor escolhido.'});
    if(!Array.isArray(b.itens)||!b.itens.length) return res.status(400).json({error:'Selecione ao menos uma avaria para devolver.'});

    const itens=[];
    for(const requestItem of b.itens){
      const loss=Data.get('losses',requestItem.lossId);
      if(!loss) return res.status(404).json({error:`Avaria ${requestItem.lossId} não encontrada.`});
      const pending=Math.max(0,Number(loss.quantidade||0)-Number(loss.quantidadeDevolvida||0));
      const qty=Number(requestItem.quantidade||0);
      if(!Number.isFinite(qty)||qty<=0||qty>pending) return res.status(400).json({error:`Quantidade inválida para ${loss.produtoNome}. Pendente: ${pending}.`});
      const originalItem=(entry.itens||[]).find(i=>i.produtoId===loss.produtoId);
      if(!originalItem) return res.status(400).json({error:`O produto ${loss.produtoNome} não consta na NF de origem selecionada.`});
      const product=Data.get('products',loss.produtoId)||{};
      const baseUnitValue=originalItem && Number(originalItem.quantidade||0)>0 && Number(originalItem.valorTotalItem||0)>0
        ? Number(originalItem.valorTotalItem)/Number(originalItem.quantidade)
        : Number(originalItem?.custoUnitario||product.custoAtual||0);
      const fiscal={...(originalItem?.fiscal||{})};
      if(!fiscal.ncm&&product.ncm)fiscal.ncm=product.ncm;if(!fiscal.cest&&product.cest)fiscal.cest=product.cest;
      fiscal.cfopDevolucaoInterna=product.cfopDevolucaoInterna||'';fiscal.cfopDevolucaoInterestadual=product.cfopDevolucaoInterestadual||'';
      itens.push({
        lossId:loss.id,produtoId:loss.produtoId,produtoNome:loss.produtoNome,quantidade:qty,
        motivoAvaria:loss.motivo||'',valorUnitario:baseUnitValue,valorTotal:qty*baseUnitValue,
        fiscal
      });
    }

    const id=uid('dev');
    const ref=`DEV-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${id.slice(-6).toUpperCase()}`;
    const valorTotal=itens.reduce((a,i)=>a+Number(i.valorTotal||0),0);
    const row={
      id,numero:'',serie:'',chaveAcesso:'',status:'rascunho',tipoDocumento:'devolucao_fornecedor',finalidadeEmissao:4,
      referenciaInterna:ref,fornecedorId:supplier.id,fornecedorNome:supplier.razaoSocial||supplier.nome||'',cnpjFornecedor:supplier.cnpjCpf||supplier.cnpj||supplier.cpf||'',clienteNome:supplier.razaoSocial||supplier.nome||'',cnpjCliente:supplier.cnpjCpf||supplier.cnpj||supplier.cpf||'',
      destinatarioNome:supplier.razaoSocial||supplier.nome||'',destinatarioDocumento:supplier.cnpjCpf||supplier.cnpj||supplier.cpf||'',
      entryId:entry.id,nfOrigem:entry.nf||'',serieOrigem:entry.serie||'',chaveNFeOrigem:entry.chaveNFe||'',
      itens,valorTotal,valorProdutos:valorTotal,naturezaOperacao:'Devolução de mercadoria ao fornecedor',observacoes:String(b.observacoes||'').trim(),
      origem:'devolucao_avaria',criadoEm:now(),criadoPor:auditLabel(req),atualizadoEm:now(),atualizadoPor:auditLabel(req),pdfPath:null,xmlPath:null
    };

    for(const it of itens){
      const loss=Data.get('losses',it.lossId);
      loss.quantidadeDevolvida=Number(loss.quantidadeDevolvida||0)+Number(it.quantidade||0);
      loss.devolucoes=(loss.devolucoes||[]).concat({devolucaoId:id,quantidade:it.quantidade,fornecedorId:supplier.id,fornecedorNome:row.fornecedorNome,data:now()});
      Data.upsert('losses',loss.id,loss);
    }
    Data.upsert('fiscalInvoices',id,row);
    saveHistory(req,'devolucao_fornecedor_preparada',`Devolução ${ref} preparada`,`${row.fornecedorNome} · NF origem ${row.nfOrigem||'—'} · ${itens.length} item(ns)`);
    res.status(201).json(invoicePublic(row));
  }catch(e){res.status(500).json({error:'Falha ao preparar devolução: '+e.message});}
});

router.post('/returns/:id/cancel',(req,res)=>{
  if(!requireManager(req,res)) return;
  try{
    const row=Data.get('fiscalInvoices',req.params.id);
    if(!row||row.tipoDocumento!=='devolucao_fornecedor') return res.status(404).json({error:'Devolução não encontrada.'});
    if(row.status!=='rascunho') return res.status(409).json({error:'Somente rascunhos podem ser cancelados por esta ação.'});
    for(const it of row.itens||[]){
      const loss=Data.get('losses',it.lossId); if(!loss) continue;
      loss.quantidadeDevolvida=Math.max(0,Number(loss.quantidadeDevolvida||0)-Number(it.quantidade||0));
      loss.devolucoes=(loss.devolucoes||[]).filter(d=>d.devolucaoId!==row.id);
      Data.upsert('losses',loss.id,loss);
    }
    row.status='cancelada';row.atualizadoEm=now();row.atualizadoPor=auditLabel(req);row.canceladoEm=now();
    Data.upsert('fiscalInvoices',row.id,row);
    saveHistory(req,'devolucao_fornecedor_cancelada',`Devolução ${row.referenciaInterna||row.id} cancelada`,row.fornecedorNome||'');
    res.json(invoicePublic(row));
  }catch(e){res.status(500).json({error:'Falha ao cancelar devolução: '+e.message});}
});

router.post('/returns/:id/authorize',(req,res)=>{
  if(!requireManager(req,res)) return;
  try{
    const row=Data.get('fiscalInvoices',req.params.id);
    if(!row||row.tipoDocumento!=='devolucao_fornecedor') return res.status(404).json({error:'Devolução não encontrada.'});
    if(row.status!=='rascunho') return res.status(409).json({error:'Esta devolução não está mais em rascunho.'});
    const b=req.body||{};
    const numero=String(b.numero||'').trim(); if(!numero) return res.status(400).json({error:'Informe o número da NF-e autorizada.'});
    const chave=normalizeDigits(b.chaveAcesso); if(chave&&chave.length!==44) return res.status(400).json({error:'A chave de acesso deve ter 44 dígitos.'});
    if(chave){const dup=Data.all('fiscalInvoices').find(x=>x.id!==row.id&&normalizeDigits(x.chaveAcesso)===chave);if(dup)return res.status(409).json({error:'Esta chave de acesso já está cadastrada.'});}
    row.numero=numero;row.serie=String(b.serie||'').trim();row.chaveAcesso=chave;row.protocolo=String(b.protocolo||'').trim();
    row.emitidaEm=b.emitidaEm?new Date(b.emitidaEm).toISOString():now();row.status='autorizada';row.ambiente=String(b.ambiente||'producao');
    if(b.pdfBase64)row.pdfPath=saveBinary(row.id,'danfe.pdf',b.pdfBase64);if(b.xmlBase64)row.xmlPath=saveBinary(row.id,'nfe.xml',b.xmlBase64);
    row.atualizadoEm=now();row.atualizadoPor=auditLabel(req);
    Data.upsert('fiscalInvoices',row.id,row);
    saveHistory(req,'nota_fiscal_devolucao_registrada',`NF-e de devolução ${numero} vinculada`,`${row.fornecedorNome} · origem ${row.nfOrigem||'—'}`);
    res.json(invoicePublic(row));
  }catch(e){res.status(500).json({error:'Falha ao vincular NF-e de devolução: '+e.message});}
});

router.get('/capabilities',(req,res)=>{
  const mode=process.env.FISCAL_PROVIDER||'manual';
  const configured=mode==='focusnfe' ? !!process.env.FOCUS_NFE_TOKEN : !!process.env.FISCAL_API_KEY;
  res.json({
    mode,automaticEmissionConfigured:configured,
    message:configured ? 'Emissor fiscal configurado no servidor. Faça a homologação fiscal antes de liberar produção.' : 'Central fiscal e devoluções prontas. Para transmitir NF-e à SEFAZ, configure um provedor fiscal e certificado digital A1.',
    recommendedProvider:'focusnfe',
    returnWorkflow:true
  });
});

module.exports=router;
