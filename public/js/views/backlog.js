/* ============================================================
   VIEWS/BACKLOG.JS — Backlog (entregas não concluídas)
   Etapa 3: três operações distintas, todas via API dedicada:
   - Retorno (registrar o que não foi entregue, por NF/produto,
     total ou parcial) → POST /api/stock/backlog/return
   - Reentrega (o produto bloqueado sai de novo para entrega)
     → POST /api/stock/backlog/redelivery
   - Liberação (baixa definitiva do bloqueado, NÃO volta para o
     disponível) → POST /api/stock/backlog/release
   ============================================================ */

const BACKLOG_STATUS_LABEL = { bloqueado: 'Bloqueado', em_reentrega: 'Em reentrega', concluido: 'Reentregue', cancelado: 'Liberado (baixa)' };
const BACKLOG_STATUS_KIND = { bloqueado: 'danger', em_reentrega: 'warn', concluido: 'ok', cancelado: 'neutral' };

async function renderBacklog(root) {
  const backlog = (await DB.all('backlog')).sort((a, b) => b.dataRetorno.localeCompare(a.dataRetorno));
  const pendentes = backlog.filter(b => b.status === 'bloqueado');
  const historico = backlog.filter(b => b.status !== 'bloqueado');

  root.innerHTML = `
    <div class="view-head">
      <p class="subtitle">${pendentes.length} pendente(s) · ${historico.length} já resolvido(s)</p>
      ${pendentes.length > 0 ? `<div style="display:flex;gap:8px">
        <button class="btn btn--primary" id="redeliver-selected-btn" disabled>🚚 Reentregar selecionados</button>
        <button class="btn btn--danger" id="release-selected-btn" disabled>Liberar (baixa) selecionados</button>
      </div>` : ''}
    </div>
    <div class="section-title" style="margin-top:0">Pendentes (bloqueados)</div>
    <div class="table-wrap" style="margin-bottom:20px">
      <table class="data">
        <thead><tr><th></th><th>Retorno</th><th>Cliente</th><th>NF</th><th>Produto</th><th>Qtd.</th><th>Motivo</th></tr></thead>
        <tbody>
          ${pendentes.length === 0 ? `<tr><td colspan="7"><div class="empty-state"><div class="big">✅</div><p>Nenhum backlog pendente.</p></div></td></tr>` :
            pendentes.map(b => `<tr>
              <td><input type="checkbox" class="bl-select" value="${b.id}"></td>
              <td>${fmtDateTime(b.dataRetorno)}</td>
              <td>${escapeHTML(b.cliente)}</td>
              <td class="cell-mono">${escapeHTML(b.nf)}</td>
              <td>${escapeHTML(b.produtoNome)}</td>
              <td class="cell-mono">${fmtNumber(b.quantidade)}</td>
              <td>${escapeHTML(b.motivo)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${historico.length > 0 ? `
    <div class="section-title">Histórico de backlog</div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Retorno</th><th>Cliente</th><th>NF</th><th>Produto</th><th>Qtd.</th><th>Situação</th></tr></thead>
        <tbody>
          ${historico.map(b => `<tr>
            <td>${fmtDateTime(b.dataRetorno)}</td><td>${escapeHTML(b.cliente)}</td><td class="cell-mono">${escapeHTML(b.nf)}</td>
            <td>${escapeHTML(b.produtoNome)}</td><td class="cell-mono">${fmtNumber(b.quantidade)}</td>
            <td>${statusStamp(BACKLOG_STATUS_LABEL[b.status] || b.status, BACKLOG_STATUS_KIND[b.status] || 'neutral')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
  `;

  const checks = () => Array.from(root.querySelectorAll('.bl-select:checked')).map(c => c.value);
  const updateButtons = () => {
    const n = checks().length;
    const rBtn = document.getElementById('redeliver-selected-btn');
    const lBtn = document.getElementById('release-selected-btn');
    if (rBtn) rBtn.disabled = n === 0;
    if (lBtn) lBtn.disabled = n === 0;
  };
  root.querySelectorAll('.bl-select').forEach(c => c.addEventListener('change', updateButtons));

  const redeliverBtn = document.getElementById('redeliver-selected-btn');
  if (redeliverBtn) redeliverBtn.onclick = () => openRedeliverForm(checks());
  const releaseBtn = document.getElementById('release-selected-btn');
  if (releaseBtn) releaseBtn.onclick = () => openReleaseForm(checks());
}

/* ---------- Reentrega ---------- */
function openRedeliverForm(backlogIds) {
  openModal('Reentregar backlog selecionado', `
    <p class="hint">${backlogIds.length} item(ns) selecionado(s) sairão do estoque bloqueado para uma nova entrega.</p>
    <div class="form-grid form-grid--3">
      <div class="field"><label>Motorista</label><input class="input" id="rd-motorista"></div>
      <div class="field"><label>Veículo</label><input class="input" id="rd-veiculo"></div>
      <div class="field"><label>Placa</label><input class="input" id="rd-placa"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn--ghost" id="rd-cancel">Cancelar</button>
      <button class="btn btn--primary" id="rd-save">Confirmar reentrega</button>
    </div>
  `);
  document.getElementById('rd-cancel').onclick = closeModal;
  const saveBtn = document.getElementById('rd-save');
  saveBtn.onclick = async () => {
    if (!ensureServerOnlineForCriticalAction()) return;
    try {
      await withBusyButton(saveBtn, 'Processando…', () => postStock('/backlog/redelivery', {
        operationId: genOperationId(), backlogIds,
        motorista: document.getElementById('rd-motorista').value.trim(),
        veiculo: document.getElementById('rd-veiculo').value.trim(),
        placa: document.getElementById('rd-placa').value.trim()
      }));
      toast('Reentrega registrada — estoque bloqueado baixado.', 'success');
      closeModal();
      navigate('backlog');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

/* ---------- Liberação (baixa definitiva) ---------- */
function openReleaseForm(backlogIds) {
  openModal('Liberar backlog (baixa definitiva)', `
    <p class="hint">${backlogIds.length} item(ns) selecionado(s) serão baixados do estoque bloqueado. <strong>Isso não devolve o produto ao estoque disponível</strong> — use "Reentregar" se a intenção é enviar de novo ao cliente.</p>
    <div class="field"><label>Motivo</label><input class="input" id="rl-motivo" placeholder="Ex: produto descartado, acordo comercial, etc."></div>
    <div class="form-actions">
      <button class="btn btn--ghost" id="rl-cancel">Cancelar</button>
      <button class="btn btn--danger" id="rl-save">Confirmar liberação</button>
    </div>
  `);
  document.getElementById('rl-cancel').onclick = closeModal;
  const saveBtn = document.getElementById('rl-save');
  saveBtn.onclick = async () => {
    if (!ensureServerOnlineForCriticalAction()) return;
    try {
      await withBusyButton(saveBtn, 'Processando…', () => postStock('/backlog/release', {
        operationId: genOperationId(), backlogIds, motivo: document.getElementById('rl-motivo').value.trim()
      }));
      toast('Backlog liberado (baixa definitiva registrada).', 'success');
      closeModal();
      navigate('backlog');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

/* ---------- Retorno (a partir da tela de Saídas) ----------
   Mostra as NFs da saída, permite escolher quais NFs/produtos
   não foram entregues, com quantidade total ou parcial. */
async function openBacklogReturnForm(exitId) {
  const exit = await DB.get('exits', exitId);
  if (!exit) { toast('Saída não encontrada.', 'error'); return; }

  const elegiveis = exit.nfs.map(nf => ({
    numero: nf.numero,
    cliente: nf.cliente || exit.cliente || '',
    status: nf.status,
    itens: nf.itens.map(it => ({
      produtoId: it.produtoId,
      produtoNome: it.produtoNome,
      maxRetornavel: Number(it.quantidade || 0) - Number(it.quantidadeRetornada || 0)
    })).filter(it => it.maxRetornavel > 0)
  })).filter(nf => nf.status !== 'pendente' && nf.itens.length > 0);

  if (!elegiveis.length) { toast('Não há NFs elegíveis para retorno nesta saída.', 'info'); return; }

  openModal('Registrar retorno ao Backlog', `
    <p class="hint"><strong>1.</strong> Selecione as NFs que NÃO foram entregues. <strong>2.</strong> Para cada NF, escolha retorno total ou parcial. Produtos só serão bloqueados após sua confirmação.</p>
    <div id="bl-nfs">
      ${elegiveis.map((nf, nfIdx) => `
        <div class="card" style="margin-bottom:12px" data-nfcard="${nfIdx}">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
            <input type="checkbox" class="bl-nf-check" data-nfidx="${nfIdx}">
            <span style="flex:1"><strong>NF ${escapeHTML(nf.numero)}</strong> — ${escapeHTML(nf.cliente || 'Cliente não informado')}</span>
            <span class="hint">${nf.itens.length} item(ns)</span>
          </label>
          <div class="bl-nf-detail" data-nfidx="${nfIdx}" style="display:none;margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
            <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:8px">
              <label><input type="radio" name="bl-mode-${nfIdx}" value="total" checked> Retorno total da NF</label>
              <label><input type="radio" name="bl-mode-${nfIdx}" value="parcial"> Retorno parcial</label>
            </div>
            ${nf.itens.map((it, itIdx) => `
              <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">
                <span style="flex:1">${escapeHTML(it.produtoNome)} <span class="hint">(máx. ${fmtNumber(it.maxRetornavel)})</span></span>
                <input class="input bl-nf-qtd" style="width:100px" type="number" min="0" max="${it.maxRetornavel}" value="${it.maxRetornavel}" data-nfidx="${nfIdx}" data-itidx="${itIdx}" disabled>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>
    <div class="field" style="margin-top:14px"><label>Motivo do retorno</label>
      <select class="input" id="bl-motivo">
        <option>Cliente ausente</option><option>Recusa do pedido</option><option>Endereço não encontrado</option>
        <option>Avaria durante o transporte</option><option>Divergência de quantidade</option><option>Outro</option>
      </select>
    </div>
    <div class="form-actions"><button class="btn btn--ghost" id="bl-cancel">Cancelar</button><button class="btn btn--danger" id="bl-save">Registrar NFs no backlog</button></div>
  `, { wide: true });

  document.querySelectorAll('.bl-nf-check').forEach(chk => chk.addEventListener('change', e => {
    const idx = e.target.dataset.nfidx;
    const detail = document.querySelector(`.bl-nf-detail[data-nfidx="${idx}"]`);
    if (detail) detail.style.display = e.target.checked ? 'block' : 'none';
  }));
  elegiveis.forEach((nf, nfIdx) => {
    document.querySelectorAll(`input[name="bl-mode-${nfIdx}"]`).forEach(r => r.addEventListener('change', () => {
      const parcial = document.querySelector(`input[name="bl-mode-${nfIdx}"]:checked`)?.value === 'parcial';
      document.querySelectorAll(`.bl-nf-qtd[data-nfidx="${nfIdx}"]`).forEach(inp => inp.disabled = !parcial);
    }));
  });

  document.getElementById('bl-cancel').onclick = closeModal;
  const saveBtn = document.getElementById('bl-save');
  saveBtn.onclick = async () => {
    if (!ensureServerOnlineForCriticalAction()) return;
    const motivo = document.getElementById('bl-motivo').value;
    const retornos = [];
    document.querySelectorAll('.bl-nf-check:checked').forEach(chk => {
      const nfIdx = Number(chk.dataset.nfidx);
      const nf = elegiveis[nfIdx];
      const mode = document.querySelector(`input[name="bl-mode-${nfIdx}"]:checked`)?.value || 'total';
      nf.itens.forEach((it, itIdx) => {
        let qtd = it.maxRetornavel;
        if (mode === 'parcial') {
          const input = document.querySelector(`.bl-nf-qtd[data-nfidx="${nfIdx}"][data-itidx="${itIdx}"]`);
          qtd = Math.min(Number(input?.value) || 0, it.maxRetornavel);
        }
        if (qtd > 0) retornos.push({ nfNumero: nf.numero, produtoId: it.produtoId, quantidade: qtd });
      });
    });
    if (!retornos.length) { toast('Selecione ao menos uma NF e informe uma quantidade válida.', 'warn'); return; }

    try {
      await withBusyButton(saveBtn, 'Registrando…', () => postStock('/backlog/return', { operationId: genOperationId(), exitId: exit.id, retornos, motivo }));
      toast('Backlog registrado por NF. Produtos retornados ficaram bloqueados no estoque.', 'success');
      closeModal(); navigate('exits');
    } catch (err) { toast(err.message, 'error'); }
  };
}
