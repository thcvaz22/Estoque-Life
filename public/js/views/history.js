/* ============================================================
   VIEWS/HISTORY.JS — Auditoria administrativa
   Visível apenas para a conta Administrador.
   ============================================================ */

async function renderHistory(root){
  let rows=await DB.all('history');
  rows=rows.slice().sort((a,b)=>String(b.timestamp||'').localeCompare(String(a.timestamp||'')));
  const users=[...new Set(rows.map(r=>String(r.usuario||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const types=[...new Set(rows.map(r=>String(r.tipo||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));

  root.innerHTML=`
    <div class="dashboard-welcome">
      <div><span class="dashboard-welcome__eyebrow">Administrador · Auditoria completa</span><h1>Histórico</h1><p>Todas as alterações registradas no sistema, com responsável, data e detalhes.</p></div>
      <div class="dashboard-welcome__status"><span class="online">${fmtNumber(rows.length)} registro(s)</span></div>
    </div>
    <div class="filters card" style="padding:14px">
      <div class="field"><label>De</label><input class="input" type="date" id="hi-from"></div>
      <div class="field"><label>Até</label><input class="input" type="date" id="hi-to"></div>
      <div class="field"><label>Usuário</label><select class="input" id="hi-user"><option value="">Todos</option>${users.map(u=>`<option>${escapeHTML(u)}</option>`).join('')}</select></div>
      <div class="field"><label>Tipo de alteração</label><select class="input" id="hi-type"><option value="">Todos</option>${types.map(t=>`<option value="${escapeHTML(t)}">${escapeHTML(t.replaceAll('_',' '))}</option>`).join('')}</select></div>
      <div class="field" style="min-width:250px"><label>Busca</label><input class="input" id="hi-q" placeholder="Pedido, cliente, produto, NF, observação..."></div>
      <button class="btn btn--ghost" id="hi-clear">Limpar filtros</button>
    </div>
    <div class="view-head"><span class="subtitle" id="hi-count"></span></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Data/Hora</th><th>Usuário</th><th>Alteração</th><th>Referência</th><th>Motivo</th><th>Detalhes</th></tr></thead><tbody id="hi-body"></tbody></table></div>`;

  function draw(){
    const from=document.getElementById('hi-from').value;
    const to=document.getElementById('hi-to').value;
    const user=document.getElementById('hi-user').value.toLowerCase();
    const type=document.getElementById('hi-type').value.toLowerCase();
    const q=document.getElementById('hi-q').value.trim().toLowerCase();
    const filtered=rows.filter(r=>{
      const date=String(r.timestamp||'').slice(0,10);
      const hay=[r.usuario,r.tipo,r.produtoNome,r.produtoId,r.lote,r.nf,r.motivo,r.observacoes,r.quantidade].join(' ').toLowerCase();
      return (!from||!date||date>=from)&&(!to||!date||date<=to)&&(!user||String(r.usuario||'').toLowerCase().includes(user))&&(!type||String(r.tipo||'').toLowerCase()===type)&&(!q||hay.includes(q));
    });
    document.getElementById('hi-count').textContent=`${fmtNumber(filtered.length)} alteração(ões) encontrada(s)`;
    document.getElementById('hi-body').innerHTML=filtered.length?filtered.slice(0,1000).map(r=>`<tr>
      <td>${escapeHTML(fmtDateTime(r.timestamp))}</td>
      <td>${escapeHTML(r.usuario||'—')}</td>
      <td>${statusStamp(String(r.tipo||'alteração').replaceAll('_',' '),'info')}</td>
      <td>${escapeHTML([r.nf?`NF ${r.nf}`:'',r.produtoNome||'',r.lote?`Lote ${r.lote}`:''].filter(Boolean).join(' · ')||'—')}</td>
      <td>${escapeHTML(r.motivo||'—')}</td>
      <td style="max-width:420px;white-space:normal">${escapeHTML(r.observacoes||'—')}</td>
    </tr>`).join(''):`<tr><td colspan="6"><div class="empty-state"><p>Nenhuma alteração encontrada.</p></div></td></tr>`;
  }
  ['hi-from','hi-to','hi-user','hi-type','hi-q'].forEach(id=>{const el=document.getElementById(id);el.addEventListener(el.tagName==='SELECT'||el.type==='date'?'change':'input',debounce(draw,150));});
  document.getElementById('hi-clear').onclick=()=>{['hi-from','hi-to','hi-user','hi-type','hi-q'].forEach(id=>document.getElementById(id).value='');draw();};
  draw();
}
