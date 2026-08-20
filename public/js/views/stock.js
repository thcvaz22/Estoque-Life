/* ============================================================
   VIEWS/STOCK.JS — Estoque (visão por lote) + agregador central
   computeStockSummary() é usado pelo Dashboard, Produtos e Relatórios.
   ============================================================ */

async function computeStockSummary() {
  const [products, lots] = await Promise.all([DB.all('products'), DB.all('lots')]);
  return products.map(product => {
    const productLots = lots.filter(l => l.productId === product.id);
    return {
      product,
      lots: productLots,
      totalDisponivel: productLots.reduce((a, l) => a + Number(l.quantidadeDisponivel || 0), 0),
      totalBloqueada: productLots.reduce((a, l) => a + Number(l.quantidadeBloqueada || 0), 0)
    };
  });
}

async function renderStock(root) {
  const canAdjust = !!(typeof Auth !== 'undefined' && Auth.isManager && Auth.isManager());
  const summary = await computeStockSummary();
  const rows = [];
  summary.forEach(s => {
    if (s.lots.length === 0) {
      rows.push({ product: s.product, lot: null });
    } else {
      s.lots.forEach(l => rows.push({ product: s.product, lot: l }));
    }
  });

  root.innerHTML = `
    <div class="view-head">
      <p class="subtitle">${rows.length} lote(s) em ${summary.length} produto(s)</p>
      <div style="display:flex;gap:8px">
        <button class="btn" id="export-stock-csv">⬇️ CSV</button>
        <button class="btn" id="export-stock-pdf">🖨️ PDF</button>
      </div>
    </div>
    <div class="filters">
      <div class="field" style="min-width:220px"><label>Buscar produto</label><input class="input" id="f-text"></div>
      <div class="field"><label>Situação da validade</label>
        <select class="input" id="f-val">
          <option value="">Todas</option>
          <option value="ok">Dentro do prazo</option>
          <option value="warn">Próximo ao vencimento (≤30d)</option>
          <option value="danger">Vencido</option>
        </select>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th>Produto</th><th>Lote</th><th>Disponível</th><th>Bloqueado</th><th>Validade</th><th>Dias restantes</th><th>Localização</th><th></th>
        </tr></thead>
        <tbody id="stock-tbody"></tbody>
      </table>
    </div>
  `;

  function draw(list) {
    const tbody = document.getElementById('stock-tbody');
    if (list.length === 0) { tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="big">📦</div><p>Nenhum item encontrado.</p></div></td></tr>`; return; }
    tbody.innerHTML = list.map(({ product, lot }) => {
      const v = lot ? validadeState(lot.validade) : { label: '—', kind: 'neutral' };
      return `<tr>
        <td><strong>${escapeHTML(product.nome)}</strong><br><span style="font-size:11px;color:var(--ink-soft)">${escapeHTML(product.marca)} · ${escapeHTML(product.volume)}</span></td>
        <td class="cell-mono">${escapeHTML(lot?.lote || '—')}</td>
        <td class="cell-mono">${fmtNumber(lot?.quantidadeDisponivel || 0)}</td>
        <td class="cell-mono">${fmtNumber(lot?.quantidadeBloqueada || 0)}</td>
        <td>${fmtDate(lot?.validade)}</td>
        <td>${statusStamp(v.label, v.kind)}</td>
        <td style="font-size:12px">${escapeHTML(lot?.localizacao || product.localizacao || '—')}</td>
        <td class="row-actions">${lot ? `<button class="icon-btn" data-edit-lot="${lot.id}" title="${canAdjust ? 'Editar dados / fazer ajuste de estoque' : 'Editar dados do lote'}">✏️</button>` : ''}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-edit-lot]').forEach(b => b.onclick = () => openLotEditor(b.dataset.editLot));
  }
  draw(rows);

  const applyFilters = () => {
    const term = document.getElementById('f-text').value.toLowerCase();
    const valFilter = document.getElementById('f-val').value;
    draw(rows.filter(r => {
      const okText = !term || r.product.nome.toLowerCase().includes(term);
      const okVal = !valFilter || (r.lot && validadeState(r.lot.validade).kind === valFilter);
      return okText && (valFilter ? okVal : true);
    }));
  };
  document.getElementById('f-text').addEventListener('input', debounce(applyFilters, 200));
  document.getElementById('f-val').addEventListener('change', applyFilters);

  const headers = [
    { label: 'Produto', get: r => r.product.nome },
    { label: 'Lote', get: r => r.lot?.lote || '' },
    { label: 'Disponível', get: r => r.lot?.quantidadeDisponivel || 0 },
    { label: 'Bloqueado', get: r => r.lot?.quantidadeBloqueada || 0 },
    { label: 'Validade', get: r => fmtDate(r.lot?.validade) },
    { label: 'Localização', get: r => r.lot?.localizacao || r.product.localizacao || '' }
  ];
  document.getElementById('export-stock-csv').onclick = () => exportCSVReport('Estoque', headers, rows);
  document.getElementById('export-stock-pdf').onclick = () => exportPDF('Estoque', headers, rows, { subtitle: `Gerado em ${fmtDateTime(new Date().toISOString())}` });
}

