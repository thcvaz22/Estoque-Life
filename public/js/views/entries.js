/* ============================================================
   VIEWS/ENTRIES.JS — Entrada de Produtos (manual + XML da NF-e)
   Etapa 3:
   - Produto desconhecido no XML NUNCA é cadastrado sozinho — a
     tela exige "Cadastrar novo produto" ou "Vincular a existente"
     antes de deixar salvar.
   - O salvamento chama POST /api/stock/entries (o servidor cria
     o lote, valida NF-e duplicada e registra o histórico).
   ============================================================ */

async function renderEntries(root) {
  const entries = (await DB.all('entries')).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));

  root.innerHTML = `
    <div class="view-head">
      <p class="subtitle">${entries.length} entrada(s) registrada(s)</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <label class="btn" for="xml-input">📄 Importar XML da NF</label>
        <input type="file" id="xml-input" accept=".xml" hidden>
        <button class="btn" id="photo-entry-btn">📷 Fotografar / Importar foto da NF</button>
        <button class="btn btn--primary" id="new-entry-btn">+ Cadastrar manualmente</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Data</th><th>Fornecedor</th><th>NF</th><th>Itens</th><th>Qtd. total</th><th>Origem</th></tr></thead>
        <tbody id="entries-tbody"></tbody>
      </table>
    </div>
  `;

  const tbody = document.getElementById('entries-tbody');
  tbody.innerHTML = entries.length === 0 ? `<tr><td colspan="6"><div class="empty-state"><div class="big">📥</div><p>Nenhuma entrada registrada ainda.</p></div></td></tr>` :
    entries.map(e => `<tr>
      <td>${fmtDate(e.data)}</td><td>${escapeHTML(e.fornecedor)}</td><td class="cell-mono">${escapeHTML(e.nf || '—')}</td>
      <td>${e.itens.length}</td><td class="cell-mono">${fmtNumber(e.itens.reduce((a, i) => a + Number(i.quantidade || 0), 0))}</td>
      <td>
        ${e.origemXML ? statusStamp('XML', 'info') : e.origemFoto ? statusStamp('Foto', 'info') : statusStamp('Manual', 'neutral')}
        ${e.fotos && e.fotos.length ? ` <button class="icon-btn" data-viewphotos='${JSON.stringify(e.fotos)}' title="Ver foto(s) da NF">🖼️</button>` : ''}
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-viewphotos]').forEach(b => b.onclick = () => openPhotoViewer(JSON.parse(b.dataset.viewphotos)));

  document.getElementById('new-entry-btn').onclick = () => openEntryForm();
  document.getElementById('photo-entry-btn').onclick = () => openPhotoCaptureModal();
  document.getElementById('xml-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = await parseNFeXML(file);
      const products = await DB.all('products');
      const itens = parsed.itens.map(i => {
        const match = products.find(p => (p.codigoInterno && i.codigoProduto && String(p.codigoInterno) === String(i.codigoProduto)) || (p.codigoBarras && i.codigoBarras && p.codigoBarras === i.codigoBarras));
        return {
          codigoBarras: i.codigoBarras, nomeSugerido: i.nome, produtoId: match ? match.id : null, produtoNome: match ? match.nome : null,
          quantidade: i.quantidade, custoUnitario: Number(i.valorUnitario || 0) > 0 ? Number(i.valorUnitario) : null, lote: i.lote, fabricacao: i.fabricacao ? i.fabricacao.slice(0, 10) : '',
          validade: i.validade ? i.validade.slice(0, 10) : '', embalagem: normalizeMovementUnit(i.unidade || 'Unidade')
        };
      });
      const semMatch = itens.filter(i => !i.produtoId).length;
      toast(`XML lido: ${itens.length} item(ns)${semMatch ? `, ${semMatch} sem produto correspondente` : ''}.`, semMatch ? 'warn' : 'success');
      openEntryForm({ data: todayISO(), fornecedor: parsed.fornecedor, nf: parsed.nf, chaveNFe: parsed.chaveNFe, origemXML: true, itens });
    } catch (err) {
      toast('Erro ao ler XML: ' + err.message, 'error');
    }
  });
}

/* ---------- Entrada por foto (OCR local) ---------- */

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo de imagem.'));
    reader.readAsDataURL(file);
  });
}

function openPhotoViewer(fotoIds) {
  openModal('Imagem(ns) do documento', `
    <div style="display:flex;flex-direction:column;gap:12px">
      ${fotoIds.map(id => `<img src="/api/ocr/photo/${encodeURIComponent(id)}" style="width:100%;border-radius:6px;border:1px solid var(--line)">`).join('')}
    </div>
  `, { wide: true });
}

function openPhotoCaptureModal() {
  let photos = []; // {base64, mimeType, previewUrl}

  function render() {
    openModal('Foto da Nota Fiscal', `
      <p class="hint">Tire uma foto ou escolha da galeria. Se a nota tiver mais de uma página, adicione uma foto de cada.</p>
      <div id="photo-thumbs" style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">
        ${photos.map((p, i) => `
          <div style="position:relative">
            <img src="${p.previewUrl}" style="width:76px;height:76px;object-fit:cover;border-radius:6px;border:1px solid var(--line)">
            <span style="position:absolute;bottom:2px;left:2px;background:rgba(0,0,0,.65);color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">Foto ${i + 1}</span>
            <button class="icon-btn" data-rmphoto="${i}" style="position:absolute;top:-9px;right:-9px;background:var(--surface);border-radius:50%;border:1px solid var(--line);width:22px;height:22px;font-size:11px;padding:0;line-height:1">✕</button>
          </div>`).join('')}
        <label class="btn btn--sm" for="photo-add-input" style="display:flex;align-items:center;justify-content:center;width:76px;height:76px;border:2px dashed var(--line);border-radius:6px;cursor:pointer;text-align:center">+ Foto</label>
      </div>
      <input type="file" id="photo-add-input" accept="image/*" capture="environment" multiple hidden>
      <p class="hint">${photos.length} foto(s) adicionada(s). Aceita foto de nota impressa ou documento digitalizado.</p>
      <div class="form-actions">
        <button class="btn btn--ghost" id="photo-cancel">Cancelar</button>
        <button class="btn btn--primary" id="photo-analyze" ${photos.length === 0 ? 'disabled' : ''}>Analisar nota fiscal</button>
      </div>
    `, { wide: true });

    document.getElementById('photo-cancel').onclick = closeModal;
    document.querySelectorAll('[data-rmphoto]').forEach(b => b.onclick = () => { photos.splice(Number(b.dataset.rmphoto), 1); render(); });

    document.getElementById('photo-add-input').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      for (const file of files) {
        try {
          const base64 = await fileToBase64(file);
          photos.push({ base64, mimeType: file.type || 'image/jpeg', previewUrl: URL.createObjectURL(file) });
        } catch (err) {
          toast(err.message, 'error');
        }
      }
      render();
    });

    const analyzeBtn = document.getElementById('photo-analyze');
    if (analyzeBtn) analyzeBtn.onclick = async () => {
      if (!ensureServerOnlineForCriticalAction()) return;
      openModal('Analisando nota fiscal…', `
        <div style="text-align:center;padding:34px 10px">
          <div class="skeleton" style="height:14px;width:65%;margin:0 auto 10px;border-radius:4px"></div>
          <div class="skeleton" style="height:14px;width:45%;margin:0 auto;border-radius:4px"></div>
          <p class="hint" style="margin-top:18px">Lendo ${photos.length} imagem(ns) — isso pode levar alguns segundos, principalmente na primeira vez.</p>
        </div>
      `);
      try {
        const result = await postJSON('/api/ocr/analyze', { imagens: photos.map(p => ({ base64: p.base64, mimeType: p.mimeType })) });
        if (!(result.itens || []).length) {
          toast('Não foi possível identificar produtos na foto. Tente novamente mais perto, de frente e com melhor iluminação, ou preencha manualmente.', 'warn');
        } else if (typeof result.confiancaDocumento === 'number' && result.confiancaDocumento < 0.55) {
          toast('A leitura da foto ficou com baixa confiança. Confira todos os campos com atenção ou tire outra foto mais nítida.', 'warn');
        } else {
          toast(`${result.paginasAnalisadas} imagem(ns) analisada(s). Confira os dados antes de salvar.`, 'success');
        }
        openEntryForm({
          data: todayISO(), fornecedor: result.fornecedor || '', nf: result.nf || '',
          chaveNFe: result.chaveNFe || '', origemFoto: true, fotos: (result.fotos || []).map(f => f.id),
          duplicadoAviso: result.duplicado || null,
          itens: (result.itens || []).map(it => ({
            nomeSugerido: it.descricao, codigoBarras: it.ean, produtoId: it.produtoId, produtoNome: it.produtoNome,
            quantidade: it.quantidade || 0, custoUnitario: Number(it.custoUnitario || 0) > 0 ? Number(it.custoUnitario) : null, lote: it.lote || '', fabricacao: '', validade: it.validade || '',
            embalagem: it.unidade || 'Unidade', confianca: it.confianca, nivelConfianca: it.nivelConfianca,
            unidadeNaoIdentificada: it.unidadeNaoIdentificada
          }))
        });
      } catch (err) {
        toast(err.message, 'error');
        render();
      }
    };
  }
  render();
}

function openEntryForm(state) {
  const s = {
    data: state?.data || todayISO(),
    fornecedor: state?.fornecedor || '',
    nf: state?.nf || '',
    chaveNFe: state?.chaveNFe || '',
    origemXML: !!state?.origemXML,
    origemFoto: !!state?.origemFoto,
    fotos: state?.fotos || [],
    duplicadoAviso: state?.duplicadoAviso || null,
    itens: (state?.itens || []).map(i => ({ ...i, custoUnitario: i.custoUnitario == null ? null : Number(i.custoUnitario), embalagem: normalizeMovementUnit(i.embalagem || i.unidadeMovimentacao || 'Unidade'), validade: i.validade || addDaysISO(state?.data || todayISO(), 40), validadeAutomatica: !i.validade }))
  };

  const tituloOrigem = s.origemXML ? 'Nova entrada · importada do XML' : s.origemFoto ? 'Nova entrada · lida por foto (conferir antes de salvar)' : 'Nova entrada';

  openModal(tituloOrigem, `
    ${s.duplicadoAviso ? `
      <div class="card" style="border-color:var(--alert);margin-bottom:14px">
        ${statusStamp('Possível duplicidade', 'danger')}
        <p style="margin:6px 0 0;font-size:13px">Já existe uma entrada parecida: NF ${escapeHTML(s.duplicadoAviso.nf || '—')} de ${escapeHTML(s.duplicadoAviso.fornecedor || '—')} em ${fmtDate(s.duplicadoAviso.data)}. Confira antes de confirmar — a chave da NF-e não permite duplicar de propósito.</p>
      </div>` : ''}
    ${s.origemFoto ? `<p class="hint">📷 Dados lidos automaticamente da foto — confira tudo com atenção antes de salvar. Você pode editar qualquer campo.</p>` : ''}
    <div class="form-grid form-grid--3">
      <div class="field"><label>Data de chegada</label><input class="input" type="date" id="e-data" value="${s.data}"></div>
      <div class="field field--full"><label>Fornecedor</label><input class="input" id="e-forn" list="aion-suppliers-list" value="${escapeHTML(s.fornecedor)}"><datalist id="aion-suppliers-list"></datalist></div>
      <div class="field"><label>Número da NF</label><input class="input" id="e-nf" value="${escapeHTML(s.nf)}"></div>
      ${s.chaveNFe ? `<div class="field field--full"><label>Chave da NF-e</label><input class="input cell-mono" id="e-chave" value="${escapeHTML(s.chaveNFe)}" readonly></div>` : ''}
    </div>
    <div class="section-title">Itens</div>
    <div id="items-container"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn--sm" id="add-item-btn" type="button">+ Adicionar item manualmente</button>
      ${s.fotos.length ? `<button class="btn btn--sm" id="view-photos-btn" type="button">🖼️ Ver foto(s) da NF (${s.fotos.length})</button>` : ''}
    </div>
    <div class="form-actions">
      <button class="btn btn--ghost" id="e-cancel">Cancelar</button>
      <button class="btn btn--primary" id="e-save">Registrar entrada</button>
    </div>
  `, { wide: true });

  if (typeof AionIA !== 'undefined' && AionIA.loadCatalogs) {
    AionIA.loadCatalogs().then(c => {
      const dl = document.getElementById('aion-suppliers-list');
      if (dl) dl.innerHTML = (c.suppliers || []).filter(x => x.ativo !== false).map(x => `<option value="${escapeHTML(x.nome)}"></option>`).join('');
    }).catch(() => {});
  }

  const viewPhotosBtn = document.getElementById('view-photos-btn');
  if (viewPhotosBtn) viewPhotosBtn.onclick = () => openPhotoViewer(s.fotos);

  const container = document.getElementById('items-container');
  const items = s.itens;

  function readHeader() {
    return {
      data: document.getElementById('e-data').value || todayISO(),
      fornecedor: document.getElementById('e-forn').value,
      nf: document.getElementById('e-nf').value,
      chaveNFe: s.chaveNFe,
      origemXML: s.origemXML,
      origemFoto: s.origemFoto,
      fotos: s.fotos,
      duplicadoAviso: s.duplicadoAviso,
      itens: items
    };
  }

  async function drawItems() {
    const products = await DB.all('products');
    if (items.length === 0) {
      container.innerHTML = `<p class="hint">Nenhum item adicionado.</p>`;
      return;
    }
    container.innerHTML = items.map((it, idx) => {
      const confBadge = it.nivelConfianca ? statusStamp(
        `${it.nivelConfianca === 'alta' ? '🟢' : it.nivelConfianca === 'media' ? '🟡' : '🔴'} confiança ${Math.round((it.confianca || 0) * 100)}%`,
        it.nivelConfianca === 'alta' ? 'ok' : it.nivelConfianca === 'media' ? 'warn' : 'danger'
      ) : '';
      if (!it.produtoId) {
        // produto não encontrado — exige resolução antes de poder salvar
        const sugestao = it.sugestaoId ? products.find(p => p.id === it.sugestaoId) : null;
        return `
        <div class="card" style="margin-bottom:10px;border-color:var(--alert)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
            ${statusStamp('Produto não encontrado', 'danger')} ${confBadge}
            <span style="font-size:13px">${escapeHTML(it.nomeSugerido || it.codigoBarras || 'Item')} ${it.codigoBarras ? `<span class="hint cell-mono">(${escapeHTML(it.codigoBarras)})</span>` : ''} — qtd. ${fmtNumber(it.quantidade)}</span>
          </div>
          ${sugestao ? `<p class="hint">Palpite: <strong>${escapeHTML(sugestao.nome)}</strong>? <button class="link-btn item-use-suggestion" data-idx="${idx}" data-sugid="${sugestao.id}">Usar este produto</button></p>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn--sm item-create-product" data-idx="${idx}" type="button">+ Cadastrar novo produto</button>
            <select class="input item-link-product" data-idx="${idx}" style="max-width:280px">
              <option value="">Vincular a produto existente…</option>
              ${products.map(p => `<option value="${p.id}">${escapeHTML(p.nome)}</option>`).join('')}
            </select>
          </div>
          <div style="text-align:right;margin-top:6px"><button class="icon-btn item-remove" data-idx="${idx}">🗑️ Remover</button></div>
        </div>`;
      }
      const linkedProduct = products.find(p => p.id === it.produtoId);
      if (it.custoUnitario == null && linkedProduct) it.custoUnitario = Number(linkedProduct.custoAtual || 0);
      return `
      <div class="card" style="margin-bottom:10px">
        ${confBadge ? `<div style="margin-bottom:8px">${confBadge}</div>` : ''}
        <div class="form-grid form-grid--3">
          <div class="field field--full">
            <label>Produto</label>
            <div class="input-with-btn">
              <input class="input" value="${escapeHTML(it.produtoNome || '')}" disabled>
              <button class="btn btn--sm item-scan" data-idx="${idx}" type="button">📷</button>
            </div>
            <span class="hint">✅ Vinculado</span>
          </div>
          <div class="field"><label>Quantidade</label><input class="input item-qtd" type="number" min="0" data-idx="${idx}" value="${it.quantidade || 0}"></div>
          <div class="field"><label>Custo unitário (R$)</label><input class="input item-custo" type="number" min="0" step="0.01" data-idx="${idx}" value="${Number(it.custoUnitario ?? products.find(p=>p.id===it.produtoId)?.custoAtual ?? 0)}"><span class="hint">Ao registrar, este valor vira o custo atual do produto.</span></div>
          <div class="field">
            <label>Unidade de movimentação${it.unidadeNaoIdentificada ? ' · <span style="color:var(--alert)">não identificada</span>' : ''}</label>
            <select class="input item-emb" data-idx="${idx}">
              ${[['Unidade','Unidade'],['Fardo','Fardo / Caixa'],['Pallet','Pallet'],['Meio Pallet','Meio Pallet']].map(([v,l]) => `<option value="${v}" ${normalizeMovementUnit(it.embalagem) === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            ${(() => { const p = products.find(p => p.id === it.produtoId); return p ? `<span class="hint">${fmtNumber(it.quantidade || 0)} ${escapeHTML(normalizeMovementUnit(it.embalagem))} = <strong>${fmtNumber(movementPreview(p, it.quantidade, it.embalagem))} un.</strong></span>` : ''; })()}
          </div>
          <div class="field"><label>Lote${!it.lote ? ' · <span class="hint">não identificado</span>' : ''}</label><input class="input item-lote" data-idx="${idx}" value="${escapeHTML(it.lote || '')}"></div>
          <div class="field"><label>Fabricação</label><input class="input" type="date" data-idx="${idx}" data-field="fabricacao" value="${it.fabricacao || ''}"></div>
          <div class="field"><label>Validade${!it.validade ? ' · <span class="hint">não identificada</span>' : ''}</label><input class="input" type="date" data-idx="${idx}" data-field="validade" value="${it.validade || ''}"></div>
        </div>
        <div style="text-align:right;margin-top:6px"><button class="icon-btn item-remove" data-idx="${idx}">🗑️ Remover</button></div>
      </div>`;
    }).join('');

    container.querySelectorAll('.item-use-suggestion').forEach(el => el.onclick = e => {
      const idx = Number(e.target.dataset.idx);
      items[idx].produtoId = e.target.dataset.sugid;
      items[idx].produtoNome = products.find(p => p.id === e.target.dataset.sugid)?.nome;
      drawItems();
    });
    container.querySelectorAll('.item-qtd').forEach(el => el.onchange = e => { items[e.target.dataset.idx].quantidade = Number(e.target.value) || 0; drawItems(); });
    container.querySelectorAll('.item-custo').forEach(el => el.onchange = e => { items[e.target.dataset.idx].custoUnitario = Math.max(0, Number(e.target.value) || 0); });
    container.querySelectorAll('.item-emb').forEach(el => el.onchange = e => { items[e.target.dataset.idx].embalagem = normalizeMovementUnit(e.target.value); drawItems(); });
    container.querySelectorAll('.item-lote').forEach(el => el.onchange = e => items[e.target.dataset.idx].lote = e.target.value.trim());
    container.querySelectorAll('[data-field="fabricacao"]').forEach(el => el.onchange = e => items[e.target.dataset.idx].fabricacao = e.target.value);
    container.querySelectorAll('[data-field="validade"]').forEach(el => el.onchange = e => { items[e.target.dataset.idx].validade = e.target.value; items[e.target.dataset.idx].validadeAutomatica = false; });
    container.querySelectorAll('.item-remove').forEach(el => el.onclick = e => { items.splice(Number(e.target.dataset.idx), 1); drawItems(); });

    container.querySelectorAll('.item-link-product').forEach(el => el.onchange = async e => {
      const idx = Number(e.target.dataset.idx);
      const product = products.find(p => p.id === e.target.value);
      if (!product) return;
      items[idx].produtoId = product.id;
      items[idx].produtoNome = product.nome;
      if (!items[idx].custoUnitario) items[idx].custoUnitario = Number(product.custoAtual || 0);
      drawItems();
    });

    container.querySelectorAll('.item-create-product').forEach(el => el.onclick = () => {
      const idx = Number(el.dataset.idx);
      openQuickProductCreate(items[idx], async (newProduct) => {
        items[idx].produtoId = newProduct.id;
        items[idx].produtoNome = newProduct.nome;
        openEntryForm(readHeader()); // reabre a entrada (o modal do produto fechou por cima dela)
      });
    });

    container.querySelectorAll('.item-scan').forEach(el => el.onclick = () => {
      const idx = Number(el.dataset.idx);
      const preserved = readHeader();
      openBarcodeScanner(async code => {
        const found = (await DB.all('products')).find(p => p.codigoBarras === code);
        if (found) {
          preserved.itens[idx].produtoId = found.id;
          preserved.itens[idx].produtoNome = found.nome;
          if (!preserved.itens[idx].custoUnitario) preserved.itens[idx].custoUnitario = Number(found.custoAtual || 0);
        } else {
          preserved.itens[idx].codigoBarras = code;
          preserved.itens[idx].produtoId = null;
        }
        openEntryForm(preserved);
      });
    });
  }
  drawItems();

  document.getElementById('e-data').addEventListener('change', (e) => {
    const novaData = e.target.value || todayISO();
    items.forEach(it => {
      if (it.validadeAutomatica !== false) {
        it.validade = addDaysISO(novaData, 40);
        it.validadeAutomatica = true;
      }
    });
    drawItems();
  });

  document.getElementById('add-item-btn').onclick = () => { items.push({ embalagem: 'Unidade', quantidade: 0, custoUnitario: 0, produtoId: null, nomeSugerido: '', validade: addDaysISO(document.getElementById('e-data')?.value || s.data, 40), validadeAutomatica: true }); drawItems(); };
  document.getElementById('e-cancel').onclick = closeModal;

  const saveBtn = document.getElementById('e-save');
  saveBtn.onclick = async () => {
    if (!ensureServerOnlineForCriticalAction()) return;
    const data = document.getElementById('e-data').value || todayISO();
    const fornecedor = document.getElementById('e-forn').value.trim();
    const nf = document.getElementById('e-nf').value.trim();
    if (!fornecedor) { toast('Informe o fornecedor.', 'warn'); return; }
    if (items.length === 0) { toast('Adicione ao menos um item.', 'warn'); return; }
    const pendentes = items.filter(i => !i.produtoId);
    if (pendentes.length > 0) { toast(`${pendentes.length} item(ns) ainda sem produto vinculado. Cadastre ou vincule antes de salvar.`, 'warn'); return; }
    const semQtd = items.filter(i => i.produtoId && (!i.quantidade || i.quantidade <= 0));
    if (semQtd.length > 0) { toast('Todo item precisa de uma quantidade maior que zero.', 'warn'); return; }

    try {
      await withBusyButton(saveBtn, 'Registrando…', () => postStock('/entries', {
        operationId: genOperationId(),
        fornecedor, nf, chaveNFe: s.chaveNFe || null, data, origemXML: s.origemXML, origemFoto: s.origemFoto, fotos: s.fotos,
        itens: items.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade, unidadeMovimentacao: normalizeMovementUnit(i.embalagem), lote: i.lote, fabricacao: i.fabricacao, validade: i.validade, custoUnitario: Number(i.custoUnitario || 0), embalagem: normalizeMovementUnit(i.embalagem) }))
      }));
      toast('Entrada registrada com sucesso.', 'success');
      closeModal();
      navigate('entries');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

/* Cadastro rápido de produto a partir de um item não reconhecido no XML.
   Cria só o cadastro (produtos continuam sendo CRUD simples) — nenhum
   lote é criado aqui, o lote nasce quando a entrada for salva. */
function openQuickProductCreate(item, onCreated) {
  openModal('Cadastrar novo produto', `
    <p class="hint">Item do XML: <strong>${escapeHTML(item.nomeSugerido || '')}</strong> ${item.codigoBarras ? `(${escapeHTML(item.codigoBarras)})` : ''}</p>
    <div class="form-grid">
      <div class="field field--full"><label>Nome</label><input class="input" id="qp-nome" value="${escapeHTML(item.nomeSugerido || '')}"></div>
      <div class="field"><label>Marca</label><input class="input" id="qp-marca"></div>
      <div class="field"><label>Sabor</label><input class="input" id="qp-sabor"></div>
      <div class="field"><label>Volume</label><input class="input" id="qp-volume" placeholder="Ex: 1L, 900ml"></div>
      <div class="field"><label>Estoque mínimo</label><input class="input" type="number" min="0" id="qp-min" value="10"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn--ghost" id="qp-cancel">Cancelar</button>
      <button class="btn btn--primary" id="qp-save">Cadastrar</button>
    </div>
  `);
  document.getElementById('qp-cancel').onclick = closeModal;
  document.getElementById('qp-save').onclick = async () => {
    const nome = document.getElementById('qp-nome').value.trim();
    if (!nome) { toast('Informe o nome do produto.', 'warn'); return; }
    const product = {
      id: uid('prod'), nome, marca: document.getElementById('qp-marca').value.trim(), sabor: document.getElementById('qp-sabor').value.trim(),
      volume: document.getElementById('qp-volume').value.trim(), embalagem: 'Outro', qtdPorEmbalagem: 1, unidadesPorFardo: 1, fardosPorPalete: null, nomeFardo: 'Fardo',
      estoqueMinimo: Number(document.getElementById('qp-min').value) || 10, codigoBarras: item.codigoBarras || '',
      localizacao: '', ativo: true, criadoEm: new Date().toISOString()
    };
    await DB.add('products', product);
    toast('Produto cadastrado.', 'success');
    closeModal();
    onCreated(product);
  };
}
