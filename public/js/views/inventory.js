/* ============================================================
   VIEWS/INVENTORY.JS — Modo de Inventário (otimizado para celular)
   Etapa 3: conta separadamente disponível e bloqueado; o ajuste
   (se houver divergência) é aplicado pelo servidor, identificado
   pelo inventário de origem — nunca um lote solto sem rastro.
   ============================================================ */

let _invSession = []; // {produtoId, produtoNome, esperadoDisponivel, contadoDisponivel, esperadoBloqueado, contadoBloqueado}

async function renderInventory(root) {
  const past = (await DB.all('inventories')).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 8);

  root.innerHTML = `
    <div class="view-head">
      <p class="subtitle">Contagem rápida por leitura de código de barras</p>
      <button class="btn btn--primary" id="inv-scan-btn">📷 Ler produto</button>
    </div>
    <div class="filters">
      <div class="field" style="min-width:220px"><label>Ou buscar por nome</label><input class="input" id="inv-search"></div>
    </div>
    <div id="inv-search-results"></div>

    <div class="section-title">Contagem atual (${_invSession.length})</div>
    <div class="table-wrap" style="margin-bottom:14px">
      <table class="data">
        <thead><tr><th>Produto</th><th>Disp. esperado</th><th>Disp. contado</th><th>Bloq. esperado</th><th>Bloq. contado</th><th>Divergência</th><th></th></tr></thead>
        <tbody id="inv-tbody"></tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:26px">
      <button class="btn" id="inv-clear">Limpar contagem</button>
      <button class="btn btn--primary" id="inv-confirm" ${_invSession.length === 0 ? 'disabled' : ''}>Confirmar ajustes e salvar inventário</button>
    </div>

    <div class="section-title">Inventários anteriores</div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Data</th><th>Itens</th><th>Divergências</th><th>Responsável</th></tr></thead>
        <tbody>
          ${past.length === 0 ? `<tr><td colspan="4"><div class="empty-state"><div class="big">📋</div><p>Nenhum inventário realizado ainda.</p></div></td></tr>` :
            past.map(p => `<tr><td>${fmtDateTime(p.data)}</td><td>${p.itens.length}</td><td>${p.itens.filter(i => i.esperadoDisponivel !== i.contadoDisponivel || i.esperadoBloqueado !== i.contadoBloqueado).length}</td><td>${escapeHTML(p.usuario)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  drawInvTable();

  document.getElementById('inv-scan-btn').onclick = () => openBarcodeScanner(async code => {
    const products = await DB.all('products');
    const p = products.find(x => x.codigoBarras === code);
    if (!p) { toast('Produto não encontrado para esse código.', 'warn'); return; }
    await addToInventorySession(p);
  });

  document.getElementById('inv-search').addEventListener('input', debounce(async (e) => {
    const term = e.target.value.toLowerCase();
    const box = document.getElementById('inv-search-results');
    if (term.length < 2) { box.innerHTML = ''; return; }
    const products = (await DB.all('products')).filter(p => p.ativo !== false);
    const matches = products.filter(p => p.nome.toLowerCase().includes(term)).slice(0, 6);
    box.innerHTML = matches.map(p => `<button class="pill" data-pick="${p.id}" style="margin:2px 6px 8px 0;cursor:pointer">${escapeHTML(p.nome)}</button>`).join('');
    box.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => {
      const p = matches.find(x => x.id === b.dataset.pick);
      await addToInventorySession(p);
      document.getElementById('inv-search').value = ''; box.innerHTML = '';
    });
  }, 250));

  document.getElementById('inv-clear').onclick = () => { _invSession = []; navigate('inventory'); };
  document.getElementById('inv-confirm').onclick = confirmInventoryAdjustments;
}

