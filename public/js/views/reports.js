/* ============================================================
   VIEWS/REPORTS.JS — Central de relatórios operacionais
   O Histórico/Auditoria completo agora fica separado e restrito
   à conta Administrador.
   ============================================================ */

const HISTORY_TYPE_LABEL = {
  entrada: 'Entrada', saida: 'Saída', backlog_retorno: 'Retorno de Backlog', inventario: 'Ajuste de Inventário',
  ajuste: 'Ajuste de Estoque', avaria: 'Avaria/Perda', importacao_xml: 'Importação de XML', importacao_foto: 'Importação por Foto (OCR)',
  cadastro_produto: 'Cadastro de Produto', edicao_produto: 'Edição de Produto', exclusao: 'Exclusão', restauracao_backup: 'Restauração de Backup',
  usuario_cadastrado: 'Cadastro de Usuário', usuario_editado: 'Edição de Usuário', usuario_desativado: 'Usuário Desativado', usuario_reativado: 'Usuário Reativado', senha_redefinida: 'Senha Redefinida',
  custo_alterado: 'Alteração de Custo', pedido_enviado: 'Pedido Enviado', pedido_reenviado: 'Pedido Reenviado', pedido_aprovado: 'Pedido Aprovado', pedido_reprovado: 'Pedido Reprovado', pedido_refazer: 'Pedido para Refazer', cliente_aprovado:'Cliente Aprovado', cliente_reprovado:'Cliente Reprovado', cadastro_cliente:'Cadastro de Cliente'
};

function reportDateValue(r) {
  const raw = r.timestamp || r.horarioSaida || r.dataRetorno || r.dataChegada || r.data || r.criadoEm || r.validade || '';
  return String(raw).slice(0,10);
}
function reportSearchText(r) {
  try { return JSON.stringify(r).toLowerCase(); } catch { return ''; }
}
function reportUserValue(r) { return String(r.usuario || r.responsavel || r.criadoPor || r.vendedorNome || '').trim(); }
function reportProductValue(r) {
  return String(r.produtoNome || r.produto || (r.itens||[]).map(i=>i.produtoNome||i.nome||'').join(' ') || '').trim();
}
function reportNFValue(r) {
  if (r.nf) return String(r.nf);
  if (Array.isArray(r.nfs)) return r.nfs.map(n=>n.numero||n.nf||'').join(' ');
  return String(r.nfNumero || '');
}
function reportPartyValue(r) { return String(r.cliente || r.clienteNome || r.fornecedor || r.motorista || '').trim(); }
function reportStatusValue(r) { return String(r.status || r.statusAprovacao || r.tipo || '').trim(); }

