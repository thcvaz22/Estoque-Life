/* ============================================================
   VIEWS/INVOICES.JS — Central de Notas Fiscais
   Consulta NF-e emitidas, filtros, visualização e segunda via.
   A emissão fiscal automática fica preparada para integração
   com provedor; a tela também aceita registrar NF-e já emitida.
   ============================================================ */

async function fiscalFetch(path,{method='GET',body}={}){
  let r;
  try{
    r=await fetch('/api/fiscal'+path,{method,headers:body!==undefined?{'Content-Type':'application/json'}:undefined,body:body!==undefined?JSON.stringify(body):undefined,cache:'no-store'});
  }catch{ throw new Error('Servidor indisponível.'); }
  let d=null;try{d=await r.json()}catch{}
  if(r.status===401){Auth.handleUnauthorized();throw new Error('Sessão expirada.');}
  if(!r.ok) throw new Error(d?.error||`Erro ${r.status}`);
  return d;
}
function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{const rd=new FileReader();rd.onload=()=>resolve(rd.result);rd.onerror=()=>reject(rd.error);rd.readAsDataURL(file);});
}
function fiscalStatusKind(status){return ['autorizada','emitida'].includes(String(status||'').toLowerCase())?'ok':String(status||'').toLowerCase()==='cancelada'?'danger':'warn'}

async function renderInvoices(root){
  const [invoices,capabilities]=await Promise.all([fiscalFetch('/invoices'),fiscalFetch('/capabilities')]);
  let rows=invoices.slice();
  root.innerHTML=`
    <div class="dashboard-welcome">
      <div>
        <span class="dashboard-welcome__eyebrow">Fiscal · Central de documentos</span>
        <h1>Notas Fiscais</h1>
        <p>Consulte NF-e emitidas, visualize documentos armazenados e gere segunda via do DANFE/PDF.</p>
      </div>
      <button class="btn btn--primary" id="invoice-add">+ Registrar NF-e emitida</button>
    </div>
    <div class="notice-aion" style="margin-bottom:14px">
      <strong>Modo fiscal:</strong> ${escapeHTML(capabilities.mode||'manual')} · ${escapeHTML(capabilities.message||'')}
    </div>
    <div class="filters card" style="padding:14px">
      <div class="field"><label>Nº NF / Chave</label><input class="input" id="nf-number" placeholder="Ex.: 12345"></div>
      <div class="field"><label>Cliente</label><input class="input" id="nf-client" placeholder="Nome do cliente"></div>
      <div class="field"><label>Status</label><select class="input" id="nf-status"><option value="">Todos</option><option value="autorizada">Autorizada</option><option value="emitida">Emitida</option><option value="pendente">Pendente</option><option value="cancelada">Cancelada</option></select></div>
      <div class="field"><label>De</label><input class="input" type="date" id="nf-from"></div>
      <div class="field"><label>Até</label><input class="input" type="date" id="nf-to"></div>
      <div class="field"><label>Busca geral</label><input class="input" id="nf-q" placeholder="Pedido, CNPJ, série..."></div>
      <button class="btn btn--ghost" id="nf-clear">Limpar filtros</button>
    </div>
    <div class="card table-wrap">
      <table class="data">
        <thead><tr><th>NF-e</th><th>Emissão</th><th>Cliente</th><th>Pedido</th><th>Valor</th><th>Status</th><th>Arquivos</th><th></th></tr></thead>
        <tbody id="nf-tbody"></tbody>
      </table>
    </div>`;

  function draw(){
    const n=document.getElementById('nf-number').value.trim().toLowerCase();
    const c=document.getElementById('nf-client').value.trim().toLowerCase();
    const s=document.getElementById('nf-status').value;
    const f=document.getElementById('nf-from').value;
    const t=document.getElementById('nf-to').value;
    const q=document.getElementById('nf-q').value.trim().toLowerCase();
    rows=invoices.filter(x=>{
      const date=String(x.emitidaEm||x.criadoEm||'').slice(0,10);
      const okN=!n||String(x.numero||'').toLowerCase().includes(n)||String(x.chaveAcesso||'').includes(n);
      const okC=!c||String(x.clienteNome||'').toLowerCase().includes(c);
      const okS=!s||String(x.status||'').toLowerCase()===s;
      const okF=!f||date>=f; const okT=!t||date<=t;
      const hay=[x.numero,x.serie,x.chaveAcesso,x.clienteNome,x.cnpjCliente,x.pedidoNumero,x.status].join(' ').toLowerCase();
      return okN&&okC&&okS&&okF&&okT&&(!q||hay.includes(q));
    });
    const tb=document.getElementById('nf-tbody');
    tb.innerHTML=rows.length?rows.map(x=>`<tr>
      <td><strong>${escapeHTML(x.numero)}</strong>${x.serie?`<br><span class="hint">Série ${escapeHTML(x.serie)}</span>`:''}${x.chaveAcesso?`<br><span class="cell-mono hint">${escapeHTML(x.chaveAcesso)}</span>`:''}</td>
      <td>${fmtDateTime(x.emitidaEm||x.criadoEm)}</td>
      <td><strong>${escapeHTML(x.clienteNome||'—')}</strong>${x.cnpjCliente?`<br><span class="hint">${escapeHTML(x.cnpjCliente)}</span>`:''}</td>
      <td>${escapeHTML(x.pedidoNumero||'—')}</td>
      <td>${money(x.valorTotal||0)}</td>
      <td>${statusStamp(x.status||'pendente',fiscalStatusKind(x.status))}</td>
      <td>${x.hasPdf?'<span class="pill">PDF</span>':''} ${x.hasXml?'<span class="pill">XML</span>':''} ${!x.hasPdf&&!x.hasXml?'—':''}</td>
      <td><div class="row-actions"><button class="btn btn--ghost btn--sm" data-nf-view="${x.id}">Visualizar</button>${x.hasPdf?`<button class="btn btn--primary btn--sm" data-nf-copy="${x.id}">2ª via</button>`:''}</div></td>
    </tr>`).join(''):`<tr><td colspan="8"><div class="empty-state"><p>Nenhuma nota fiscal encontrada.</p></div></td></tr>`;
    tb.querySelectorAll('[data-nf-view]').forEach(b=>b.onclick=()=>openInvoiceViewer(invoices.find(x=>x.id===b.dataset.nfView)));
    tb.querySelectorAll('[data-nf-copy]').forEach(b=>b.onclick=()=>window.open(`/api/fiscal/invoices/${encodeURIComponent(b.dataset.nfCopy)}/pdf`,'_blank','noopener'));
  }
  ['nf-number','nf-client','nf-status','nf-from','nf-to','nf-q'].forEach(id=>document.getElementById(id).addEventListener(id==='nf-status'||id==='nf-from'||id==='nf-to'?'change':'input',debounce(draw,150)));
  document.getElementById('nf-clear').onclick=()=>{['nf-number','nf-client','nf-status','nf-from','nf-to','nf-q'].forEach(id=>document.getElementById(id).value='');draw();};
  document.getElementById('invoice-add').onclick=()=>openInvoiceImportForm();
  draw();
}

