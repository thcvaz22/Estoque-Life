/* ============================================================
   VIEWS/RETURNS.JS — Devoluções a fornecedor
   Avaria já baixou o estoque. Esta tela controla a devolução física
   e prepara a NF-e de devolução sem realizar uma segunda baixa.
   ============================================================ */

async function returnFiscalFetch(path,{method='GET',body}={}){
  let r;try{r=await fetch('/api/fiscal'+path,{method,headers:body!==undefined?{'Content-Type':'application/json'}:undefined,body:body!==undefined?JSON.stringify(body):undefined,cache:'no-store'});}catch{throw new Error('Servidor indisponível.');}
  let d=null;try{d=await r.json()}catch{}
  if(r.status===401){Auth.handleUnauthorized();throw new Error('Sessão expirada.');}
  if(!r.ok)throw new Error(d?.error||`Erro ${r.status}`);return d;
}
function returnStatusKind(s){return ['autorizada','emitida'].includes(String(s||'').toLowerCase())?'ok':String(s||'').toLowerCase()==='cancelada'?'danger':'warn';}

async function renderReturns(root){
  const [returns,losses,cap]=await Promise.all([returnFiscalFetch('/returns'),DB.all('losses'),returnFiscalFetch('/capabilities')]);
  const canManage=typeof Auth!=='undefined' && Auth.isManager && Auth.isManager();
  const pendingLosses=losses.filter(l=>Number(l.quantidade||0)-Number(l.quantidadeDevolvida||0)>0);
  root.innerHTML=`
    <div class="dashboard-welcome">
      <div><span class="dashboard-welcome__eyebrow">Avarias · Fornecedor · Fiscal</span><h1>Devoluções</h1><p>Controle o que saiu por avaria, prepare a devolução ao fornecedor e acompanhe a NF-e correspondente.</p></div>
      ${canManage?`<button class="btn btn--primary" id="return-new" ${pendingLosses.length?'':'disabled'}>+ Nova devolução</button>`:''}
    </div>
    <div class="notice-aion" style="margin-bottom:14px"><strong>Emissão fiscal:</strong> ${escapeHTML(cap.message||'')} ${cap.automaticEmissionConfigured?'':'· A devolução pode ser preparada agora e a NF-e autorizada será vinculada depois.'}</div>
    <div class="grid grid--stats" style="margin-bottom:14px">
      ${statCard('Avarias pendentes',pendingLosses.length,'orange')}
      ${statCard('Devoluções preparadas',returns.filter(r=>r.status==='rascunho').length,'navy')}
      ${statCard('NF-e autorizadas',returns.filter(r=>['autorizada','emitida'].includes(r.status)).length,'green')}
    </div>
    <div class="card table-wrap"><table class="data"><thead><tr><th>Referência</th><th>Fornecedor</th><th>NF origem</th><th>Itens</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>
      ${returns.length?returns.map(r=>`<tr><td><strong>${escapeHTML(r.referenciaInterna||r.numero||r.id)}</strong><br><span class="hint">${fmtDateTime(r.criadoEm)}</span></td><td>${escapeHTML(r.fornecedorNome||'—')}</td><td>${escapeHTML(r.nfOrigem||'—')}</td><td>${(r.itens||[]).length}</td><td>${money(r.valorTotal||0)}</td><td>${statusStamp(r.status||'rascunho',returnStatusKind(r.status))}</td><td><div class="row-actions"><button class="btn btn--ghost btn--sm" data-ret-view="${r.id}">Detalhes</button>${canManage&&r.status==='rascunho'?`<button class="btn btn--primary btn--sm" data-ret-fiscal="${r.id}">Registrar NF-e</button><button class="btn btn--danger btn--sm" data-ret-cancel="${r.id}">Cancelar rascunho</button>`:''}</div></td></tr>`).join(''):`<tr><td colspan="7"><div class="empty-state"><p>Nenhuma devolução registrada.</p></div></td></tr>`}
    </tbody></table></div>`;
  const newBtn=document.getElementById('return-new'); if(newBtn)newBtn.onclick=()=>openReturnForm();
  document.querySelectorAll('[data-ret-view]').forEach(b=>b.onclick=()=>openReturnDetails(returns.find(r=>r.id===b.dataset.retView)));
  document.querySelectorAll('[data-ret-fiscal]').forEach(b=>b.onclick=()=>openReturnFiscalRegistration(returns.find(r=>r.id===b.dataset.retFiscal)));
  document.querySelectorAll('[data-ret-cancel]').forEach(b=>b.onclick=async()=>{if(!await confirmDialog('Cancelar este rascunho de devolução? As avarias voltarão a ficar disponíveis para outra devolução.'))return;try{await returnFiscalFetch(`/returns/${encodeURIComponent(b.dataset.retCancel)}/cancel`,{method:'POST'});toast('Rascunho cancelado.','success');navigate('returns');}catch(e){toast(e.message,'error');}});
}

