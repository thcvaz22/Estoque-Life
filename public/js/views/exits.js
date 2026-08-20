/* ============================================================
   VIEWS/EXITS.JS — Saídas/entregas (manual + romaneio por foto)
   OCR apenas prepara uma prévia. A movimentação acontece somente
   após confirmação, em POST /api/stock/exits, no backend.
   ============================================================ */

const EXIT_STATUS_LABEL = { em_rota: 'Em rota', concluida: 'Concluída', pendente: 'Pendente' };
const EXIT_STATUS_KIND = { em_rota: 'info', concluida: 'ok', pendente: 'warn' };
const NF_STATUS_LABEL = { entregue: 'Entregue', parcial: 'Retorno parcial', pendente: 'Backlog' };
const NF_STATUS_KIND = { entregue: 'ok', parcial: 'warn', pendente: 'danger' };

function exitTotalQtd(exit) { return exit.nfs.reduce((a, nf) => a + nf.itens.reduce((x, i) => x + Number(i.quantidade || 0), 0), 0); }
function exitItemCount(exit) { return exit.nfs.reduce((a, nf) => a + nf.itens.length, 0); }

async function renderExits(root) {
  const exits = (await DB.all('exits')).sort((a, b) => (b.horarioSaida || '').localeCompare(a.horarioSaida || ''));
  root.innerHTML = `
    <div class="view-head">
      <p class="subtitle">${exits.length} saída(s) registrada(s)</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="romaneio-exit-btn">📷 Importar romaneio</button>
        <button class="btn btn--primary" id="new-exit-btn">+ Cadastrar manualmente</button>
      </div>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Saída</th><th>Entregador / Placa</th><th>Cliente</th><th>NFs</th><th>Itens</th><th>Status</th><th></th></tr></thead>
      <tbody id="exits-tbody"></tbody>
    </table></div>`;

  const tbody = document.getElementById('exits-tbody');
  tbody.innerHTML = exits.length === 0 ? `<tr><td colspan="7"><div class="empty-state"><div class="big">🚚</div><p>Nenhuma saída registrada ainda.</p></div></td></tr>` : exits.map(e => `<tr>
    <td>${fmtDateTime(e.horarioSaida)}${e.origemRomaneio ? `<br><span class="hint">📷 Romaneio ${escapeHTML(e.romaneioNumero || '')}</span>` : ''}</td>
    <td>${escapeHTML(e.motorista)}<br><span class="cell-mono" style="font-size:11px">${escapeHTML(e.placa)}</span></td>
    <td>${escapeHTML(e.cliente || e.nfs.map(n => n.cliente).filter(Boolean).join(', '))}</td>
    <td class="cell-mono">${e.nfs.map(nf => `${escapeHTML(nf.numero)} ${statusStamp(NF_STATUS_LABEL[nf.status] || nf.status, NF_STATUS_KIND[nf.status] || 'neutral')}`).join('<br>')}</td>
    <td>${exitItemCount(e)} (${fmtNumber(exitTotalQtd(e))} un.)</td>
    <td>${statusStamp(EXIT_STATUS_LABEL[e.status], EXIT_STATUS_KIND[e.status])}</td>
    <td class="row-actions">
      ${e.fotos && e.fotos.length ? `<button class="btn btn--sm" data-exitphotos='${JSON.stringify(e.fotos)}'>🖼️</button>` : ''}
      ${e.status !== 'concluida' ? `<button class="btn btn--sm" data-conclude="${e.id}">Concluir</button>` : ''}
      ${e.nfs.some(nf => nf.status !== 'pendente') ? `<button class="btn btn--sm btn--danger" data-return="${e.id}">Backlog</button>` : ''}
    </td>
  </tr>`).join('');

  tbody.querySelectorAll('[data-conclude]').forEach(b => b.onclick = () => concludeExit(b.dataset.conclude, b));
  tbody.querySelectorAll('[data-return]').forEach(b => b.onclick = () => openBacklogReturnForm(b.dataset.return));
  tbody.querySelectorAll('[data-exitphotos]').forEach(b => b.onclick = () => openPhotoViewer(JSON.parse(b.dataset.exitphotos)));
  document.getElementById('new-exit-btn').onclick = () => openExitForm();
  document.getElementById('romaneio-exit-btn').onclick = () => openRomaneioCaptureModal();
}