async function openInvoiceImportForm(){
  const [orders,cap]=await Promise.all([fiscalFetch('/orders-ready'),fiscalFetch('/capabilities')]);
  openModal('Registrar NF-e emitida',`
    <p class="hint">Cadastre uma NF-e já autorizada pelo seu emissor fiscal. Se informar o pedido, a nota será vinculada automaticamente à venda e à separação.</p>
    <div class="form-grid">
      <div class="field field--full"><label>Pedido vinculado</label><select class="input" id="fi-order"><option value="">Sem vínculo</option>${orders.map(o=>`<option value="${o.id}">${escapeHTML(o.numero)} · ${escapeHTML(o.clienteNome)} · ${money(o.total)}</option>`).join('')}</select></div>
      <div class="field"><label>Número NF-e *</label><input class="input" id="fi-number" required></div>
      <div class="field"><label>Série</label><input class="input" id="fi-series"></div>
      <div class="field field--full"><label>Chave de acesso (44 dígitos)</label><input class="input cell-mono" id="fi-key" maxlength="60"></div>
      <div class="field"><label>Data/hora de emissão</label><input class="input" type="datetime-local" id="fi-date" value="${nowLocalDatetimeInput()}"></div>
      <div class="field"><label>Status</label><select class="input" id="fi-status"><option value="autorizada">Autorizada</option><option value="emitida">Emitida</option><option value="pendente">Pendente</option><option value="cancelada">Cancelada</option></select></div>
      <div class="field"><label>Cliente</label><input class="input" id="fi-client"></div>
      <div class="field"><label>CNPJ cliente</label><input class="input" id="fi-cnpj"></div>
      <div class="field"><label>Valor total</label><input class="input" id="fi-value" type="number" step="0.01" min="0"></div>
      <div class="field"><label>Protocolo</label><input class="input" id="fi-protocol"></div>
      <div class="field"><label>DANFE / PDF</label><input class="input" id="fi-pdf" type="file" accept="application/pdf,.pdf"></div>
      <div class="field"><label>XML autorizado</label><input class="input" id="fi-xml" type="file" accept="text/xml,application/xml,.xml"></div>
      <div class="field field--full"><label>Observações</label><textarea class="input" id="fi-note" rows="3"></textarea></div>
    </div>
    <div class="notice-aion" style="margin-top:12px"><strong>Emissão automática:</strong> ${escapeHTML(cap.message||'')}</div>
    <div class="form-actions"><button class="btn btn--ghost" id="fi-cancel">Cancelar</button><button class="btn btn--primary" id="fi-save">Salvar NF-e</button></div>
  `,{wide:true});
  document.getElementById('fi-cancel').onclick=closeModal;
  const orderSelect=document.getElementById('fi-order');
  orderSelect.onchange=()=>{const o=orders.find(x=>x.id===orderSelect.value);if(!o)return;document.getElementById('fi-client').value=o.clienteNome||'';document.getElementById('fi-value').value=Number(o.total||0).toFixed(2);if(o.nfNumero)document.getElementById('fi-number').value=o.nfNumero;};
  document.getElementById('fi-save').onclick=async()=>{
    const btn=document.getElementById('fi-save');
    const pdf=document.getElementById('fi-pdf').files[0]; const xml=document.getElementById('fi-xml').files[0];
    btn.disabled=true;btn.textContent='Salvando…';
    try{
      const body={orderId:orderSelect.value||null,numero:document.getElementById('fi-number').value.trim(),serie:document.getElementById('fi-series').value.trim(),chaveAcesso:document.getElementById('fi-key').value.trim(),emitidaEm:document.getElementById('fi-date').value,status:document.getElementById('fi-status').value,clienteNome:document.getElementById('fi-client').value.trim(),cnpjCliente:document.getElementById('fi-cnpj').value.trim(),valorTotal:Number(document.getElementById('fi-value').value||0),protocolo:document.getElementById('fi-protocol').value.trim(),observacoes:document.getElementById('fi-note').value.trim(),pdfBase64:pdf?await fileToDataUrl(pdf):null,xmlBase64:xml?await fileToDataUrl(xml):null};
      await fiscalFetch('/invoices/import',{method:'POST',body});closeModal();toast('NF-e registrada com sucesso.','success');navigate('invoices');
    }catch(e){toast(e.message,'error');btn.disabled=false;btn.textContent='Salvar NF-e';}
  };
}

