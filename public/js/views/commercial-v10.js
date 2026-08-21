/* ============================================================
   COMMERCIAL-V10.JS — melhorias operacionais
   - Operador/Gerente criam clientes e pedidos
   - Romaneio 100% manual por seleção de NFs/pedidos aprovados
   - Filtros de separação por NF, fornecedor, cidade, bairro,
     região e vendedor
   - PDF do romaneio com visualizar, salvar e imprimir
   ============================================================ */

function uniqueSorted(values) {
  return [...new Set((values || []).map(v => String(v || '').trim()).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b, 'pt-BR'));
}

function selectOptions(values, emptyLabel = 'Todos') {
  return `<option value="">${emptyLabel}</option>` + uniqueSorted(values)
    .map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('');
}

async function renderCommercialCustomers(root) {
  const [customers, pending, tables, sellers] = await Promise.all([
    commercialFetch('/customers'),
    commercialFetch('/customers/pending'),
    commercialFetch('/price-tables'),
    commercialFetch('/sellers')
  ]);

  root.innerHTML = `
    <div class="dashboard-welcome">
      <div>
        <span class="dashboard-welcome__eyebrow">Life Vendas · Clientes</span>
        <h1>Clientes</h1>
        <p>Cadastros dos vendedores e pré-cadastros importados chegam para conferência. A operação também pode cadastrar clientes diretamente.</p>
      </div>
      <div class="page-head-actions">
        <button class="btn btn--primary" id="op-new-customer"><span class="action-icon">＋</span> Adicionar cliente</button>
        <div class="dashboard-welcome__status"><span class="online">${pending.length} pendente(s)</span></div>
      </div>
    </div>

    ${pending.length ? `
      <div class="section-title">Aguardando aprovação</div>
      <div class="grid grid--2">
        ${pending.map(c => `
          <div class="card">
            <div style="display:flex;justify-content:space-between;gap:12px">
              <div>
                <h3>${escapeHTML(c.nome || c.nomeFantasia || c.razaoSocial)}</h3>
                <p class="hint">${escapeHTML(c.cnpj || (c.statusAprovacao === 'pre_cadastro' ? 'Pré-cadastro · dados complementares pendentes' : 'Sem CNPJ'))} · Vendedor: ${escapeHTML(c.vendedorNome || '-')}</p>${c.ultimaCompra ? `<p class="hint">Último pedido: ${fmtDate(c.ultimaCompra)}</p>` : ''}
              </div>
              ${statusStamp(c.statusAprovacao === 'pre_cadastro' ? 'PRÉ-CADASTRO' : 'PENDENTE','warn')}
            </div>
            <p class="hint">${escapeHTML([c.endereco,c.bairro,c.cidade,c.uf].filter(Boolean).join(' · '))}</p>
            <div class="form-actions">
              <button class="btn btn--ghost" data-reject-client="${c.id}">Reprovar</button>
              <button class="btn btn--primary" data-approve-client="${c.id}">Aprovar</button>
            </div>
          </div>`).join('')}
      </div>` : `
      <div class="card"><div class="empty-state"><div class="big">✅</div><p>Nenhum cadastro aguardando aprovação.</p></div></div>`}

    <div class="section-title">Clientes cadastrados</div>
    <div class="card table-wrap">
      <table class="data">
        <thead><tr><th>Cliente</th><th>Último pedido</th><th>Cidade / Bairro</th><th>Vendedor</th><th>Classificação</th><th>Tabela</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${customers.map(c => `
            <tr>
              <td><strong>${escapeHTML(c.nome || c.nomeFantasia || c.razaoSocial)}</strong><br><span class="hint">${escapeHTML(c.cnpj || '')}</span></td>
              <td>${c.ultimaCompra ? fmtDate(c.ultimaCompra) : '—'}</td><td>${escapeHTML([c.cidade,c.bairro].filter(Boolean).join(' · ') || '—')}</td>
              <td>${escapeHTML(c.vendedorNome || '—')}</td>
              <td>${c.classificacao ? statusStamp(c.classificacao,c.classificacao === 'Verde' ? 'ok' : 'warn') : '—'}</td>
              <td>${escapeHTML(tables.find(t => t.id === c.tabelaPrecoId)?.nome || '—')}</td>
              <td>${statusStamp(c.statusAprovacao === 'pre_cadastro' ? 'pré-cadastro' : (c.statusAprovacao || 'aprovado'),c.statusAprovacao === 'aprovado' ? 'ok' : ['pendente','pre_cadastro'].includes(c.statusAprovacao) ? 'warn' : 'danger')}</td>
              <td>${Auth.isManager() ? `<button class="btn btn--ghost btn--sm" data-transfer="${c.id}">Transferir</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.getElementById('op-new-customer')?.addEventListener('click', () => openOperationalCustomerForm(tables, sellers));
  root.querySelectorAll('[data-approve-client]').forEach(b => b.onclick = () => approveClient(b.dataset.approveClient, tables));
  root.querySelectorAll('[data-reject-client]').forEach(b => b.onclick = () => rejectClient(b.dataset.rejectClient));
  root.querySelectorAll('[data-transfer]').forEach(b => b.onclick = () => transferClient(b.dataset.transfer, customers, sellers));
}

function openOperationalCustomerForm(tables, sellers) {
  openModal('Adicionar cliente', `
    <div class="form-grid">
      <div class="field"><label>Nome / Fantasia</label><input class="input" id="oc-name" required></div>
      <div class="field"><label>Razão social</label><input class="input" id="oc-razao"></div>
      <div class="field"><label>CNPJ</label><input class="input" id="oc-cnpj"></div>
      <div class="field"><label>Inscrição estadual</label><input class="input" id="oc-ie"></div>
      <div class="field"><label>WhatsApp</label><input class="input" id="oc-whatsapp"></div>
      <div class="field"><label>E-mail</label><input class="input" id="oc-email"></div>
      <div class="field field--full"><label>Endereço</label><input class="input" id="oc-address"></div>
      <div class="field"><label>Bairro</label><input class="input" id="oc-bairro"></div>
      <div class="field"><label>Cidade</label><input class="input" id="oc-city"></div>
      <div class="field"><label>UF</label><input class="input" id="oc-uf" maxlength="2"></div>
      <div class="field"><label>Região</label><input class="input" id="oc-region" placeholder="Ex.: Curitiba Norte"></div>
      <div class="field"><label>Vendedor responsável</label><select class="input" id="oc-seller"><option value="">Sem vendedor</option>${sellers.filter(s=>s.ativo).map(s=>`<option value="${s.id}" data-name="${escapeHTML(s.nome)}">${escapeHTML(s.nome)}</option>`).join('')}</select></div>
      <div class="field"><label>Classificação</label><select class="input" id="oc-class"><option value="Verde">Verde</option><option value="Amarelo">Amarelo</option></select></div>
      <div class="field"><label>Tabela de preço</label><select class="input" id="oc-table"><option value="">Sem tabela definida</option>${tables.filter(t=>t.ativo!==false).map(t=>`<option value="${t.id}">${escapeHTML(t.nome)}</option>`).join('')}</select></div>
      <div class="field field--full"><label>Observações</label><textarea class="input" id="oc-obs" rows="3"></textarea></div>
    </div>
    <div class="notice-aion" style="margin-top:12px">Clientes cadastrados pela operação entram aprovados. A classificação Verde libera boleto; Amarelo libera apenas Pix e Dinheiro.</div>
    <div class="form-actions"><button class="btn btn--ghost" id="oc-cancel">Cancelar</button><button class="btn btn--primary" id="oc-save">Cadastrar cliente</button></div>
  `, { wide:true });

  document.getElementById('oc-cancel').onclick = closeModal;
  document.getElementById('oc-save').onclick = async () => {
    const sellerSelect = document.getElementById('oc-seller');
    const vendedorId = sellerSelect.value || null;
    const vendedorNome = vendedorId ? sellerSelect.options[sellerSelect.selectedIndex].text : '';
    const body = {
      nome: document.getElementById('oc-name').value.trim(),
      razaoSocial: document.getElementById('oc-razao').value.trim(),
      cnpj: document.getElementById('oc-cnpj').value.trim(),
      inscricaoEstadual: document.getElementById('oc-ie').value.trim(),
      whatsapp: document.getElementById('oc-whatsapp').value.trim(),
      email: document.getElementById('oc-email').value.trim(),
      endereco: document.getElementById('oc-address').value.trim(),
      bairro: document.getElementById('oc-bairro').value.trim(),
      cidade: document.getElementById('oc-city').value.trim(),
      uf: document.getElementById('oc-uf').value.trim().toUpperCase(),
      regiao: document.getElementById('oc-region').value.trim(),
      vendedorId, vendedorNome,
      classificacao: document.getElementById('oc-class').value,
      tabelaPrecoId: document.getElementById('oc-table').value || null,
      observacoes: document.getElementById('oc-obs').value.trim()
    };
    if (!body.nome) return toast('Informe o nome do cliente.', 'warn');
    try {
      await commercialFetch('/customers', { method:'POST', body });
      closeModal(); toast('Cliente cadastrado.', 'success'); navigate('commercialCustomers');
    } catch(e) { toast(e.message, 'error'); }
  };
}

async function renderCommercialOrders(root) {
  const orders = await commercialFetch('/orders');
  const pending = orders.filter(o => o.status === 'enviado');
  root.innerHTML = `
    <div class="dashboard-welcome">
      <div>
        <span class="dashboard-welcome__eyebrow">Life Vendas · Pedidos</span>
        <h1>Pedidos</h1>
        <p>Vendedores, operadores e gerentes podem registrar pedidos. A operação continua responsável pela aprovação.</p>
      </div>
      <div class="page-head-actions">
        <button class="btn btn--primary" id="op-new-order"><span class="action-icon">＋</span> Adicionar pedido</button>
        <div class="dashboard-welcome__status"><span class="online">${pending.length} aguardando</span></div>
      </div>
    </div>
    <div class="card table-wrap">
      <table class="data">
        <thead><tr><th>Pedido / NF</th><th>Cliente</th><th>Vendedor</th><th>Pagamento</th><th>Total</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td><strong>${escapeHTML(o.numero)}</strong>${o.nfNumero ? `<br><span class="hint">NF ${escapeHTML(o.nfNumero)}</span>` : ''}<br><span class="hint">${fmtDateTime(o.criadoEm)}</span></td>
              <td>${escapeHTML(o.clienteNome)}</td>
              <td>${escapeHTML(o.vendedorNome || '—')}</td>
              <td>${escapeHTML(o.formaPagamento)}${o.prazoBoletoDias ? `<br><span class="hint">${o.prazoBoletoDias} dias</span>` : ''}</td>
              <td>${brl(o.total)}</td>
              <td>${statusStamp(o.status,o.status === 'aprovado' || o.status === 'separacao' ? 'ok' : o.status === 'enviado' ? 'warn' : o.status === 'reprovado' ? 'danger' : 'info')}</td>
              <td><button class="btn btn--ghost btn--sm" data-view-order="${o.id}">Ver</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.getElementById('op-new-order')?.addEventListener('click', openOperationalOrderForm);
  root.querySelectorAll('[data-view-order]').forEach(b => b.onclick = () => orderModal(orders.find(o => o.id === b.dataset.viewOrder)));
}

async function openOperationalOrderForm() {
  const [customers, tables, stock, sellers] = await Promise.all([
    commercialFetch('/customers'),
    commercialFetch('/price-tables'),
    commercialFetch('/stock'),
    commercialFetch('/sellers')
  ]);
  const clients = customers.filter(c => c.statusAprovacao === 'aprovado' && c.ativo !== false);
  let items = [];

  openModal('Adicionar pedido', `
    <div class="form-grid">
      <div class="field"><label>Cliente</label><select class="input" id="oo-client"><option value="">Selecione…</option>${clients.map(c=>`<option value="${c.id}">${escapeHTML(c.nome)} · ${escapeHTML(c.classificacao || '')}</option>`).join('')}</select></div>
      <div class="field"><label>Vendedor</label><select class="input" id="oo-seller"><option value="">Usar vendedor do cliente</option>${sellers.filter(s=>s.ativo).map(s=>`<option value="${s.id}">${escapeHTML(s.nome)}</option>`).join('')}</select></div>
      <div class="field"><label>Tabela de preço</label><select class="input" id="oo-table"><option value="">Selecione o cliente primeiro</option></select></div>
      <div class="field"><label>Forma de pagamento</label><select class="input" id="oo-payment"><option>Pix</option><option>Dinheiro</option></select></div>
      <div class="field"><label>Nº NF (opcional)</label><input class="input" id="oo-nf" placeholder="Pode ser preenchido depois"></div>
      <div class="field"><label>Fornecedor (opcional)</label><input class="input" id="oo-supplier" placeholder="Para filtro do romaneio"></div>
      <div class="field field--full"><label>Observações</label><textarea class="input" id="oo-obs" rows="3"></textarea></div>
    </div>

    <div class="section-title">Adicionar itens</div>
    <div class="form-grid form-grid--3">
      <div class="field"><label>Produto</label><select class="input" id="oo-product"><option value="">Selecione…</option>${stock.map(p=>`<option value="${p.id}">${escapeHTML(productSelectLabel(p, { includeCode:true }))} · ${fmtNumber(p.disponivel)} un.</option>`).join('')}</select></div>
      <div class="field"><label>Quantidade</label><input class="input" id="oo-qty" type="number" min="1" value="1"></div>
      <div class="field"><label>Unidade</label><select class="input" id="oo-unit"><option>Unidade</option><option>Fardo</option><option>Pallet</option><option>Meio Pallet</option></select></div>
      <div class="field"><label>Preço unitário (opcional)</label><input class="input" id="oo-price" type="number" min="0" step="0.01" placeholder="Usa tabela se vazio"></div>
      <div class="field field--full"><button class="btn btn--ghost" id="oo-add-item" type="button">＋ Adicionar item</button></div>
    </div>
    <div class="table-wrap" style="margin-top:12px"><table class="data"><thead><tr><th>Produto</th><th>Qtd.</th><th>Unidade</th><th>Preço manual</th><th></th></tr></thead><tbody id="oo-items"></tbody></table></div>
    <div class="notice-aion" id="oo-pay-hint" style="margin-top:12px">Selecione o cliente para validar classificação e pagamento.</div>
    <div class="form-actions"><button class="btn btn--ghost" id="oo-cancel">Cancelar</button><button class="btn btn--primary" id="oo-save">Criar pedido</button></div>
  `, { wide:true });

  const redrawItems = () => {
    const tbody = document.getElementById('oo-items');
    tbody.innerHTML = items.length ? items.map((i,idx)=>`<tr><td>${escapeHTML(i.nome)}</td><td>${fmtNumber(i.quantidade)}</td><td>${escapeHTML(i.unidadeMovimentacao)}</td><td>${i.precoUnitario !== undefined ? brl(i.precoUnitario) : 'Tabela'}</td><td><button class="btn btn--ghost btn--sm" type="button" data-oo-remove="${idx}">Remover</button></td></tr>`).join('') : `<tr><td colspan="5"><div class="empty-state" style="padding:18px">Nenhum item adicionado.</div></td></tr>`;
    tbody.querySelectorAll('[data-oo-remove]').forEach(b => b.onclick = () => { items.splice(Number(b.dataset.ooRemove),1); redrawItems(); });
  };
  redrawItems();

  document.getElementById('oo-client').onchange = () => {
    const c = clients.find(x => x.id === document.getElementById('oo-client').value);
    const allowedTables = tables.filter(t => t.ativo !== false && (t.tipo !== 'personalizada' || t.clienteId === c?.id));
    document.getElementById('oo-table').innerHTML = `<option value="">Selecione…</option>` + allowedTables.map(t=>`<option value="${t.id}" ${t.id === c?.tabelaPrecoId ? 'selected' : ''}>${escapeHTML(t.nome)}</option>`).join('');
    const allowedPayments = c?.classificacao === 'Verde' ? ['Pix','Dinheiro','Boleto'] : ['Pix','Dinheiro'];
    document.getElementById('oo-payment').innerHTML = allowedPayments.map(p=>`<option>${p}</option>`).join('');
    document.getElementById('oo-pay-hint').innerHTML = c?.classificacao === 'Verde'
      ? '<strong>Cliente Verde:</strong> Pix, Dinheiro e Boleto. Boleto de R$150 a R$299 = 7 dias; R$300+ = 14 dias.'
      : '<strong>Cliente Amarelo:</strong> somente Pix e Dinheiro.';
    const seller = sellers.find(s => s.id === c?.vendedorId);
    if (seller) document.getElementById('oo-seller').value = seller.id;
  };

  document.getElementById('oo-add-item').onclick = () => {
    const p = stock.find(x => x.id === document.getElementById('oo-product').value);
    const quantidade = Number(document.getElementById('oo-qty').value || 0);
    if (!p) return toast('Selecione um produto.', 'warn');
    if (!(quantidade > 0)) return toast('Informe a quantidade.', 'warn');
    const priceRaw = document.getElementById('oo-price').value;
    const item = { produtoId:p.id, nome:p.nome, quantidade, unidadeMovimentacao:document.getElementById('oo-unit').value };
    if (priceRaw !== '') item.precoUnitario = Number(priceRaw);
    items.push(item); redrawItems();
    document.getElementById('oo-qty').value = '1'; document.getElementById('oo-price').value = '';
  };
  document.getElementById('oo-cancel').onclick = closeModal;
  document.getElementById('oo-save').onclick = async () => {
    if (!items.length) return toast('Adicione pelo menos um item.', 'warn');
    const sellerSelect = document.getElementById('oo-seller');
    const seller = sellers.find(s => s.id === sellerSelect.value);
    const body = {
      clienteId: document.getElementById('oo-client').value,
      vendedorId: seller?.id || null,
      vendedorNome: seller?.nome || '',
      tabelaPrecoId: document.getElementById('oo-table').value,
      formaPagamento: document.getElementById('oo-payment').value,
      nfNumero: document.getElementById('oo-nf').value.trim(),
      fornecedorNome: document.getElementById('oo-supplier').value.trim(),
      observacoes: document.getElementById('oo-obs').value.trim(),
      itens: items.map(({nome,...rest}) => rest)
    };
    if (!body.clienteId || !body.tabelaPrecoId) return toast('Selecione cliente e tabela de preço.', 'warn');
    try {
      const saved = await commercialFetch('/orders', { method:'POST', body });
      closeModal(); toast(`Pedido ${saved.numero} criado e enviado para aprovação.`, 'success'); navigate('commercialOrders');
    } catch(e) { toast(e.message, 'error'); }
  };
}

function orderModal(o) {
  openModal(`Pedido ${escapeHTML(o.numero)}`, `
    <div class="info-strip"><strong>${escapeHTML(o.clienteNome)}</strong> · ${escapeHTML(o.vendedorNome || '')} · ${brl(o.total)}</div>
    ${o.nfNumero ? `<div class="notice-aion" style="margin-top:10px"><strong>NF:</strong> ${escapeHTML(o.nfNumero)}</div>` : ''}
    <div class="table-wrap" style="margin-top:12px"><table class="data"><thead><tr><th>Produto</th><th>Qtd.</th><th>Preço/un.</th><th>Subtotal</th></tr></thead><tbody>${(o.itens || []).map(i=>`<tr><td>${escapeHTML(i.produtoNome)}</td><td>${i.quantidade} ${escapeHTML(i.unidadeMovimentacao)}</td><td>${brl(i.precoUnitario)}</td><td>${brl(i.subtotal)}</td></tr>`).join('')}</tbody></table></div>
    <div class="notice-aion" style="margin-top:12px"><strong>Pagamento:</strong> ${escapeHTML(o.formaPagamento)} ${o.prazoBoletoDias ? `· boleto ${o.prazoBoletoDias} dias` : ''}<br><strong>Observações:</strong> ${escapeHTML(o.observacoes || '—')}</div>
    ${o.status === 'enviado' ? `<div class="form-actions" style="flex-wrap:wrap"><button class="btn btn--danger" id="ord-reject">Reprovar</button><button class="btn btn--ghost" id="ord-rework">Refazer</button><button class="btn btn--ghost" id="ord-edit">Alterar</button><button class="btn btn--primary" id="ord-approve">Aprovar pedido</button></div>` : ''}
  `, { wide:true });
  if (o.status !== 'enviado') return;
  document.getElementById('ord-approve').onclick = async () => {
    if (!await confirmDialog('Aprovar o pedido? O estoque será baixado e a NF ficará aguardando seleção manual na aba Separação para gerar o romaneio.')) return;
    try {
      await commercialFetch(`/orders/${o.id}/approve`, { method:'POST', body:{} });
      closeModal(); toast('Pedido aprovado. Agora selecione a NF na aba Separação para gerar o romaneio.', 'success'); navigate('commercialOrders');
    } catch(e) { toast(e.message,'error'); }
  };
  document.getElementById('ord-reject').onclick = () => orderObservationAction(o,'reject','Reprovar pedido');
  document.getElementById('ord-rework').onclick = () => orderObservationAction(o,'rework','Enviar para refazer');
  document.getElementById('ord-edit').onclick = () => editOrderModal(o);
}

function separationMetaFor(order, customers) {
  const c = customers.find(x => x.id === order.clienteId) || {};
  const m = order.separationMeta || {};
  return {
    nf: m.nfNumero || order.nfNumero || order.numero,
    fornecedor: m.fornecedor || order.fornecedorNome || c.fornecedor || '',
    cidade: m.cidade || c.cidade || '',
    bairro: m.bairro || c.bairro || '',
    regiao: m.regiao || c.regiao || '',
    vendedor: m.vendedor || order.vendedorNome || c.vendedorNome || '',
    cliente: m.cliente || order.clienteNome || c.nome || ''
  };
}

async function renderSeparation(root) {
  const [available, manifests, customers] = await Promise.all([
    commercialFetch('/separation/available'),
    commercialFetch('/separation/manifests'),
    commercialFetch('/customers')
  ]);
  const rows = available.map(order => ({ order, meta: separationMetaFor(order, customers) }));

  root.innerHTML = `
    <div class="dashboard-welcome">
      <div><span class="dashboard-welcome__eyebrow">Expedição · Romaneio manual</span><h1>Separação</h1><p>O romaneio não é mais criado automaticamente. Escolha exatamente quais NFs irão juntas e só então gere o documento consolidado.</p></div>
      <div class="dashboard-welcome__status"><span class="online">${available.length} NF(s) disponível(is)</span></div>
    </div>

    <div class="card separation-builder">
      <div class="separation-builder__head">
        <div><h3>Selecionar NFs para o romaneio</h3><p class="hint">Use os filtros para montar a carga/rota antes de gerar o documento.</p></div>
        <div class="selection-summary" id="sep-selection-summary">0 NF selecionada · 0 un.</div>
      </div>
      <div class="filters separation-filters">
        <div class="field"><label>Buscar nº NF</label><input class="input" id="sep-nf-search" placeholder="Digite o número"></div>
        <div class="field"><label>Fornecedor</label><select class="input" id="sep-supplier">${selectOptions(rows.map(r=>r.meta.fornecedor))}</select></div>
        <div class="field"><label>Cidade</label><select class="input" id="sep-city">${selectOptions(rows.map(r=>r.meta.cidade))}</select></div>
        <div class="field"><label>Bairro</label><select class="input" id="sep-neighborhood">${selectOptions(rows.map(r=>r.meta.bairro))}</select></div>
        <div class="field"><label>Região</label><select class="input" id="sep-region">${selectOptions(rows.map(r=>r.meta.regiao))}</select></div>
        <div class="field"><label>Vendedor</label><select class="input" id="sep-seller">${selectOptions(rows.map(r=>r.meta.vendedor))}</select></div>
      </div>
      <div class="table-wrap">
        <table class="data separation-table">
          <thead><tr><th></th><th>NF</th><th>Cliente</th><th>Cidade / Bairro</th><th>Região</th><th>Vendedor</th><th>Fornecedor</th><th>Unidades</th></tr></thead>
          <tbody id="sep-available-body"></tbody>
        </table>
      </div>
      <div class="form-actions"><button class="btn btn--primary" id="make-manifest" disabled>Gerar romaneio com NFs selecionadas</button></div>
    </div>

    <div class="section-title">Romaneios gerados</div>
    <div class="grid grid--2">
      ${manifests.map(m=>`<div class="card"><div style="display:flex;justify-content:space-between;gap:12px"><div><h3>${escapeHTML(m.numero)}</h3><p class="hint">${fmtDate(m.data)} · ${(m.orderIds || []).length} NF/pedido(s)</p></div>${statusStamp(m.status || 'aberto','info')}</div><div class="form-actions"><button class="btn btn--ghost" data-manifest="${m.id}">Visualizar / PDF</button>${m.status === 'aberto' ? `<button class="btn btn--primary" data-close-manifest="${m.id}">Fechar romaneio</button>` : ''}</div></div>`).join('') || '<div class="card">Nenhum romaneio gerado.</div>'}
    </div>`;

  const selectedIds = new Set();
  const rowMatches = ({meta}) => {
    const nf = document.getElementById('sep-nf-search').value.trim().toLowerCase();
    const supplier = document.getElementById('sep-supplier').value;
    const city = document.getElementById('sep-city').value;
    const neighborhood = document.getElementById('sep-neighborhood').value;
    const region = document.getElementById('sep-region').value;
    const seller = document.getElementById('sep-seller').value;
    return (!nf || meta.nf.toLowerCase().includes(nf)) && (!supplier || meta.fornecedor === supplier) && (!city || meta.cidade === city) && (!neighborhood || meta.bairro === neighborhood) && (!region || meta.regiao === region) && (!seller || meta.vendedor === seller);
  };
  const updateSummary = () => {
    const selectedRows = rows.filter(r => selectedIds.has(r.order.id));
    const units = selectedRows.reduce((acc,r)=>acc+(r.order.itens || []).reduce((s,i)=>s+Number(i.quantidadeUnidades || 0),0),0);
    document.getElementById('sep-selection-summary').textContent = `${selectedRows.length} NF selecionada(s) · ${fmtNumber(units)} un.`;
    document.getElementById('make-manifest').disabled = selectedRows.length === 0;
  };
  const drawRows = () => {
    const filtered = rows.filter(rowMatches);
    document.getElementById('sep-available-body').innerHTML = filtered.length ? filtered.map(({order,meta})=>{
      const units=(order.itens || []).reduce((a,i)=>a+Number(i.quantidadeUnidades || 0),0);
      return `<tr><td><input type="checkbox" data-sep-order="${order.id}" ${selectedIds.has(order.id)?'checked':''}></td><td class="cell-mono"><strong>${escapeHTML(meta.nf)}</strong></td><td>${escapeHTML(meta.cliente)}</td><td>${escapeHTML([meta.cidade,meta.bairro].filter(Boolean).join(' · ') || '—')}</td><td>${escapeHTML(meta.regiao || '—')}</td><td>${escapeHTML(meta.vendedor || '—')}</td><td>${escapeHTML(meta.fornecedor || '—')}</td><td class="cell-mono">${fmtNumber(units)}</td></tr>`;
    }).join('') : `<tr><td colspan="8"><div class="empty-state"><p>Nenhuma NF corresponde aos filtros.</p></div></td></tr>`;
    document.querySelectorAll('[data-sep-order]').forEach(cb => cb.onchange = () => { cb.checked ? selectedIds.add(cb.dataset.sepOrder) : selectedIds.delete(cb.dataset.sepOrder); updateSummary(); });
  };
  ['sep-nf-search','sep-supplier','sep-city','sep-neighborhood','sep-region','sep-seller'].forEach(id => {
    const el = document.getElementById(id); el.addEventListener(id === 'sep-nf-search' ? 'input' : 'change', drawRows);
  });
  drawRows(); updateSummary();

  document.getElementById('make-manifest').onclick = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return toast('Selecione pelo menos uma NF.', 'warn');
    try {
      const m = await commercialFetch('/separation/manifests', { method:'POST', body:{orderIds:ids} });
      toast(`Romaneio ${m.numero} gerado com ${ids.length} NF(s).`, 'success');
      await renderSeparation(root);
      manifestModal(m, true);
    } catch(e) { toast(e.message, 'error'); }
  };
  root.querySelectorAll('[data-manifest]').forEach(b => b.onclick = () => manifestModal(manifests.find(m => m.id === b.dataset.manifest)));
  root.querySelectorAll('[data-close-manifest]').forEach(b => b.onclick = async () => {
    if (!await confirmDialog('Fechar este romaneio?')) return;
    try { await commercialFetch(`/separation/manifests/${b.dataset.closeManifest}/close`,{method:'POST',body:{}}); toast('Romaneio fechado.','success'); navigate('separation'); }
    catch(e){ toast(e.message,'error'); }
  });
}