async function concludeExit(id, button) {
  if (!ensureServerOnlineForCriticalAction()) return;
  try {
    await withBusyButton(button, 'Concluindo…', () => postStock(`/exits/${id}/conclude`, {}));
    toast('Entrega marcada como concluída.', 'success'); navigate('exits');
  } catch (err) { toast(err.message, 'error'); }
}

function openRomaneioCaptureModal() {
  let photos = [];
  function render() {
    openModal('Importar romaneio por foto', `
      <p class="hint">Tire foto do romaneio ou escolha da galeria. Para melhor leitura, fotografe de frente, com boa luz e texto nítido. Se houver mais páginas, adicione todas.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">
        ${photos.map((p, i) => `<div style="position:relative"><img src="${p.previewUrl}" style="width:76px;height:76px;object-fit:cover;border-radius:6px;border:1px solid var(--line)"><span style="position:absolute;bottom:2px;left:2px;background:rgba(0,0,0,.65);color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">Foto ${i + 1}</span><button class="icon-btn" data-rmrom="${i}" style="position:absolute;top:-9px;right:-9px;background:var(--surface);border-radius:50%;border:1px solid var(--line);width:22px;height:22px;font-size:11px;padding:0">✕</button></div>`).join('')}
        <label class="btn btn--sm" for="rom-photo-input" style="display:flex;align-items:center;justify-content:center;width:76px;height:76px;border:2px dashed var(--line);border-radius:6px;cursor:pointer;text-align:center">+ Foto</label>
      </div>
      <input type="file" id="rom-photo-input" accept="image/*" capture="environment" multiple hidden>
      <p class="hint">${photos.length} foto(s) adicionada(s). O OCR não movimentará estoque; você conferirá tudo antes.</p>
      <div class="form-actions"><button class="btn btn--ghost" id="rom-cancel">Cancelar</button><button class="btn btn--primary" id="rom-analyze" ${photos.length ? '' : 'disabled'}>Analisar romaneio</button></div>`, { wide: true });
    document.getElementById('rom-cancel').onclick = closeModal;
    document.querySelectorAll('[data-rmrom]').forEach(b => b.onclick = () => { photos.splice(Number(b.dataset.rmrom), 1); render(); });
    document.getElementById('rom-photo-input').addEventListener('change', async e => {
      const files = Array.from(e.target.files || []); e.target.value = '';
      for (const file of files) {
        try { photos.push({ base64: await fileToBase64(file), mimeType: file.type || 'image/jpeg', previewUrl: URL.createObjectURL(file) }); }
        catch (err) { toast(err.message, 'error'); }
      }
      render();
    });
    const analyze = document.getElementById('rom-analyze');
    if (analyze) analyze.onclick = async () => {
      if (!ensureServerOnlineForCriticalAction()) return;
      openModal('Analisando romaneio…', `<div style="text-align:center;padding:34px 10px"><div class="skeleton" style="height:14px;width:65%;margin:0 auto 10px;border-radius:4px"></div><div class="skeleton" style="height:14px;width:45%;margin:0 auto;border-radius:4px"></div><p class="hint" style="margin-top:18px">Lendo ${photos.length} imagem(ns). Na primeira utilização o OCR pode levar mais tempo.</p></div>`);
      try {
        const result = await postJSON('/api/ocr/analyze-romaneio', { imagens: photos.map(p => ({ base64: p.base64, mimeType: p.mimeType })) });
        const totalItens = (result.nfs || []).reduce((a, n) => a + (n.itens || []).length, 0);
        if (!result.nfs || result.nfs.length === 0 || totalItens === 0) {
          toast('Não foi possível identificar NFs/produtos. Tente outra foto, mais próxima, reta e com melhor iluminação.', 'warn');
        } else toast(`Romaneio analisado: ${result.nfs.length} NF(s), ${totalItens} item(ns). Confira antes de registrar.`, 'success');
        openExitForm({
          origemRomaneio: true, romaneioNumero: result.romaneioNumero || '', fotos: (result.fotos || []).map(f => f.id),
          motorista: result.motorista || '', veiculo: result.veiculo || '', placa: result.placa || '', cliente: result.cliente || '',
          horarioSaida: result.data ? `${result.data}T08:00` : nowLocalDatetimeInput(),
          nfs: (result.nfs || []).map(nf => ({ numero: nf.numero || '', cliente: nf.cliente || result.cliente || '', itens: (nf.itens || []).map(it => ({
            produtoId: it.produtoId || '', quantidade: it.quantidade || 0, embalagem: normalizeMovementUnit(it.unidade || it.embalagem || 'Unidade'), descricaoOCR: it.descricao || '', confianca: it.confianca, nivelConfianca: it.nivelConfianca, sugestaoId: it.sugestaoId || ''
          })) }))
        });
      } catch (err) { toast(err.message, 'error'); render(); }
    };
  }
  render();
}