async function openReturnForm(){
  const [suppliers,entries,losses]=await Promise.all([DB.all('suppliers'),DB.all('entries'),DB.all('losses')]);
  const activeSuppliers=suppliers.filter(s=>s.ativo!==false);
  const eligible=losses.filter(l=>Number(l.quantidade||0)-Number(l.quantidadeDevolvida||0)>0);
  if(!eligible.length){toast('Não há avarias pendentes para devolução.','warn');return;}
  openModal('Nova devolução ao fornecedor',`
    <p class="hint">A avaria já foi baixada do estoque. Esta operação apenas registra o envio ao fornecedor e prepara a NF-e de devolução.</p>
    <div class="form-grid">
      <div class="field field--full"><label>Fornecedor *</label><select class="input" id="ret-supplier"><option value="">Selecione…</option>${activeSuppliers.map(s=>`<option value="${s.id}">${escapeHTML(s.razaoSocial||s.nome)}</option>`).join('')}</select></div>
      <div class="field field--full"><label>NF de origem *</label><select class="input" id="ret-entry"><option value="">Selecione a nota recebida…</option>${entries.slice().sort((a,b)=>String(b.data||'').localeCompare(String(a.data||''))).map(e=>`<option value="${e.id}">${escapeHTML(e.nf||'Sem NF')} · ${escapeHTML(e.fornecedor||'—')} · ${fmtDate(e.data)}</option>`).join('')}</select></div>
      <div class="field field--full"><label>Observações / motivo geral</label><textarea class="input" id="ret-note" rows="3" placeholder="Ex.: embalagens avariadas identificadas na conferência"></textarea></div>
    </div>
    <div class="section-title">Avarias para devolver</div>
    <div class="table-wrap"><table class="data"><thead><tr><th></th><th>Data</th><th>Produto</th><th>Motivo</th><th>Pendente</th><th>Qtd. devolver</th></tr></thead><tbody>${eligible.map(l=>{const pending=Number(l.quantidade||0)-Number(l.quantidadeDevolvida||0);return`<tr><td><input type="checkbox" data-ret-check="${l.id}"></td><td>${fmtDate(l.data)}</td><td>${escapeHTML(l.produtoNome)}</td><td>${escapeHTML(l.motivo||'—')}</td><td>${fmtNumber(pending)}</td><td><input class="input" style="max-width:100px" type="number" min="0" max="${pending}" value="${pending}" data-ret-qty="${l.id}"></td></tr>`}).join('')}</tbody></table></div>
    <div class="form-actions"><button class="btn btn--ghost" id="ret-cancel">Cancelar</button><button class="btn btn--primary" id="ret-save">Preparar devolução</button></div>
  `,{wide:true});
  document.getElementById('ret-cancel').onclick=closeModal;
  const supplierSel=document.getElementById('ret-supplier');
  supplierSel.onchange=()=>{
    const s=activeSuppliers.find(x=>x.id===supplierSel.value);if(!s)return;
    const match=entries.find(e=>e.fornecedorId===s.id)||entries.find(e=>String(e.fornecedor||'').toLowerCase()===String(s.razaoSocial||s.nome||'').toLowerCase());
    if(match)document.getElementById('ret-entry').value=match.id;
  };
  document.getElementById('ret-save').onclick=async()=>{
    const supplierId=supplierSel.value;const entryId=document.getElementById('ret-entry').value;
    if(!supplierId||!entryId){toast('Selecione fornecedor e NF de origem.','warn');return;}
    const itens=[];document.querySelectorAll('[data-ret-check]:checked').forEach(c=>{const q=Number(document.querySelector(`[data-ret-qty="${c.dataset.retCheck}"]`)?.value||0);if(q>0)itens.push({lossId:c.dataset.retCheck,quantidade:q});});
    if(!itens.length){toast('Selecione ao menos uma avaria.','warn');return;}
    try{await returnFiscalFetch('/returns/draft',{method:'POST',body:{supplierId,entryId,itens,observacoes:document.getElementById('ret-note').value.trim()}});toast('Devolução preparada.','success');closeModal();navigate('returns');}catch(e){toast(e.message,'error');}
  };
}

