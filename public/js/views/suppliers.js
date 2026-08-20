/* ============================================================
   VIEWS/SUPPLIERS.JS — Cadastro de fornecedores
   Centraliza dados usados em entradas, romaneios de conferência e
   devoluções, evitando redigitação a cada recebimento.
   ============================================================ */

function digitsOnly(v){ return String(v||'').replace(/\D/g,''); }
function formatDocSupplier(v){
  const d=digitsOnly(v);
  if(d.length===14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');
  if(d.length===11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');
  return v||'';
}

async function renderSuppliers(root){
  const suppliers=(await DB.all('suppliers')).sort((a,b)=>String(a.razaoSocial||a.nome||'').localeCompare(String(b.razaoSocial||b.nome||''),'pt-BR'));
  const canEdit=typeof Auth!=='undefined' && Auth.isManager && Auth.isManager();
  root.innerHTML=`
    <div class="dashboard-welcome">
      <div>
        <span class="dashboard-welcome__eyebrow">Cadastros · Recebimento</span>
        <h1>Fornecedores</h1>
        <p>Dados utilizados automaticamente nas entradas, romaneios de conferência e devoluções.</p>
      </div>
      ${canEdit?'<button class="btn btn--primary" id="supplier-new">+ Novo fornecedor</button>':''}
    </div>
    <div class="card" style="margin-bottom:14px;padding:14px">
      <div class="field"><label>Buscar fornecedor</label><input class="input" id="supplier-search" placeholder="Razão social, CNPJ, cidade, contato…"></div>
    </div>
    <div class="card table-wrap">
      <table class="data">
        <thead><tr><th>Fornecedor</th><th>CNPJ/CPF</th><th>Contato</th><th>Localidade</th><th>Status</th><th></th></tr></thead>
        <tbody id="supplier-tbody"></tbody>
      </table>
    </div>`;

  const search=document.getElementById('supplier-search');
  const tbody=document.getElementById('supplier-tbody');
  function draw(){
    const q=String(search.value||'').trim().toLowerCase();
    const rows=suppliers.filter(s=>!q||[s.razaoSocial,s.nomeFantasia,s.nome,s.cnpjCpf,s.cnpj,s.cpf,s.cidade,s.uf,s.contato,s.telefone,s.email].join(' ').toLowerCase().includes(q));
    tbody.innerHTML=rows.length?rows.map(s=>`<tr>
      <td><strong>${escapeHTML(s.razaoSocial||s.nome||'—')}</strong>${s.nomeFantasia?`<br><span class="hint">${escapeHTML(s.nomeFantasia)}</span>`:''}</td>
      <td class="cell-mono">${escapeHTML(formatDocSupplier(s.cnpjCpf||s.cnpj||s.cpf||'' )||'—')}</td>
      <td>${escapeHTML(s.contato||'—')}${s.telefone?`<br><span class="hint">${escapeHTML(s.telefone)}</span>`:''}${s.email?`<br><span class="hint">${escapeHTML(s.email)}</span>`:''}</td>
      <td>${escapeHTML([s.cidade,s.uf].filter(Boolean).join(' / ')||'—')}</td>
      <td>${statusStamp(s.ativo===false?'Inativo':'Ativo',s.ativo===false?'neutral':'ok')}</td>
      <td>${canEdit?`<div class="row-actions"><button class="btn btn--ghost btn--sm" data-supplier-edit="${s.id}">Editar</button><button class="btn btn--sm ${s.ativo===false?'':'btn--danger'}" data-supplier-toggle="${s.id}">${s.ativo===false?'Reativar':'Desativar'}</button></div>`:''}</td>
    </tr>`).join(''):`<tr><td colspan="6"><div class="empty-state"><p>Nenhum fornecedor cadastrado.</p></div></td></tr>`;
    tbody.querySelectorAll('[data-supplier-edit]').forEach(b=>b.onclick=()=>openSupplierForm(suppliers.find(s=>s.id===b.dataset.supplierEdit)));
    tbody.querySelectorAll('[data-supplier-toggle]').forEach(b=>b.onclick=async()=>{
      const s=suppliers.find(x=>x.id===b.dataset.supplierToggle); if(!s)return;
      const updated={...s,ativo:s.ativo===false};
      await DB.put('suppliers',updated); toast(updated.ativo?'Fornecedor reativado.':'Fornecedor desativado.','success'); navigate('suppliers');
    });
  }
  search.addEventListener('input',debounce(draw,120));
  if(canEdit) document.getElementById('supplier-new').onclick=()=>openSupplierForm();
  draw();
}

function supplierAddressText(s){
  if(!s)return'';
  const p1=[s.logradouro,s.numero].filter(Boolean).join(', ');
  const p2=[s.bairro,s.cidade,s.uf].filter(Boolean).join(' · ');
  const p3=s.cep?`CEP ${s.cep}`:'';
  return [p1,p2,p3].filter(Boolean).join(' — ');
}

function openSupplierForm(existing=null){
  const s=existing||{};
  openModal(existing?'Editar fornecedor':'Novo fornecedor',`
    <div class="form-grid form-grid--3">
      <div class="field field--full"><label>Razão social *</label><input class="input" id="sp-razao" value="${escapeHTML(s.razaoSocial||s.nome||'')}"></div>
      <div class="field"><label>Nome fantasia</label><input class="input" id="sp-fantasia" value="${escapeHTML(s.nomeFantasia||'')}"></div>
      <div class="field"><label>CNPJ / CPF *</label><input class="input" id="sp-doc" value="${escapeHTML(s.cnpjCpf||s.cnpj||s.cpf||'')}"></div>
      <div class="field"><label>Inscrição estadual</label><input class="input" id="sp-ie" value="${escapeHTML(s.inscricaoEstadual||'')}"></div>
      <div class="field"><label>Contato</label><input class="input" id="sp-contato" value="${escapeHTML(s.contato||'')}"></div>
      <div class="field"><label>Telefone</label><input class="input" id="sp-tel" value="${escapeHTML(s.telefone||'')}"></div>
      <div class="field"><label>E-mail</label><input class="input" type="email" id="sp-email" value="${escapeHTML(s.email||'')}"></div>
      <div class="field field--full"><label>Logradouro</label><input class="input" id="sp-log" value="${escapeHTML(s.logradouro||'')}"></div>
      <div class="field"><label>Número</label><input class="input" id="sp-num" value="${escapeHTML(s.numero||'')}"></div>
      <div class="field"><label>Complemento</label><input class="input" id="sp-comp" value="${escapeHTML(s.complemento||'')}"></div>
      <div class="field"><label>Bairro</label><input class="input" id="sp-bairro" value="${escapeHTML(s.bairro||'')}"></div>
      <div class="field"><label>Cidade</label><input class="input" id="sp-cidade" value="${escapeHTML(s.cidade||'')}"></div>
      <div class="field"><label>UF</label><input class="input" id="sp-uf" maxlength="2" value="${escapeHTML(s.uf||'')}"></div>
      <div class="field"><label>CEP</label><input class="input" id="sp-cep" value="${escapeHTML(s.cep||'')}"></div>
      <div class="field"><label>Cód. município IBGE</label><input class="input" id="sp-ibge" value="${escapeHTML(s.codigoMunicipioIBGE||'')}"></div>
      <div class="field field--full"><label>Observações</label><textarea class="input" id="sp-note" rows="3">${escapeHTML(s.observacoes||'')}</textarea></div>
    </div>
    <div class="form-actions"><button class="btn btn--ghost" id="sp-cancel">Cancelar</button><button class="btn btn--primary" id="sp-save">Salvar fornecedor</button></div>
  `,{wide:true});
  document.getElementById('sp-cancel').onclick=closeModal;
  document.getElementById('sp-save').onclick=async()=>{
    const razao=document.getElementById('sp-razao').value.trim();
    const doc=document.getElementById('sp-doc').value.trim();
    if(!razao||!doc){toast('Informe razão social e CNPJ/CPF.','warn');return;}
    const now=new Date().toISOString();
    const row={
      ...s,id:s.id||uid('supplier'),razaoSocial:razao,nome:razao,nomeFantasia:document.getElementById('sp-fantasia').value.trim(),
      cnpjCpf:digitsOnly(doc),inscricaoEstadual:document.getElementById('sp-ie').value.trim(),contato:document.getElementById('sp-contato').value.trim(),
      telefone:document.getElementById('sp-tel').value.trim(),email:document.getElementById('sp-email').value.trim(),logradouro:document.getElementById('sp-log').value.trim(),
      numero:document.getElementById('sp-num').value.trim(),complemento:document.getElementById('sp-comp').value.trim(),bairro:document.getElementById('sp-bairro').value.trim(),
      cidade:document.getElementById('sp-cidade').value.trim(),uf:document.getElementById('sp-uf').value.trim().toUpperCase(),cep:digitsOnly(document.getElementById('sp-cep').value),
      codigoMunicipioIBGE:digitsOnly(document.getElementById('sp-ibge').value),observacoes:document.getElementById('sp-note').value.trim(),ativo:s.ativo!==false,
      criadoEm:s.criadoEm||now,atualizadoEm:now
    };
    try{await DB.put('suppliers',row);toast('Fornecedor salvo.','success');closeModal();navigate('suppliers');}catch(err){toast(err.message,'error');}
  };
}