function openExitForm(state) {
  let nfs = (state?.nfs && state.nfs.length ? state.nfs : [{ numero: '', cliente: '', itens: [{}] }]).map(n => ({ ...n, itens: (n.itens || []).map(i => ({ ...i })) }));
  const origemRomaneio = !!state?.origemRomaneio;
  const fotos = state?.fotos || [];

  openModal(origemRomaneio ? 'Nova saída · romaneio lido por foto' : 'Nova saída', `
    ${origemRomaneio ? `<div class="card" style="margin-bottom:12px"><strong>📷 Conferência obrigatória</strong><p class="hint" style="margin:5px 0 0">Dados preparados pelo OCR. Corrija qualquer campo duvidoso antes de confirmar; nada foi baixado do estoque ainda.</p></div>` : ''}
    <div class="form-grid form-grid--3">
      <div class="field"><label>Entregador / Motorista</label><input class="input" id="x-motorista" value="${escapeHTML(state?.motorista || '')}"></div>
      <div class="field"><label>Veículo</label><input class="input" id="x-veiculo" value="${escapeHTML(state?.veiculo || '')}"></div>
      <div class="field"><label>Placa</label><input class="input" id="x-placa" value="${escapeHTML(state?.placa || '')}"></div>
      <div class="field field--full"><label>Cliente padrão (opcional)</label><input class="input" id="x-cliente" list="aion-customers-list" value="${escapeHTML(state?.cliente || '')}" placeholder="Usado quando a NF não tiver cliente próprio"><datalist id="aion-customers-list"></datalist></div>
      <div class="field"><label>Horário de saída</label><input class="input" type="datetime-local" id="x-horario" value="${state?.horarioSaida || nowLocalDatetimeInput()}"></div>
      ${origemRomaneio ? `<div class="field"><label>Nº do romaneio</label><input class="input" id="x-romaneio" value="${escapeHTML(state?.romaneioNumero || '')}"></div>` : ''}
    </div>
    <div class="section-title">Notas fiscais e produtos</div>
    <p class="hint">Cada NF mantém seu cliente e seus produtos. Campos marcados pelo OCR devem ser conferidos.</p>
    <div id="exit-nfs"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn--sm" id="x-add-nf" type="button">+ Adicionar NF</button>${fotos.length ? `<button class="btn btn--sm" id="x-view-rom-photos" type="button">🖼️ Ver romaneio (${fotos.length})</button>` : ''}</div>
    <div class="form-actions"><button class="btn btn--ghost" id="x-cancel">Cancelar</button><button class="btn btn--primary" id="x-save">${origemRomaneio ? 'Confirmar e registrar saída' : 'Registrar saída'}</button></div>`, { wide: true });

  if (typeof AionIA !== 'undefined' && AionIA.loadCatalogs) {
    AionIA.loadCatalogs().then(c => {
      const dl = document.getElementById('aion-customers-list');
      if (dl) dl.innerHTML = (c.customers || []).filter(x => x.ativo !== false).map(x => `<option value="${escapeHTML(x.nome)}"></option>`).join('');
    }).catch(() => {});
  }

  const container = document.getElementById('exit-nfs');
  async function drawNfs() {
    const summary = await computeStockSummary();
    container.innerHTML = nfs.map((nfEntry, nfIdx) => `<div class="card" style="margin-bottom:12px">
      <div class="form-grid form-grid--3">
        <div class="field"><label>Número da NF</label><input class="input x-nf-numero" data-nfidx="${nfIdx}" value="${escapeHTML(nfEntry.numero || '')}" placeholder="Ex: 12345"></div>
        <div class="field field--full"><label>Cliente desta NF</label><input class="input x-nf-cliente" list="aion-customers-list" data-nfidx="${nfIdx}" value="${escapeHTML(nfEntry.cliente || '')}" placeholder="Se vazio, usa o cliente padrão"></div>
      </div>
      <div>${nfEntry.itens.map((it, itIdx) => {
        const s = summary.find(x => x.product.id === it.produtoId);
        const badge = it.nivelConfianca ? statusStamp(`${it.nivelConfianca === 'alta' ? '🟢' : it.nivelConfianca === 'media' ? '🟡' : '🔴'} OCR ${Math.round((it.confianca || 0) * 100)}%`, it.nivelConfianca === 'alta' ? 'ok' : it.nivelConfianca === 'media' ? 'warn' : 'danger') : '';
        return `<div class="form-grid" style="margin-top:8px;border-top:1px dashed var(--line);padding-top:8px">
          <div class="field field--full"><label>Produto ${badge}</label>${it.descricaoOCR ? `<span class="hint">Lido: “${escapeHTML(it.descricaoOCR)}”</span>` : ''}<select class="input x-item-prod" data-nfidx="${nfIdx}" data-itidx="${itIdx}"><option value="">Selecione / confirme…</option>${summary.map(s2 => `<option value="${s2.product.id}" ${it.produtoId === s2.product.id ? 'selected' : ''}>${escapeHTML(s2.product.nome)} — disponível: ${fmtNumber(s2.totalDisponivel)}</option>`).join('')}</select>${s ? `<span class="hint">Disponível: ${fmtNumber(s.totalDisponivel)} un.</span>` : origemRomaneio ? `<span class="hint" style="color:var(--alert)">⚠ Produto não confirmado. Selecione antes de registrar.</span>` : ''}</div>
          <div class="field"><label>Quantidade</label><input class="input x-item-qtd" type="number" min="0" step="0.5" data-nfidx="${nfIdx}" data-itidx="${itIdx}" value="${it.quantidade || 0}"></div>
          <div class="field"><label>Unidade de movimentação</label><select class="input x-item-unit" data-nfidx="${nfIdx}" data-itidx="${itIdx}">${[['Unidade','Unidade'],['Fardo','Fardo / Caixa'],['Pallet','Pallet'],['Meio Pallet','Meio Pallet']].map(([v,l]) => `<option value="${v}" ${normalizeMovementUnit(it.embalagem || 'Unidade') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${s ? `<span class="hint">${fmtNumber(it.quantidade || 0)} ${escapeHTML(normalizeMovementUnit(it.embalagem || 'Unidade'))} = <strong>${fmtNumber(movementPreview(s.product, it.quantidade, it.embalagem || 'Unidade'))} un.</strong></span>` : ''}</div>
          <div class="field" style="justify-content:flex-end"><button class="icon-btn x-item-remove" data-nfidx="${nfIdx}" data-itidx="${itIdx}" type="button">🗑️ Remover item</button></div>
        </div>`;
      }).join('')}</div>
      <div style="display:flex;justify-content:space-between;margin-top:10px"><button class="btn btn--sm x-add-item" data-nfidx="${nfIdx}" type="button">+ Adicionar produto nesta NF</button>${nfs.length > 1 ? `<button class="icon-btn x-remove-nf" data-nfidx="${nfIdx}" type="button">🗑️ Remover NF</button>` : ''}</div>
    </div>`).join('');

    container.querySelectorAll('.x-nf-numero').forEach(el => el.onchange = e => nfs[e.target.dataset.nfidx].numero = e.target.value.trim());
    container.querySelectorAll('.x-nf-cliente').forEach(el => el.onchange = e => nfs[e.target.dataset.nfidx].cliente = e.target.value.trim());
    container.querySelectorAll('.x-item-prod').forEach(el => el.onchange = e => nfs[e.target.dataset.nfidx].itens[e.target.dataset.itidx].produtoId = e.target.value);
    container.querySelectorAll('.x-item-qtd').forEach(el => el.onchange = e => { nfs[e.target.dataset.nfidx].itens[e.target.dataset.itidx].quantidade = Number(e.target.value) || 0; drawNfs(); });
    container.querySelectorAll('.x-item-unit').forEach(el => el.onchange = e => { nfs[e.target.dataset.nfidx].itens[e.target.dataset.itidx].embalagem = normalizeMovementUnit(e.target.value); drawNfs(); });
    container.querySelectorAll('.x-item-remove').forEach(el => el.onclick = e => { nfs[e.target.dataset.nfidx].itens.splice(Number(e.target.dataset.itidx), 1); drawNfs(); });
    container.querySelectorAll('.x-add-item').forEach(el => el.onclick = e => { nfs[e.target.dataset.nfidx].itens.push({ embalagem: 'Unidade' }); drawNfs(); });
    container.querySelectorAll('.x-remove-nf').forEach(el => el.onclick = e => { nfs.splice(Number(e.target.dataset.nfidx), 1); drawNfs(); });
  }
  drawNfs();

  document.getElementById('x-add-nf').onclick = () => { nfs.push({ numero: '', cliente: '', itens: [{}] }); drawNfs(); };
  const viewPhotos = document.getElementById('x-view-rom-photos'); if (viewPhotos) viewPhotos.onclick = () => openPhotoViewer(fotos);
  document.getElementById('x-cancel').onclick = closeModal;
  const saveBtn = document.getElementById('x-save');
  saveBtn.onclick = async () => {
    if (!ensureServerOnlineForCriticalAction()) return;
    const motorista = document.getElementById('x-motorista').value.trim();
    const clientePadrao = document.getElementById('x-cliente').value.trim();
    if (!motorista) { toast('Informe o entregador/motorista.', 'warn'); return; }
    const nfsValidas = nfs.map(nf => ({ numero: (nf.numero || '').trim(), cliente: (nf.cliente || clientePadrao || '').trim(), itens: nf.itens.filter(i => i.produtoId && i.quantidade > 0).map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade, unidadeMovimentacao: normalizeMovementUnit(i.embalagem || 'Unidade') })) })).filter(nf => nf.numero && nf.itens.length > 0);
    if (!nfsValidas.length) { toast('Informe ao menos uma NF com número e produtos confirmados.', 'warn'); return; }
    if (nfsValidas.some(nf => !nf.cliente)) { toast('Informe o cliente de cada NF ou um cliente padrão.', 'warn'); return; }
    const itensPendentes = nfs.reduce((a, nf) => a + nf.itens.filter(i => !i.produtoId || !(i.quantidade > 0)).length, 0);
    if (itensPendentes) { toast(`Existem ${itensPendentes} item(ns) sem produto/quantidade confirmados. Corrija ou remova antes de registrar.`, 'warn'); return; }
    try {
      await withBusyButton(saveBtn, 'Registrando…', () => postStock('/exits', {
        operationId: genOperationId(), motorista, veiculo: document.getElementById('x-veiculo').value.trim(), placa: document.getElementById('x-placa').value.trim(),
        cliente: clientePadrao, horarioSaida: new Date(document.getElementById('x-horario').value).toISOString(), nfs: nfsValidas,
        origemRomaneio, romaneioNumero: origemRomaneio ? document.getElementById('x-romaneio').value.trim() : '', fotos
      }));
      toast('Saída registrada e estoque atualizado pelo servidor.', 'success'); closeModal(); navigate('exits');
    } catch (err) { toast(err.message, 'error'); }
  };
}