async function openLotEditor(lotId) {
  const lot = await DB.get('lots', lotId);
  const product = await DB.get('products', lot.productId);
  const canAdjust = !!(typeof Auth !== 'undefined' && Auth.isManager && Auth.isManager());

  openModal(`Lote · ${escapeHTML(product.nome)}`, `
    <div class="section-title" style="margin-top:0">Dados do lote</div>
    <p class="hint">Edite identificação, fabricação, validade e localização. Alterações de quantidade ficam registradas separadamente como ajuste de estoque.</p>
    <div class="form-grid form-grid--3">
      <div class="field field--full"><label>Lote</label><input class="input" id="l-lote" value="${escapeHTML(lot.lote)}"></div>
      <div class="field"><label>Fabricação</label><input class="input" type="date" id="l-fab" value="${lot.fabricacao || ''}"></div>
      <div class="field"><label>Validade</label><input class="input" type="date" id="l-val" value="${lot.validade || ''}"></div>
      <div class="field field--full"><label>Localização</label><input class="input" id="l-loc" value="${escapeHTML(lot.localizacao || '')}"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn--ghost" id="l-close-top">Fechar</button>
      <button class="btn btn--primary" id="l-save">Salvar dados do lote</button>
    </div>

    <div class="divider"></div>

    ${canAdjust ? `
      <div class="section-title">Fazer ajuste manual de estoque</div>
      <p class="hint">Ação restrita ao perfil <strong>Gerente</strong>. Disponível atual: <strong>${fmtNumber(lot.quantidadeDisponivel)}</strong> · Bloqueado atual: <strong>${fmtNumber(lot.quantidadeBloqueada)}</strong></p>
      <div class="form-grid form-grid--3">
        <div class="field">
          <label>Tipo</label>
          <select class="input" id="adj-tipo">
            <option value="entrada">Entrada (soma ao disponível)</option>
            <option value="saida">Saída (retira do disponível)</option>
          </select>
        </div>
        <div class="field"><label>Quantidade</label><input class="input" type="number" min="1" id="adj-qtd"></div>
        <div class="field"><label>Motivo</label><input class="input" id="adj-motivo" placeholder="Obrigatório"></div>
        <div class="field field--full"><label>Observações</label><input class="input" id="adj-obs"></div>
      </div>
      <div class="form-actions">
        <button class="btn btn--danger" id="adj-save">Confirmar ajuste</button>
      </div>
    ` : `
      <div class="card" style="box-shadow:none;background:var(--paper)">
        <strong>🔒 Ajuste manual restrito</strong>
        <p class="hint" style="margin:6px 0 0">Somente um Gerente pode alterar manualmente a quantidade de um lote. Entradas, saídas, inventários e avarias continuam disponíveis normalmente para Operadores.</p>
      </div>
    `}
  `, { wide: true });

  document.getElementById('l-close-top').onclick = closeModal;

  document.getElementById('l-save').onclick = async () => {
    try {
      await putStock(`/lots/${lotId}/meta`, {
        lote: document.getElementById('l-lote').value.trim(),
        fabricacao: document.getElementById('l-fab').value,
        validade: document.getElementById('l-val').value,
        localizacao: document.getElementById('l-loc').value.trim()
      });
      toast('Dados do lote atualizados.', 'success');
      closeModal();
      navigate('stock');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (!canAdjust) return;

  const adjBtn = document.getElementById('adj-save');
  adjBtn.onclick = async () => {
    if (!ensureServerOnlineForCriticalAction()) return;
    const quantidade = Number(document.getElementById('adj-qtd').value) || 0;
    const motivo = document.getElementById('adj-motivo').value.trim();
    if (quantidade <= 0) { toast('Informe uma quantidade maior que zero.', 'warn'); return; }
    if (!motivo) { toast('Informe o motivo do ajuste.', 'warn'); return; }
    try {
      await withBusyButton(adjBtn, 'Ajustando…', () => postStock('/adjust', {
        operationId: genOperationId(), lotId,
        tipo: document.getElementById('adj-tipo').value, quantidade, motivo,
        observacoes: document.getElementById('adj-obs').value.trim()
      }));
      toast('Ajuste de estoque aplicado.', 'success');
      closeModal();
      navigate('stock');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
