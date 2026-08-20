/* ============================================================
   VIEWS/PRODUCTS.JS — Cadastro de Produtos
   Etapa 3: produto com movimentação não pode mais ser excluído
   fisicamente — o servidor recusa (409) e a tela oferece
   "Desativar" no lugar. O estoque inicial do cadastro agora
   nasce como uma entrada de verdade (POST /api/stock/entries),
   não mais um DB.add('lots', ...) direto.
   ============================================================ */

async function renderProducts(root) {
  const products = await DB.all('products');
  const summary = await computeStockSummary();
  const summaryByProduct = Object.fromEntries(summary.map(s => [s.product.id, s]));
  let showInactive = false;

  root.innerHTML = `
    <div class="view-head">
      <div>
        <p class="subtitle">${products.filter(p => p.ativo !== false).length} produto(s) ativo(s)</p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="scan-lookup-btn">📷 Ler código</button>
        <button class="btn btn--primary" id="new-product-btn">+ Novo produto</button>
      </div>
    </div>
    <div class="filters">
      <div class="field" style="min-width:240px">
        <label>Buscar</label>
        <input class="input" id="filter-text" placeholder="Nome, marca, sabor ou código">
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-top:22px">
        <input type="checkbox" id="filter-inactive"> Mostrar desativados
      </label>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th>Produto</th><th>Marca / Sabor</th><th>Embalagem</th><th>Código</th>
          <th>Estoque</th><th>Custo unitário</th><th>Mínimo</th><th>Localização</th><th>Situação</th><th></th>
        </tr></thead>
        <tbody id="products-tbody"></tbody>
      </table>
    </div>
  `;

  function draw(list) {
    const tbody = document.getElementById('products-tbody');
    const visible = list.filter(p => showInactive || p.ativo !== false);
    if (visible.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="big">🧃</div><p>Nenhum produto encontrado.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = visible.map(p => {
      const s = summaryByProduct[p.id];
      const total = s ? s.totalDisponivel : 0;
      const low = total === 0 ? 'danger' : (total < p.estoqueMinimo ? 'warn' : 'ok');
      const ativo = p.ativo !== false;
      return `<tr style="${ativo ? '' : 'opacity:.55'}">
        <td><strong>${escapeHTML(p.nome)}</strong></td>
        <td>${escapeHTML(p.marca)} · ${escapeHTML(p.sabor)} · ${escapeHTML(p.volume)}</td>
        <td>${escapeHTML(p.embalagem)} · ${p.unidadesPorFardo || p.qtdPorEmbalagem || 1} un./${escapeHTML((p.nomeFardo || 'Fardo').toLowerCase())}</td>
        <td class="cell-mono"><strong>${escapeHTML(p.codigoInterno || '—')}</strong>${p.codigoBarras ? `<br><span class="hint">EAN ${escapeHTML(p.codigoBarras)}</span>` : ''}</td>
        <td>${statusStamp(fmtNumber(total) + ' un.', low)}</td>
        <td class="cell-mono"><strong>${Number(p.custoAtual || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong></td>
        <td class="cell-mono">${fmtNumber(p.estoqueMinimo)}</td>
        <td style="font-size:12px">${escapeHTML(p.localizacao || '—')}</td>
        <td>${ativo ? statusStamp('Ativo', 'ok') : statusStamp('Desativado', 'neutral')}</td>
        <td class="row-actions">
          <button class="icon-btn" data-edit="${p.id}" title="Editar">✏️</button>
          ${ativo
            ? `<button class="icon-btn" data-deactivate="${p.id}" title="Desativar">🚫</button>`
            : `<button class="icon-btn" data-activate="${p.id}" title="Reativar">✅</button>`}
          <button class="icon-btn" data-del="${p.id}" title="Excluir permanentemente">🗑️</button>
        </td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openProductForm(products.find(p => p.id === b.dataset.edit)));
    tbody.querySelectorAll('[data-del]').forEach(b => b.onclick = () => deleteProduct(b.dataset.del));
    tbody.querySelectorAll('[data-deactivate]').forEach(b => b.onclick = () => setProductActive(b.dataset.deactivate, false));
    tbody.querySelectorAll('[data-activate]').forEach(b => b.onclick = () => setProductActive(b.dataset.activate, true));
  }
  draw(products);

  document.getElementById('filter-text').addEventListener('input', debounce((e) => {
    const term = e.target.value.toLowerCase();
    draw(products.filter(p => [p.nome, p.marca, p.sabor, p.codigoInterno, p.codigoBarras].join(' ').toLowerCase().includes(term)));
  }, 200));
  document.getElementById('filter-inactive').addEventListener('change', (e) => { showInactive = e.target.checked; draw(products); });

  document.getElementById('new-product-btn').addEventListener('click', () => openProductForm(null));
  document.getElementById('scan-lookup-btn').addEventListener('click', () => {
    openBarcodeScanner(async (code) => {
      const found = products.find(p => p.codigoBarras === code);
      if (found) { openProductForm(found); toast('Produto encontrado.', 'success'); }
      else { toast('Código não cadastrado. Criando novo produto…', 'info'); openProductForm(null, code); }
    });
  });
}

async function setProductActive(id, ativo) {
  try {
    await postStock(`/products/${id}/${ativo ? 'activate' : 'deactivate'}`, {});
    toast(ativo ? 'Produto reativado.' : 'Produto desativado — não aparecerá mais em novas operações.', 'success');
    navigate('products');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteProduct(id) {
  const ok = await confirmDialog('Excluir permanentemente este produto? Só é possível se ele nunca teve nenhuma movimentação (entrada, saída, perda, lote). Se já teve, use "Desativar" em vez disso.');
  if (!ok) return;
  try {
    await DB.delete('products', id);
    toast('Produto excluído.', 'success');
    navigate('products');
  } catch (err) {
    toast(err.message || 'Não foi possível excluir este produto.', 'error');
  }
}

function collectProductDraft(isEdit) {
  const g = id => document.getElementById(id)?.value ?? '';
  return {
    codigoInterno: g('f-codigo-interno'), codigoBarras: g('f-codigo'), nome: g('f-nome'), marca: g('f-marca'), sabor: g('f-sabor'),
    volume: g('f-volume'), embalagem: g('f-embalagem'), qtdPorEmbalagem: g('f-qtdemb'), fardosPorPalete: g('f-fpp'), nomeFardo: g('f-nomefardo'),
    estoqueMinimo: g('f-min'), custoAtual: g('f-custo'), localizacao: g('f-loc'),
    lote: isEdit ? '' : g('f-lote'), fabricacao: isEdit ? '' : g('f-fab'),
    validade: isEdit ? '' : g('f-val'), qtd: isEdit ? '' : g('f-qtd')
  };
}

function openProductForm(product, prefillCode, draft) {
  const isEdit = !!product;
  const v = (key) => escapeHTML((draft && draft[key] !== undefined && draft[key] !== '') ? draft[key] : (product ? (product[key] ?? '') : ''));
  openModal(isEdit ? 'Editar produto' : 'Novo produto', `
    <div class="form-grid">
      <div class="field"><label>Código do produto</label><input class="input" id="f-codigo-interno" value="${v('codigoInterno')}" placeholder="Ex: 100"></div>
      <div class="field">
        <label>Código de barras / EAN (opcional)</label>
        <div class="input-with-btn">
          <input class="input" id="f-codigo" value="${draft?.codigoBarras ? escapeHTML(draft.codigoBarras) : escapeHTML(product?.codigoBarras || prefillCode || '')}" placeholder="Escaneie ou digite">
          <button class="btn btn--sm" id="f-scan" type="button">📷</button>
        </div>
      </div>
      <div class="field field--full"><label>Nome</label><input class="input" id="f-nome" value="${v('nome')}"><span class="hint">Ao salvar, o volume será incluído no nome em ml para facilitar a identificação.</span></div>
      <div class="field"><label>Marca</label><input class="input" id="f-marca" value="${v('marca')}"></div>
      <div class="field"><label>Sabor</label><input class="input" id="f-sabor" value="${v('sabor')}"></div>
      <div class="field"><label>Volume</label><input class="input" id="f-volume" placeholder="Ex: 1L, 900ml" value="${v('volume')}"></div>
      <div class="field">
        <label>Tipo de embalagem</label>
        <select class="input" id="f-embalagem">
          ${['Garrafa', 'Galão', 'Bag', 'Outro'].map(o => `<option ${(draft?.embalagem || product?.embalagem) === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Unidades por fardo/caixa</label><input class="input" type="number" min="1" step="1" id="f-qtdemb" value="${draft?.qtdPorEmbalagem || product?.qtdPorEmbalagem || 1}"></div>
      <div class="field"><label>Fardos/caixas por pallet</label><input class="input" type="number" min="1" step="0.5" id="f-fpp" value="${draft?.fardosPorPalete || product?.fardosPorPalete || ''}" placeholder="Opcional"></div>
      <div class="field"><label>Nome do agrupamento</label><select class="input" id="f-nomefardo"><option ${(draft?.nomeFardo || product?.nomeFardo || 'Fardo') === 'Fardo' ? 'selected' : ''}>Fardo</option><option ${(draft?.nomeFardo || product?.nomeFardo) === 'Caixa' ? 'selected' : ''}>Caixa</option></select></div>
      <div class="field"><label>Estoque mínimo</label><input class="input" type="number" min="0" id="f-min" value="${draft?.estoqueMinimo || product?.estoqueMinimo || 10}"></div>
      <div class="field"><label>Custo unitário (R$)</label><input class="input" type="number" min="0" step="0.01" id="f-custo" value="${draft?.custoAtual !== undefined ? draft.custoAtual : Number(product?.custoAtual || 0)}" placeholder="Ex: 4,35"><span class="hint">Agora o custo pode ser cadastrado já no novo produto e continua sendo atualizado nas entradas.</span></div>
      <div class="field field--full"><label>Localização no depósito (Rua · Prateleira · Posição)</label><input class="input" id="f-loc" placeholder="Ex: Rua 1 · Prateleira A · Pos. 3" value="${v('localizacao')}"></div>
    </div>
    ${!isEdit ? `
    <div class="section-title">Lote inicial (opcional)</div>
    <div class="form-grid form-grid--3">
      <div class="field"><label>Lote</label><input class="input" id="f-lote" value="${escapeHTML(draft?.lote || '')}"></div>
      <div class="field"><label>Fabricação</label><input class="input" type="date" id="f-fab" value="${draft?.fabricacao || todayISO()}"></div>
      <div class="field"><label>Validade</label><input class="input" type="date" id="f-val" value="${draft?.validade || ''}"></div>
      <div class="field field--full"><label>Quantidade em estoque</label><input class="input" type="number" min="0" id="f-qtd" value="${draft?.qtd || 0}"></div>
    </div>` : ''}
    <div class="form-actions">
      <button class="btn btn--ghost" id="f-cancel">Cancelar</button>
      <button class="btn btn--primary" id="f-save">${isEdit ? 'Salvar alterações' : 'Cadastrar produto'}</button>
    </div>
  `, { wide: true });

  document.getElementById('f-scan').onclick = () => {
    const currentDraft = collectProductDraft(isEdit);
    openBarcodeScanner(code => {
      currentDraft.codigoBarras = code;
      openProductForm(product, null, currentDraft);
    });
  };
  document.getElementById('f-cancel').onclick = closeModal;
  const saveBtn = document.getElementById('f-save');
  saveBtn.onclick = async () => {
    const nome = document.getElementById('f-nome').value.trim();
    if (!nome) { toast('Informe o nome do produto.', 'warn'); return; }
    const volume = document.getElementById('f-volume').value.trim();
    const volumeMl = volumeToMl(volume);
    const data = {
      codigoInterno: document.getElementById('f-codigo-interno').value.trim(),
      codigoBarras: document.getElementById('f-codigo').value.trim(),
      nome: productDisplayName({ nome, volume, volumeMl }),
      marca: document.getElementById('f-marca').value.trim(),
      sabor: document.getElementById('f-sabor').value.trim(),
      volume,
      volumeMl,
      embalagem: document.getElementById('f-embalagem').value,
      qtdPorEmbalagem: Number(document.getElementById('f-qtdemb').value) || 1,
      unidadesPorFardo: Number(document.getElementById('f-qtdemb').value) || 1,
      nomeFardo: document.getElementById('f-nomefardo').value || 'Fardo',
      fardosPorPalete: Number(document.getElementById('f-fpp').value) || null,
      estoqueMinimo: Number(document.getElementById('f-min').value) || 0,
      localizacao: document.getElementById('f-loc').value.trim(),
      custoAtual: Number(document.getElementById('f-custo')?.value || product?.custoAtual || 0)
    };
    if (isEdit) {
      const requestedCost = Number(data.custoAtual || 0);
      const productData = { ...data }; delete productData.custoAtual;
      const updated = { ...product, ...productData };
      await DB.put('products', updated);
      if (typeof Auth !== 'undefined' && Auth.isManager && Auth.isManager() && Math.abs(requestedCost - Number(product.custoAtual || 0)) > 0.00001) {
        await commercialFetch(`/costs/${product.id}`, { method:'POST', body:{ custo: requestedCost } });
      }
      toast('Produto atualizado.', 'success');
      closeModal();
      navigate('products');
    } else {
      const requestedCost = Number(data.custoAtual || 0);
      const newProduct = { id: uid('prod'), ...data, custoAtual: 0, ativo: true, criadoEm: new Date().toISOString() };
      await DB.add('products', newProduct);
      if (typeof Auth !== 'undefined' && Auth.isManager && Auth.isManager() && requestedCost >= 0) {
        try { await commercialFetch(`/costs/${newProduct.id}`, { method:'POST', body:{ custo: requestedCost } }); newProduct.custoAtual = requestedCost; }
        catch (err) { toast('Produto cadastrado, mas o custo não pôde ser salvo: ' + err.message, 'warn'); }
      }
      const qtd = Number(document.getElementById('f-qtd').value) || 0;
      if (qtd > 0) {
        if (!ensureServerOnlineForCriticalAction()) { navigate('products'); return; }
        try {
          await withBusyButton(saveBtn, 'Lançando estoque inicial…', () => postStock('/entries', {
            operationId: genOperationId(), fornecedor: 'Estoque inicial (cadastro do produto)', data: todayISO(),
            itens: [{ produtoId: newProduct.id, quantidade: qtd, lote: document.getElementById('f-lote').value.trim() || 'SEM-LOTE', fabricacao: document.getElementById('f-fab').value, validade: document.getElementById('f-val').value }]
          }));
        } catch (err) {
          toast('Produto cadastrado, mas houve um erro ao lançar o estoque inicial: ' + err.message, 'warn');
          closeModal();
          navigate('products');
          return;
        }
      }
      toast('Produto cadastrado.', 'success');
      closeModal();
      navigate('products');
    }
  };
}