function openReturnDetails(r){
  openModal('Devolução ao fornecedor',`
    <div class="grid grid--2"><div><span class="hint">Fornecedor</span><strong>${escapeHTML(r.fornecedorNome||'—')}</strong></div><div><span class="hint">NF origem</span><strong>${escapeHTML(r.nfOrigem||'—')}</strong></div><div><span class="hint">Status</span><div>${statusStamp(r.status||'rascunho',returnStatusKind(r.status))}</div></div><div><span class="hint">Valor</span><strong>${money(r.valorTotal||0)}</strong></div></div>
    <div class="section-title">Itens</div><div class="table-wrap"><table class="data"><thead><tr><th>Produto</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th></tr></thead><tbody>${(r.itens||[]).map(i=>`<tr><td>${escapeHTML(i.produtoNome)}</td><td>${fmtNumber(i.quantidade)}</td><td>${money(i.valorUnitario||0)}</td><td>${money(i.valorTotal||0)}</td></tr>`).join('')}</tbody></table></div>
    ${r.chaveNFeOrigem?`<p class="hint cell-mono">Chave NF origem: ${escapeHTML(r.chaveNFeOrigem)}</p>`:''}
    ${r.observacoes?`<p><strong>Observações:</strong> ${escapeHTML(r.observacoes)}</p>`:''}
  `,{wide:true});
}

function openReturnFiscalRegistration(r){
  openModal('Registrar NF-e de devolução autorizada',`
    <p class="hint">Use depois que a NF-e de devolução for autorizada pelo emissor fiscal. O sistema manterá o vínculo com as avarias e com a nota original.</p>
    <div class="form-grid">
      <div class="field"><label>Número NF-e *</label><input class="input" id="rf-num"></div>
      <div class="field"><label>Série</label><input class="input" id="rf-serie"></div>
      <div class="field field--full"><label>Chave de acesso</label><input class="input cell-mono" id="rf-chave" maxlength="60"></div>
      <div class="field"><label>Protocolo</label><input class="input" id="rf-prot"></div>
      <div class="field"><label>Data/hora emissão</label><input class="input" type="datetime-local" id="rf-date" value="${nowLocalDatetimeInput()}"></div>
      <div class="field"><label>DANFE / PDF</label><input class="input" type="file" id="rf-pdf" accept="application/pdf,.pdf"></div>
      <div class="field"><label>XML autorizado</label><input class="input" type="file" id="rf-xml" accept="application/xml,text/xml,.xml"></div>
    </div>
    <div class="form-actions"><button class="btn btn--ghost" id="rf-cancel">Cancelar</button><button class="btn btn--primary" id="rf-save">Vincular NF-e</button></div>
  `,{wide:true});
  document.getElementById('rf-cancel').onclick=closeModal;
  document.getElementById('rf-save').onclick=async()=>{
    const number=document.getElementById('rf-num').value.trim();if(!number){toast('Informe o número da NF-e.','warn');return;}
    const pdf=document.getElementById('rf-pdf').files[0],xml=document.getElementById('rf-xml').files[0];
    const body={numero:number,serie:document.getElementById('rf-serie').value.trim(),chaveAcesso:document.getElementById('rf-chave').value.trim(),protocolo:document.getElementById('rf-prot').value.trim(),emitidaEm:document.getElementById('rf-date').value,status:'autorizada'};
    if(pdf)body.pdfBase64=await fileToDataUrl(pdf);if(xml)body.xmlBase64=await fileToDataUrl(xml);
    try{await returnFiscalFetch(`/returns/${encodeURIComponent(r.id)}/authorize`,{method:'POST',body});toast('NF-e de devolução vinculada.','success');closeModal();navigate('returns');}catch(e){toast(e.message,'error');}
  };
}
