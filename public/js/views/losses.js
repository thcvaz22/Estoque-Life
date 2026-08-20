/* ============================================================
   VIEWS/LOSSES.JS — Avarias e Perdas
   Etapa 3: a baixa de estoque (com FEFO e validação) acontece no
   servidor via POST /api/stock/losses — a tela só monta o pedido.
   ============================================================ */

const LOSS_REASONS = ['Produto quebrado', 'Vazamento', 'Produto vencido', 'Produto danificado', 'Outro'];

async function renderLosses(root) {
  const losses = (await DB.all('losses')).sort((a, b) => b.data.localeCompare(a.data));
  const total30d = losses.filter(l => daysUntil(l.data) >= -30).reduce((a, l) => a + Number(l.quantidade || 0), 0);

  root.innerHTML = `
    <div class="view-head">
      <p class="subtitle">${losses.length} registro(s) · ${fmtNumber(total30d)} un. perdidas nos últimos 30 dias</p>
      <button class="btn btn--primary" id="new-loss-btn">+ Registrar avaria/perda</button>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Data</th><th>Produto</th><th>Qtd.</th><th>Origem</th><th>Motivo</th><th>Responsável</th></tr></thead>
        <tbody>
          ${losses.length === 0 ? `<tr><td colspan="6"><div class="empty-state"><div class="big">📦💥</div><p>Nenhuma avaria ou perda registrada.</p></div></td></tr>` :
            losses.map(l => `<tr>
              <td>${fmtDate(l.data)}</td><td>${escapeHTML(l.produtoNome)}</td><td class="cell-mono">${fmtNumber(l.quantidade)}</td>
              <td>${l.origem === 'bloqueado' ? statusStamp('Bloqueado', 'neutral') : statusStamp('Disponível', 'info')}</td>
              <td>${statusStamp(l.motivo, 'danger')}</td><td>${escapeHTML(l.responsavel)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('new-loss-btn').onclick = () => openLossForm();
}

async function openLossForm(state = {}) {
  const products = await DB.all('products');
  const ativos = products.filter(p => p.ativo !== false);
  const currentUser = await getCurrentUser();
  openModal('Registrar avaria ou perda', `
    <div class="form-grid">
      <div class="field field--full">
        <label>Produto</label>
        <select class="input" id="ls-produto">
          <option value="">Selecione…</option>
          ${ativos.map(p => `<option value="${p.id}" ${state.produtoId === p.id ? 'selected' : ''}>${escapeHTML(p.nome)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Quantidade</label><input class="input" type="number" min="1" id="ls-qtd" value="${escapeHTML(state.quantidade || '')}"></div>
      <div class="field">
        <label>Origem no estoque</label>
        <select class="input" id="ls-origem">
          <option value="disponivel" ${state.origem !== 'bloqueado' ? 'selected' : ''}>Estoque disponível</option>
          <option value="bloqueado" ${state.origem === 'bloqueado' ? 'selected' : ''}>Estoque bloqueado (backlog)</option>
        </select>
      </div>
      <div class="field">
        <label>Motivo</label>
        <select class="input" id="ls-motivo">${LOSS_REASONS.map(r => `<option ${state.motivo === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Data</label><input class="input" type="date" id="ls-data" value="${todayISO()}"></div>
      <div class="field"><label>Responsável (usuário logado)</label><input class="input" id="ls-resp" value="${escapeHTML(currentUser)}" readonly></div>
    </div>
    <div class="form-actions">
      <button class="btn btn--ghost" id="ls-cancel">Cancelar</button>
      <button class="btn btn--danger" id="ls-save">Registrar e baixar do estoque</button>
    </div>
  `);

  document.getElementById('ls-cancel').onclick = closeModal;
  const saveBtn = document.getElementById('ls-save');
  saveBtn.onclick = async () => {
    if (!ensureServerOnlineForCriticalAction()) return;
    const produtoId = document.getElementById('ls-produto').value;
    const quantidade = Number(document.getElementById('ls-qtd').value) || 0;
    if (!produtoId || quantidade <= 0) { toast('Selecione o produto e informe a quantidade.', 'warn'); return; }

    try {
      await withBusyButton(saveBtn, 'Registrando…', () => postStock('/losses', {
        operationId: genOperationId(), produtoId, quantidade,
        origem: document.getElementById('ls-origem').value,
        motivo: document.getElementById('ls-motivo').value,
        data: document.getElementById('ls-data').value || todayISO()
      }));
      toast('Perda registrada e descontada do estoque.', 'success');
      closeModal();
      navigate('losses');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