async function addToInventorySession(product) {
  const lots = await DB.byIndex('lots', 'productId', product.id);
  const esperadoDisponivel = lots.reduce((a, l) => a + Number(l.quantidadeDisponivel || 0), 0);
  const esperadoBloqueado = lots.reduce((a, l) => a + Number(l.quantidadeBloqueada || 0), 0);
  openModal(`Contagem · ${escapeHTML(product.nome)}`, `
    <p class="hint">No sistema: <strong>${fmtNumber(esperadoDisponivel)} un.</strong> disponíveis · <strong>${fmtNumber(esperadoBloqueado)} un.</strong> bloqueadas</p>
    <div class="form-grid">
      <div class="field"><label>Disponível encontrado</label><input class="input" type="number" min="0" id="inv-qtd-disp" value="${esperadoDisponivel}" autofocus></div>
      <div class="field"><label>Bloqueado encontrado</label><input class="input" type="number" min="0" id="inv-qtd-bloq" value="${esperadoBloqueado}"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn--ghost" id="inv-cancel">Cancelar</button>
      <button class="btn btn--primary" id="inv-ok">Adicionar à contagem</button>
    </div>
  `);
  document.getElementById('inv-cancel').onclick = closeModal;
  document.getElementById('inv-ok').onclick = () => {
    const contadoDisponivel = Number(document.getElementById('inv-qtd-disp').value) || 0;
    const contadoBloqueado = Number(document.getElementById('inv-qtd-bloq').value) || 0;
    _invSession = _invSession.filter(i => i.produtoId !== product.id);
    _invSession.push({ produtoId: product.id, produtoNome: product.nome, esperadoDisponivel, contadoDisponivel, esperadoBloqueado, contadoBloqueado });
    closeModal();
    navigate('inventory');
  };
}

function drawInvTable() {
  const tbody = document.getElementById('inv-tbody');
  if (!tbody) return;
  if (_invSession.length === 0) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>Nenhum item contado ainda nesta sessão.</p></div></td></tr>`; return; }
  tbody.innerHTML = _invSession.map((it, idx) => {
    const divDisp = it.contadoDisponivel - it.esperadoDisponivel;
    const divBloq = it.contadoBloqueado - it.esperadoBloqueado;
    const div = divDisp + divBloq;
    const kind = div === 0 ? 'ok' : (div < 0 ? 'danger' : 'warn');
    return `<tr>
      <td>${escapeHTML(it.produtoNome)}</td>
      <td class="cell-mono">${fmtNumber(it.esperadoDisponivel)}</td><td class="cell-mono">${fmtNumber(it.contadoDisponivel)}</td>
      <td class="cell-mono">${fmtNumber(it.esperadoBloqueado)}</td><td class="cell-mono">${fmtNumber(it.contadoBloqueado)}</td>
      <td>${statusStamp((div > 0 ? '+' : '') + fmtNumber(div), kind)}</td>
      <td><button class="icon-btn" data-rm="${idx}">🗑️</button></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { _invSession.splice(Number(b.dataset.rm), 1); navigate('inventory'); });
}

async function confirmInventoryAdjustments() {
  if (!ensureServerOnlineForCriticalAction()) return;
  const divergentes = _invSession.filter(i => i.contadoDisponivel !== i.esperadoDisponivel || i.contadoBloqueado !== i.esperadoBloqueado);
  const ok = await confirmDialog(`Salvar inventário com ${_invSession.length} item(ns), sendo ${divergentes.length} divergência(s)? Os ajustes serão aplicados ao estoque imediatamente pelo servidor.`);
  if (!ok) return;

  const confirmBtn = document.getElementById('inv-confirm');
  try {
    await withBusyButton(confirmBtn, 'Processando…', () => postStock('/inventory-adjustment', {
      operationId: genOperationId(), itens: _invSession
    }));
    toast('Inventário salvo e ajustes aplicados pelo servidor.', 'success');
    _invSession = [];
    navigate('inventory');
  } catch (err) {
    toast(err.message, 'error');
  }
}