function manifestConversionText(c) {
  return [c.pallets ? `${c.pallets} pallet(s)` : null,c.meioPallets ? `${c.meioPallets} meio pallet` : null,c.fardos ? `${c.fardos} ${(c.nomeFardo || 'Fardo').toLowerCase()}(s)` : null,c.unidades ? `${c.unidades} un.` : null].filter(Boolean).join(' + ') || '0';
}

function manifestModal(m, autoPreview = false) {
  openModal(`Romaneio ${escapeHTML(m.numero)}`, `
    <div id="manifest-print">
      <h2>Life Sucos · Romaneio de Separação</h2>
      <p><strong>${escapeHTML(m.numero)}</strong> · ${fmtDate(m.data)} · ${(m.orderIds || []).length} NF(s)</p>
      <h3>Total consolidado para separar</h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>Cód.</th><th>Produto</th><th>Total</th><th>Conversão operacional</th></tr></thead><tbody>${(m.totais || []).map(i=>`<tr><td>${escapeHTML(i.codigoInterno || '')}</td><td>${escapeHTML(i.produtoNome)}</td><td><strong>${fmtNumber(i.quantidadeUnidades)} un.</strong></td><td>${escapeHTML(manifestConversionText(i.conversao || {}))}</td></tr>`).join('')}</tbody></table></div>
      <h3 style="margin-top:18px">NFs selecionadas</h3>
      ${(m.pedidos || []).map(p=>`<div class="manifest-nf"><strong>NF ${escapeHTML(p.nfNumero)} · ${escapeHTML(p.cliente)}</strong>${(p.itens || []).map(i=>`<div>${escapeHTML(i.codigoInterno || '')} · ${escapeHTML(i.produtoNome)} — ${fmtNumber(i.quantidadeUnidades)} un.</div>`).join('')}</div>`).join('')}
    </div>
    <div class="form-actions manifest-actions"><button class="btn btn--ghost" id="manifest-preview">Visualizar PDF</button><button class="btn btn--ghost" id="manifest-print-pdf">Imprimir</button><button class="btn btn--primary" id="manifest-save-pdf">Salvar PDF</button></div>
  `,{wide:true});
  document.getElementById('manifest-preview').onclick = () => generateManifestPDF(m,'preview');
  document.getElementById('manifest-print-pdf').onclick = () => generateManifestPDF(m,'print');
  document.getElementById('manifest-save-pdf').onclick = () => generateManifestPDF(m,'save');
  if (autoPreview) setTimeout(() => generateManifestPDF(m,'preview'), 150);
}