async function openInvoiceViewer(inv){
  let order=null;
  if(inv.pedidoId){try{const orders=await commercialFetch('/orders');order=orders.find(x=>x.id===inv.pedidoId)||null}catch{}}
  openModal(`NF-e ${escapeHTML(inv.numero)}`,`
    <div class="info-strip"><strong>${escapeHTML(inv.clienteNome||'Cliente não informado')}</strong> · ${money(inv.valorTotal||0)} · ${statusStamp(inv.status||'pendente',fiscalStatusKind(inv.status))}</div>
    <div class="form-grid" style="margin-top:14px">
      <div><span class="hint">Número / Série</span><div><strong>${escapeHTML(inv.numero)}${inv.serie?` / ${escapeHTML(inv.serie)}`:''}</strong></div></div>
      <div><span class="hint">Emissão</span><div>${fmtDateTime(inv.emitidaEm)}</div></div>
      <div class="field--full"><span class="hint">Chave de acesso</span><div class="cell-mono">${escapeHTML(inv.chaveAcesso||'—')}</div></div>
      <div><span class="hint">Pedido</span><div>${escapeHTML(inv.pedidoNumero||'—')}</div></div>
      <div><span class="hint">Protocolo</span><div>${escapeHTML(inv.protocolo||'—')}</div></div>
    </div>
    ${order?`<div class="section-title">Itens do pedido vinculado</div><div class="table-wrap"><table class="data"><thead><tr><th>Produto</th><th>Qtd.</th><th>Valor</th></tr></thead><tbody>${(order.itens||[]).map(i=>`<tr><td>${escapeHTML(i.produtoNome)}</td><td>${fmtNumber(i.quantidadeUnidades||i.quantidade||0)}</td><td>${money(i.subtotal||0)}</td></tr>`).join('')}</tbody></table></div>`:''}
    <div class="section-title">Documentos</div>
    <div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap">
      ${inv.hasPdf?`<button class="btn btn--primary" id="nf-view-pdf">Visualizar / imprimir 2ª via</button>`:'<span class="hint">DANFE/PDF ainda não armazenado.</span>'}
      ${inv.hasXml?`<a class="btn btn--ghost" href="/api/fiscal/invoices/${encodeURIComponent(inv.id)}/xml" download>Baixar XML</a>`:''}
    </div>
    ${inv.observacoes?`<div class="notice-aion" style="margin-top:12px">${escapeHTML(inv.observacoes)}</div>`:''}
  `,{wide:true});
  document.getElementById('nf-view-pdf')?.addEventListener('click',()=>window.open(`/api/fiscal/invoices/${encodeURIComponent(inv.id)}/pdf`,'_blank','noopener'));
}