const REPORT_DEFS = {
  pedidos: {
    label:'Pedidos', load: async()=>{ try{return await commercialFetch('/orders')}catch{return []} },
    headers:[
      {label:'Data',get:r=>fmtDateTime(r.criadoEm)}, {label:'Pedido',key:'numero'}, {label:'Cliente',get:r=>r.clienteNome||'—'}, {label:'Vendedor',get:r=>r.vendedorNome||'—'},
      {label:'Pagamento',get:r=>r.formaPagamento||'—'}, {label:'Total',get:r=>Number(r.total||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}, {label:'Status',get:r=>r.status||'—'}
    ]
  },
  entradas: {
    label: 'Entradas', load: () => DB.all('entries'),
    headers: [
      { label: 'Data', get: r => fmtDate(r.dataChegada||r.data) }, { label: 'Fornecedor', key: 'fornecedor' }, { label: 'NF', key: 'nf' },
      { label: 'Itens', get: r => (r.itens||[]).length }, { label: 'Qtd. total', get: r => (r.itens||[]).reduce((a, i) => a + Number(i.quantidade || 0), 0) },
      { label:'Custo total', get:r=>(r.itens||[]).reduce((a,i)=>a+Number(i.quantidade||0)*Number(i.custoUnitario||0),0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) },
      { label: 'Origem', get: r => r.origemXML ? 'XML' : r.origemFoto ? 'Foto/OCR' : 'Manual' }, {label:'Responsável',get:r=>r.responsavel||'—'}
    ]
  },
  saidas: {
    label: 'Saídas', load: () => DB.all('exits'),
    headers: [
      { label: 'Saída', get: r => fmtDateTime(r.horarioSaida) }, { label: 'Motorista', key: 'motorista' }, { label: 'Placa', key: 'placa' },
      { label: 'Cliente', key: 'cliente' }, { label: 'NFs', get: r => (r.nfs||[]).map(nf => nf.numero).join(', ') },
      { label: 'Qtd. total', get: r => exitTotalQtd(r) }, { label: 'Status', get: r => EXIT_STATUS_LABEL[r.status]||r.status }, {label:'Responsável',get:r=>r.responsavel||'—'}
    ]
  },
  produtos: {
    label:'Produtos / Custos', load:()=>DB.all('products'),
    headers:[
      {label:'Código',get:r=>r.codigoInterno||'—'}, {label:'Produto',key:'nome'}, {label:'Embalagem',get:r=>`${r.embalagem||'—'} ${r.volume||''}`.trim()},
      {label:'Custo unitário',get:r=>Number(r.custoAtual||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}, {label:'Estoque mínimo',get:r=>r.estoqueMinimo??0}, {label:'Situação',get:r=>r.ativo===false?'Desativado':'Ativo'}
    ]
  },
  estoque: {
    label: 'Estoque', load: async () => {
      const s = await computeStockSummary(); const rows = [];
      s.forEach(x => x.lots.forEach(l => rows.push({ produto: x.product.nome, produtoNome:x.product.nome, lote: l.lote, disponivel: l.quantidadeDisponivel, bloqueado: l.quantidadeBloqueada, validade: l.validade, custoAtual:Number(x.product.custoAtual||0) })));
      return rows;
    },
    headers: [
      { label: 'Produto', key: 'produto' }, { label: 'Lote', key: 'lote' }, { label: 'Disponível', key: 'disponivel' },
      { label: 'Bloqueado', key: 'bloqueado' }, {label:'Custo unit.',get:r=>Number(r.custoAtual||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}, { label: 'Validade', get: r => fmtDate(r.validade) }
    ]
  },
  backlog: {
    label: 'Backlog', load: () => DB.all('backlog'),
    headers: [
      { label: 'Retorno', get: r => fmtDateTime(r.dataRetorno) }, { label: 'Cliente', key: 'cliente' }, { label: 'NF', key: 'nf' },
      { label: 'Produto', key: 'produtoNome' }, { label: 'Quantidade', key: 'quantidade' },
      { label: 'Motivo', key: 'motivo' }, { label: 'Status', get: r => BACKLOG_STATUS_LABEL[r.status] || r.status }
    ]
  },
  inventario: {
    label: 'Inventário', load: () => DB.all('inventories'),
    headers: [
      { label: 'Data', get: r => fmtDateTime(r.data) }, { label: 'Responsável', get:r=>r.usuario||r.responsavel||'—' }, { label: 'Itens contados', get: r => (r.itens||[]).length },
      { label: 'Divergências', get: r => (r.itens||[]).filter(i => i.esperadoDisponivel !== i.contadoDisponivel || i.esperadoBloqueado !== i.contadoBloqueado).length }
    ]
  },
  avarias: {
    label: 'Avarias e Perdas', load: () => DB.all('losses'),
    headers: [
      { label: 'Data', get: r => fmtDate(r.data) }, { label: 'Produto', key: 'produtoNome' }, { label: 'Quantidade', key: 'quantidade' },
      { label: 'Motivo', key: 'motivo' }, { label: 'Responsável', key: 'responsavel' }
    ]
  },
  validade: {
    label: 'Validade', load: async () => {
      const s = await computeStockSummary(); const rows = [];
      s.forEach(x => x.lots.forEach(l => { if (l.validade) rows.push({ produto: x.product.nome, produtoNome:x.product.nome, lote: l.lote, validade: l.validade, quantidade: l.quantidadeDisponivel, dias: daysUntil(l.validade) }); }));
      return rows.sort((a,b)=>a.dias-b.dias);
    },
    headers: [
      { label: 'Produto', key: 'produto' }, { label: 'Lote', key: 'lote' }, { label: 'Validade', get: r => fmtDate(r.validade) },
      { label: 'Quantidade', key: 'quantidade' }, { label: 'Dias restantes', key: 'dias' }
    ]
  }
};

let _currentReport = 'pedidos';

async function renderReports(root) {
  let users = [];
  const products = (await DB.all('products')).filter(p=>p.ativo!==false).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));

  root.innerHTML = `
    <div class="dashboard-welcome"><div><span class="dashboard-welcome__eyebrow">Central de informações</span><h1>Relatórios</h1><p>Selecione o relatório, período e filtros para visualizar ou exportar somente as informações que precisa.</p></div></div>
    <div class="tabs" id="report-tabs">${Object.entries(REPORT_DEFS).map(([k,v])=>`<button class="tab ${k===_currentReport?'active':''}" data-report="${k}">${v.label}</button>`).join('')}</div>
    <div class="filters" style="margin-top:12px">
      <div class="field"><label>De</label><input class="input" type="date" id="rp-de"></div>
      <div class="field"><label>Até</label><input class="input" type="date" id="rp-ate"></div>
      <div class="field"><label>Usuário / Responsável</label><select class="input" id="rp-user"><option value="">Todos</option>${users.map(u=>`<option>${escapeHTML(u)}</option>`).join('')}</select></div>
      <div class="field"><label>Produto</label><select class="input" id="rp-product"><option value="">Todos</option>${products.map(p=>`<option value="${escapeHTML(p.nome)}">${escapeHTML(p.codigoInterno||'')} ${escapeHTML(p.nome)}</option>`).join('')}</select></div>
      <div class="field"><label>NF</label><input class="input" id="rp-nf" placeholder="Número da NF"></div>
      <div class="field"><label>Cliente / Fornecedor / Motorista</label><input class="input" id="rp-party" placeholder="Digite para filtrar"></div>
      <div class="field"><label>Status / Tipo</label><input class="input" id="rp-status" placeholder="Ex.: aprovado, entrada"></div>
      <div class="field" style="min-width:220px"><label>Busca em todos os campos</label><input class="input" id="rp-search" placeholder="Qualquer informação"></div>
      <div class="field" style="align-self:flex-end"><button class="btn btn--ghost" id="rp-clear">Limpar filtros</button></div>
    </div>
    <div class="view-head"><div><span class="subtitle" id="rp-count"></span></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="rp-csv">⬇️ Excel</button><button class="btn" id="rp-pdf">📄 PDF</button><button class="btn" id="rp-print">🖨️ Imprimir</button></div></div>
    <div class="table-wrap"><table class="data"><thead id="rp-thead"></thead><tbody id="rp-tbody"></tbody></table></div>`;

  let rawRows=[]; let filtered=[];
  function applyFilters() {
    const de=document.getElementById('rp-de').value, ate=document.getElementById('rp-ate').value;
    const user=document.getElementById('rp-user').value.toLowerCase();
    const product=document.getElementById('rp-product').value.toLowerCase();
    const nf=document.getElementById('rp-nf').value.toLowerCase();
    const party=document.getElementById('rp-party').value.toLowerCase();
    const status=document.getElementById('rp-status').value.toLowerCase();
    const search=document.getElementById('rp-search').value.toLowerCase();
    filtered=rawRows.filter(r=>{
      const d=reportDateValue(r); if(de&&d&&d<de)return false; if(ate&&d&&d>ate)return false;
      if(user&&!reportUserValue(r).toLowerCase().includes(user))return false;
      if(product&&!reportProductValue(r).toLowerCase().includes(product))return false;
      if(nf&&!reportNFValue(r).toLowerCase().includes(nf))return false;
      if(party&&!reportPartyValue(r).toLowerCase().includes(party))return false;
      if(status&&!reportStatusValue(r).toLowerCase().includes(status) && !reportSearchText(r).includes(status))return false;
      if(search&&!reportSearchText(r).includes(search))return false;
      return true;
    });
    const def=REPORT_DEFS[_currentReport];
    document.getElementById('rp-count').textContent=`${filtered.length} registro(s) após os filtros`;
    document.getElementById('rp-tbody').innerHTML=filtered.length===0?`<tr><td colspan="${def.headers.length}"><div class="empty-state"><div class="big">📄</div><p>Nenhum registro encontrado com esses filtros.</p></div></td></tr>`:filtered.slice(0,500).map(r=>`<tr>${def.headers.map(h=>`<td>${escapeHTML(typeof h.get==='function'?h.get(r):(r[h.key]??'—'))}</td>`).join('')}</tr>`).join('')+(filtered.length>500?`<tr><td colspan="${def.headers.length}" class="hint">Mostrando 500 registros na tela. A exportação usa todos os ${filtered.length} resultados filtrados.</td></tr>`:'');
  }
  async function loadReport(){
    const def=REPORT_DEFS[_currentReport]; document.getElementById('rp-thead').innerHTML=`<tr>${def.headers.map(h=>`<th>${h.label}</th>`).join('')}</tr>`;
    rawRows=await def.load();
    const currentUserFilter=document.getElementById('rp-user').value;
    users=[...new Set(rawRows.map(reportUserValue).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    document.getElementById('rp-user').innerHTML='<option value="">Todos</option>'+users.map(u=>`<option>${escapeHTML(u)}</option>`).join('');
    if(users.includes(currentUserFilter)) document.getElementById('rp-user').value=currentUserFilter;
    applyFilters();
    document.getElementById('rp-csv').onclick=()=>exportExcel(def.label,def.headers,filtered);
    document.getElementById('rp-pdf').onclick=()=>exportPDF(`Relatório de ${def.label}`,def.headers,filtered,{subtitle:`Período/filtros selecionados · Gerado em ${fmtDateTime(new Date().toISOString())}`});
    document.getElementById('rp-print').onclick=()=>printReport(`Relatório de ${def.label}`,def.headers,filtered);
  }
  document.querySelectorAll('#report-tabs .tab').forEach(t=>t.onclick=()=>{_currentReport=t.dataset.report;document.querySelectorAll('#report-tabs .tab').forEach(x=>x.classList.toggle('active',x===t));loadReport();});
  ['rp-de','rp-ate','rp-user','rp-product','rp-nf','rp-party','rp-status','rp-search'].forEach(id=>{const el=document.getElementById(id);el.addEventListener(el.tagName==='SELECT'?'change':'input',debounce(applyFilters,180));});
  document.getElementById('rp-clear').onclick=()=>{['rp-de','rp-ate','rp-user','rp-product','rp-nf','rp-party','rp-status','rp-search'].forEach(id=>document.getElementById(id).value='');applyFilters();};
  loadReport();
}