function buildManifestPDFDoc(m) {
  if (typeof window.jspdf === 'undefined') throw new Error('Biblioteca de PDF ainda não está disponível.');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait' });
  doc.setFontSize(16); doc.text('Life Sucos · Romaneio de Separação',14,16);
  doc.setFontSize(9); doc.setTextColor(90); doc.text(`${m.numero} · ${fmtDate(m.data)} · ${(m.orderIds || []).length} NF(s)`,14,23);
  doc.autoTable({
    startY:29,
    head:[['Cód.','Produto','Total un.','Pallet','Meio pallet','Fardo/Caixa','Unidades']],
    body:(m.totais || []).map(i=>[i.codigoInterno || '',i.produtoNome,String(i.quantidadeUnidades),String(i.conversao?.pallets || 0),String(i.conversao?.meioPallets || 0),`${i.conversao?.fardos || 0} ${i.conversao?.nomeFardo || 'Fardo'}`,String(i.conversao?.unidades || 0)]),
    styles:{fontSize:7.5}, headStyles:{fillColor:[47,125,50]}
  });
  let y = doc.lastAutoTable.finalY + 10;
  doc.setTextColor(35); doc.setFontSize(12); doc.text('Detalhamento por NF',14,y); y += 6;
  for (const p of (m.pedidos || [])) {
    if (y > 265) { doc.addPage(); y = 18; }
    doc.setFontSize(9.5); doc.setFont(undefined,'bold'); doc.text(`NF ${p.nfNumero} · ${p.cliente}`,14,y); doc.setFont(undefined,'normal'); y += 5;
    for (const i of (p.itens || [])) {
      if (y > 280) { doc.addPage(); y = 18; }
      doc.setFontSize(8); doc.text(`${i.codigoInterno || ''} · ${i.produtoNome} — ${i.quantidadeUnidades} un.`,18,y); y += 4.5;
    }
    y += 3;
  }
  return doc;
}

function generateManifestPDF(m, mode = 'save') {
  try {
    const doc = buildManifestPDFDoc(m);
    if (mode === 'save') {
      doc.save(`romaneio-${m.numero}.pdf`);
      return;
    }
    if (mode === 'print') doc.autoPrint();
    const url = doc.output('bloburl');
    const win = window.open(url,'_blank');
    if (!win) toast('O navegador bloqueou a janela do PDF. Use o botão Salvar PDF.', 'warn');
  } catch(e) { toast(e.message || 'Não foi possível gerar o PDF.', 'error'); }
}
