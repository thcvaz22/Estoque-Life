/* ============================================================
   SERVER/SERVICES/INVENTORYSERVICE.JS
   Toda a lógica de movimentação de estoque mora aqui — o
   frontend só chama os endpoints de stockRoutes.js, que apenas
   repassam para estas funções. Nenhuma tela decide FEFO,
   valida estoque ou altera lotes diretamente.

   GARANTIA DE CONCORRÊNCIA: cada função pública abaixo executa
   de forma SÍNCRONA (better-sqlite3 é síncrono) dentro de
   db.transaction(). Como o Node.js é single-threaded e nada aqui
   usa await/setTimeout/I/O assíncrono no meio do caminho, o
   event loop NUNCA processa uma segunda requisição HTTP no meio
   da execução de uma transação em andamento — a segunda requisição
   só começa a ser tratada depois que esta função já terminou
   (com commit ou rollback). Isso garante, por construção, que
   duas operações concorrentes sobre o mesmo lote nunca se
   intercalam. Além disso, as colunas de quantidade em "lots" têm
   CHECK (>= 0) no próprio SQLite: mesmo um bug aqui não
   conseguiria gravar estoque negativo (a query falharia).
   ============================================================ */

const { db } = require('../db');
const { nowUTCISOString, todayLocalISO } = require('../time');
const { toBaseUnits, normalizeMovementUnit } = require('../catalog');

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}


function addDaysISO(dateISO, days) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(dateISO || '')) ? String(dateISO) : todayLocalISO();
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function movementToUnits(product, quantidade, unidade) {
  try { return toBaseUnits(product, quantidade, unidade || 'Unidade'); }
  catch (err) { throw httpError(400, err.message); }
}

/* ---------- idempotência ---------- */
function getOperationResult(operationId) {
  if (!operationId) return undefined;
  const row = db.prepare('SELECT result FROM operations WHERE id = ?').get(operationId);
  return row ? JSON.parse(row.result) : undefined;
}
function saveOperationResult(operationId, result) {
  if (!operationId) return;
  db.prepare('INSERT OR IGNORE INTO operations (id, result, createdAt) VALUES (?, ?, ?)').run(operationId, JSON.stringify(result), nowUTCISOString());
}
// executa fn() com proteção de idempotência: se operationId já foi processado
// antes, devolve o resultado salvo sem executar fn() de novo.
function withIdempotency(operationId, fn) {
  const cached = getOperationResult(operationId);
  if (cached !== undefined) return cached;
  const result = fn();
  saveOperationResult(operationId, result);
  return result;
}

/* ---------- helpers de leitura/escrita ---------- */
function getProduct(id) {
  const row = db.prepare('SELECT json FROM products WHERE id = ?').get(id);
  return row ? JSON.parse(row.json) : null;
}
function getLotsForProduct(productId) {
  // validade mais próxima primeiro; sem validade (NULL) por último — regra de FEFO
  return db.prepare('SELECT * FROM lots WHERE productId = ? ORDER BY (validade IS NULL) ASC, validade ASC').all(productId);
}
function getLotById(id) {
  return db.prepare('SELECT * FROM lots WHERE id = ?').get(id);
}
function saveHistory(entry) {
  const row = { id: uid('hist'), timestamp: nowUTCISOString(), usuario: entry.usuario || 'Operador', ...entry };
  db.prepare('INSERT INTO history (id, json, updatedAt) VALUES (?, ?, ?)').run(row.id, JSON.stringify(row), row.timestamp);
  return row;
}
function saveDoc(store, id, obj) {
  db.prepare(`INSERT INTO ${store} (id, json, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updatedAt = excluded.updatedAt`).run(id, JSON.stringify(obj), nowUTCISOString());
  return obj;
}
function getDoc(store, id) {
  const row = db.prepare(`SELECT json FROM ${store} WHERE id = ?`).get(id);
  return row ? JSON.parse(row.json) : null;
}
function getAllDocs(store) {
  return db.prepare(`SELECT json FROM ${store}`).all().map(r => JSON.parse(r.json));
}

/* Estoque disponível "de verdade" para uma saída normal: soma dos lotes
   não vencidos. Lotes vencidos nunca entram numa saída comum (regra 23). */
function computeAvailable(productId) {
  const today = todayLocalISO();
  return getLotsForProduct(productId)
    .filter(l => !l.validade || l.validade >= today)
    .reduce((a, l) => a + l.quantidadeDisponivel, 0);
}

function activeReserved(productId, excludeOrderId = null) {
  if (excludeOrderId) {
    const row = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS q FROM stock_reservations WHERE productId = ? AND status = 'active' AND orderId <> ?`).get(productId, excludeOrderId);
    return Number(row?.q || 0);
  }
  const row = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS q FROM stock_reservations WHERE productId = ? AND status = 'active'`).get(productId);
  return Number(row?.q || 0);
}
function computeAvailableForExit(productId, reservationOrderId = null) {
  return Math.max(0, computeAvailable(productId) - activeReserved(productId, reservationOrderId));
}

/* Consome quantidade de um produto pelo critério FEFO, pulando lotes
   vencidos. Já assume que a disponibilidade foi validada antes.
   Retorna a lista de lotes efetivamente consumidos (para rastreabilidade
   e para permitir devolução exata depois). */
function consumeFEFO(productId, quantidade) {
  const today = todayLocalISO();
  const lots = getLotsForProduct(productId).filter(l => l.quantidadeDisponivel > 0 && (!l.validade || l.validade >= today));
  let restante = quantidade;
  const consumidos = [];
  for (const lot of lots) {
    if (restante <= 0) break;
    const usar = Math.min(lot.quantidadeDisponivel, restante);
    const res = db.prepare('UPDATE lots SET quantidadeDisponivel = quantidadeDisponivel - ?, updatedAt = ? WHERE id = ? AND quantidadeDisponivel >= ?')
      .run(usar, nowUTCISOString(), lot.id, usar);
    if (res.changes === 0) throw httpError(409, 'O estoque foi alterado por outra operação. Tente novamente.');
    consumidos.push({ lotId: lot.id, lote: lot.lote, quantidade: usar });
    restante -= usar;
  }
  if (restante > 0) throw httpError(409, 'Estoque insuficiente (alterado durante o processamento).');
  return consumidos;
}

/* ============================================================
   1. ENTRADA
   ============================================================ */
function createEntry({ operationId, fornecedor, fornecedorId, cnpjFornecedor, nf, serie, chaveNFe, data, valorTotalMercadorias, itens, origemXML, origemFoto, fotos, usuario }) {
  return withIdempotency(operationId, () => {
    if (!fornecedor) throw httpError(400, 'Informe o fornecedor.');
    if (!Array.isArray(itens) || itens.length === 0) throw httpError(400, 'Adicione ao menos um item.');

    const dataChegada = data || todayLocalISO();
    if (chaveNFe) {
      const dup = getAllDocs('entries').find(e => e.chaveNFe && e.chaveNFe === chaveNFe);
      if (dup) throw httpError(409, `Esta nota fiscal (chave ${chaveNFe}) já foi importada anteriormente em ${dup.data}.`);
    }

    const run = db.transaction(() => {
      const savedItems = [];
      for (const it of itens) {
        if (!it.produtoId || !it.quantidade || Number(it.quantidade) <= 0) throw httpError(400, 'Todo item precisa de produto e quantidade válidos.');
        const product = getProduct(it.produtoId);
        if (!product) throw httpError(404, `Produto não encontrado: ${it.produtoId}`);
        const unidadeMovimentacao = normalizeMovementUnit(it.unidadeMovimentacao || it.embalagem || 'Unidade');
        const quantidadeInformada = Number(it.quantidade);
        const quantidadeUnidades = movementToUnits(product, quantidadeInformada, unidadeMovimentacao);
        const lote = (it.lote || 'SEM-LOTE').trim() || 'SEM-LOTE';
        // Regra Life: validade padrão = 40 dias após a chegada. Pode ser sobrescrita na conferência.
        const validade = it.validade || addDaysISO(dataChegada, 40);
        const existing = db.prepare("SELECT * FROM lots WHERE productId = ? AND lote = ? AND IFNULL(validade,'') = IFNULL(?,'')").get(it.produtoId, lote, validade);
        if (existing) {
          db.prepare('UPDATE lots SET quantidadeDisponivel = quantidadeDisponivel + ?, updatedAt = ? WHERE id = ?').run(quantidadeUnidades, nowUTCISOString(), existing.id);
        } else {
          db.prepare(`INSERT INTO lots (id, productId, lote, fabricacao, validade, quantidadeDisponivel, quantidadeBloqueada, localizacao, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(uid('lot'), it.produtoId, lote, it.fabricacao || dataChegada, validade, quantidadeUnidades, it.localizacao || product.localizacao || '', nowUTCISOString());
        }
        const custoUnitario = Number(it.custoUnitario);
        if (Number.isFinite(custoUnitario) && custoUnitario >= 0) {
          const custoAnterior = Number(product.custoAtual || 0);
          if (Math.abs(custoAnterior - custoUnitario) > 0.00001) {
            product.custoAtual = custoUnitario;
            product.custoAtualizadoEm = nowUTCISOString();
            product.custoAtualizadoPor = usuario;
            saveDoc('products', product.id, product);
            const ch = { id: uid('cost'), produtoId: product.id, produtoNome: product.nome, custoAnterior, custoNovo: custoUnitario, data: nowUTCISOString(), responsavel: usuario, origem: 'entrada' };
            saveDoc('costHistory', ch.id, ch);
            saveHistory({ tipo:'custo_alterado', usuario, produtoId: product.id, produtoNome: product.nome, motivo:'Custo atualizado pela entrada de mercadoria', observacoes:`R$ ${custoAnterior.toFixed(2)} → R$ ${custoUnitario.toFixed(2)} · NF ${nf || '—'}` });
          }
        }
        saveHistory({
          tipo: origemXML ? 'importacao_xml' : (origemFoto ? 'importacao_foto' : 'entrada'), usuario, produtoId: it.produtoId, produtoNome: product.nome,
          quantidade: quantidadeUnidades, lote, nf: nf || null,
          motivo: origemXML ? 'Entrada via importação de XML de NF-e' : (origemFoto ? 'Entrada via foto da NF (OCR)' : 'Entrada manual de mercadoria'),
          observacoes: `Fornecedor: ${fornecedor} · Chegada: ${dataChegada} · ${quantidadeInformada} ${unidadeMovimentacao} = ${quantidadeUnidades} unidade(s) · Validade: ${validade}`
        });
        savedItems.push({ produtoId: it.produtoId, produtoNome: product.nome, quantidade: quantidadeUnidades, quantidadeInformada, unidadeMovimentacao, lote, validade, custoUnitario: Number.isFinite(Number(it.custoUnitario)) ? Number(it.custoUnitario) : Number(product.custoAtual || 0), valorTotalItem: Number.isFinite(Number(it.valorTotalItem)) && Number(it.valorTotalItem) > 0 ? Number(it.valorTotalItem) : quantidadeInformada * (Number.isFinite(Number(it.custoUnitario)) ? Number(it.custoUnitario) : Number(product.custoAtual || 0)), fiscal: it.fiscal && typeof it.fiscal === 'object' ? it.fiscal : null, embalagem: unidadeMovimentacao });
      }
      const calculatedTotal = savedItems.reduce((sum, it) => sum + Number(it.valorTotalItem || 0), 0);
      const entry = { id: uid('entry'), data: dataChegada, dataChegada, fornecedor, fornecedorId: fornecedorId || null, cnpjFornecedor: cnpjFornecedor || null, nf: nf || null, serie: serie || null, chaveNFe: chaveNFe || null, valorTotalMercadorias: Number(valorTotalMercadorias || 0) > 0 ? Number(valorTotalMercadorias) : calculatedTotal, itens: savedItems, origemXML: !!origemXML, origemFoto: !!origemFoto, fotos: Array.isArray(fotos) ? fotos : [], responsavel: usuario, criadoEm: nowUTCISOString() };
      saveDoc('entries', entry.id, entry);
      return entry;
    });

    return run();
  });
}

/* ============================================================
   2. SAÍDA — validação de TODA a carga antes de mexer em qualquer
   lote (atomicidade); consumo por NF, com FEFO no servidor.
   ============================================================ */
function createExit({ operationId, motorista, veiculo, placa, cliente, horarioSaida, status, nfs, origemRomaneio, romaneioNumero, fotos, usuario, reservationOrderId = null, ignoreReservations = false }) {
  return withIdempotency(operationId, () => {
    if (!motorista) throw httpError(400, 'Informe o motorista.');
    if (!Array.isArray(nfs) || nfs.length === 0) throw httpError(400, 'Informe ao menos uma NF com itens.');

    const run = db.transaction(() => {
      // 1) valida a carga inteira antes de tocar em qualquer lote
      const necessidadeTotal = {};
      for (const nfEntry of nfs) {
        if (!nfEntry.numero) throw httpError(400, 'Toda NF precisa de um número.');
        if (!(nfEntry.cliente || cliente)) throw httpError(400, `Informe o cliente da NF ${nfEntry.numero}.`);
        if (!Array.isArray(nfEntry.itens) || nfEntry.itens.length === 0) throw httpError(400, `NF ${nfEntry.numero} não tem itens.`);
        for (const it of nfEntry.itens) {
          if (!it.produtoId || !it.quantidade || Number(it.quantidade) <= 0) throw httpError(400, `Item inválido na NF ${nfEntry.numero}.`);
          const product = getProduct(it.produtoId);
          if (!product) throw httpError(404, `Produto não encontrado: ${it.produtoId}`);
          const unidadeMovimentacao = normalizeMovementUnit(it.unidadeMovimentacao || it.embalagem || 'Unidade');
          const quantidadeUnidades = movementToUnits(product, Number(it.quantidade), unidadeMovimentacao);
          it._quantidadeInformada = Number(it.quantidade);
          it._unidadeMovimentacao = unidadeMovimentacao;
          it._quantidadeUnidades = quantidadeUnidades;
          necessidadeTotal[it.produtoId] = (necessidadeTotal[it.produtoId] || 0) + quantidadeUnidades;
        }
      }
      for (const produtoId of Object.keys(necessidadeTotal)) {
        const disponivel = ignoreReservations ? computeAvailable(produtoId) : computeAvailableForExit(produtoId, reservationOrderId);
        if (disponivel < necessidadeTotal[produtoId]) {
          const product = getProduct(produtoId);
          throw httpError(409, `Estoque insuficiente para ${product ? product.nome : produtoId}. Disponível: ${disponivel}, solicitado: ${necessidadeTotal[produtoId]}.`);
        }
      }

      // 2) tudo validado — consome de fato, por NF/item, com FEFO
      const nfsSalvas = [];
      for (const nfEntry of nfs) {
        const itensSalvos = [];
        for (const it of nfEntry.itens) {
          const product = getProduct(it.produtoId);
          if (!product) throw httpError(404, `Produto não encontrado: ${it.produtoId}`);
          const lotesConsumidos = consumeFEFO(it.produtoId, it._quantidadeUnidades || it.quantidade);
          itensSalvos.push({ produtoId: it.produtoId, produtoNome: product.nome, quantidade: it._quantidadeUnidades || it.quantidade, quantidadeInformada: it._quantidadeInformada || it.quantidade, unidadeMovimentacao: it._unidadeMovimentacao || 'Unidade', quantidadeRetornada: 0, lotesConsumidos, lotesDevolvidos: {} });
          saveHistory({ tipo: 'saida', usuario, produtoId: it.produtoId, produtoNome: product.nome, quantidade: it._quantidadeUnidades || it.quantidade, nf: nfEntry.numero, motivo: origemRomaneio ? 'Carregamento importado de romaneio' : 'Carregamento para entrega', observacoes: `Cliente: ${nfEntry.cliente || cliente} · ${it._quantidadeInformada || it.quantidade} ${it._unidadeMovimentacao || 'Unidade'} = ${it._quantidadeUnidades || it.quantidade} unidade(s)` });
        }
        nfsSalvas.push({ numero: nfEntry.numero, cliente: nfEntry.cliente || cliente || '', itens: itensSalvos, status: 'entregue' });
      }

      const clientes = [...new Set(nfsSalvas.map(n => n.cliente).filter(Boolean))];
      const exit = {
        id: uid('exit'), motorista, veiculo: veiculo || '', placa: placa || '', cliente: cliente || clientes.join(', '),
        horarioSaida: horarioSaida || nowUTCISOString(), status: status || 'em_rota',
        nfs: nfsSalvas, origemRomaneio: !!origemRomaneio, romaneioNumero: romaneioNumero || '', fotos: Array.isArray(fotos) ? fotos : [], responsavel: usuario, criadoEm: nowUTCISOString()
      };
      saveDoc('exits', exit.id, exit);
      return exit;
    });

    return run();
  });
}

function concludeExit({ exitId, usuario }) {
  const exit = getDoc('exits', exitId);
  if (!exit) throw httpError(404, 'Saída não encontrada.');
  exit.status = 'concluida';
  exit.concluidoPor = usuario;
  exit.concluidoEm = nowUTCISOString();
  saveDoc('exits', exit.id, exit);
  saveHistory({ tipo: 'saida', usuario, motivo: 'Entrega concluída', observacoes: `Cliente: ${exit.cliente} · NFs: ${exit.nfs.map(n => n.numero).join(', ')}` });
  return exit;
}

/* ============================================================
   3. RETORNO / BACKLOG — por NF, com devolução parcial exata,
   distribuída de forma determinística pelos lotes originalmente
   consumidos (soma sempre bate com a quantidade retornada).
   ============================================================ */
function returnToBacklog({ operationId, exitId, retornos, motivo, usuario }) {
  // retornos: [{ nfNumero, produtoId, quantidade }]
  return withIdempotency(operationId, () => {
    if (!exitId) throw httpError(400, 'exitId é obrigatório.');
    if (!Array.isArray(retornos) || retornos.length === 0) throw httpError(400, 'Selecione ao menos um item para retornar.');

    const run = db.transaction(() => {
      const exit = getDoc('exits', exitId);
      if (!exit) throw httpError(404, 'Saída não encontrada.');

      const backlogsCriados = [];
      for (const ret of retornos) {
        const nfEntry = exit.nfs.find(n => n.numero === ret.nfNumero);
        if (!nfEntry) throw httpError(400, `NF ${ret.nfNumero} não pertence a esta saída.`);
        const item = nfEntry.itens.find(i => i.produtoId === ret.produtoId);
        if (!item) throw httpError(400, `Produto não encontrado na NF ${ret.nfNumero}.`);

        const jaRetornado = item.quantidadeRetornada || 0;
        const maximoRetornavel = item.quantidade - jaRetornado;
        if (!ret.quantidade || ret.quantidade <= 0 || ret.quantidade > maximoRetornavel) {
          throw httpError(400, `Quantidade de retorno inválida para ${item.produtoNome} na NF ${ret.nfNumero} (máximo possível: ${maximoRetornavel}).`);
        }

        // distribuição determinística pelos lotes originalmente consumidos
        const lotesDevolvidos = item.lotesDevolvidos || {};
        let restante = ret.quantidade;
        const lotesDestaDevolucao = [];
        for (const lc of item.lotesConsumidos) {
          if (restante <= 0) break;
          const devolvidoAntes = lotesDevolvidos[lc.lotId] || 0;
          const disponivelNesteLote = lc.quantidade - devolvidoAntes;
          if (disponivelNesteLote <= 0) continue;
          const usar = Math.min(disponivelNesteLote, restante);
          const res = db.prepare('UPDATE lots SET quantidadeBloqueada = quantidadeBloqueada + ?, updatedAt = ? WHERE id = ?').run(usar, nowUTCISOString(), lc.lotId);
          if (res.changes === 0) throw httpError(500, 'Lote original não encontrado ao processar devolução.');
          lotesDestaDevolucao.push({ lotId: lc.lotId, lote: lc.lote, quantidade: usar });
          lotesDevolvidos[lc.lotId] = devolvidoAntes + usar;
          restante -= usar;
        }
        if (restante > 0) throw httpError(500, 'Falha ao distribuir a devolução pelos lotes originais (dados inconsistentes).');

        item.quantidadeRetornada = jaRetornado + ret.quantidade;
        item.lotesDevolvidos = lotesDevolvidos;

        const backlogEntry = {
          id: uid('backlog'), exitId, nf: ret.nfNumero, cliente: nfEntry.cliente || exit.cliente, motorista: exit.motorista,
          produtoId: ret.produtoId, produtoNome: item.produtoNome, quantidade: ret.quantidade,
          lotesConsumidos: lotesDestaDevolucao, motivo: motivo || 'Não especificado',
          dataRetorno: nowUTCISOString(), status: 'bloqueado', responsavel: usuario
        };
        saveDoc('backlog', backlogEntry.id, backlogEntry);
        backlogsCriados.push(backlogEntry);

        saveHistory({ tipo: 'backlog_retorno', usuario, produtoId: ret.produtoId, produtoNome: item.produtoNome, quantidade: ret.quantidade, nf: ret.nfNumero, motivo: `Retorno de entrega: ${motivo || 'não especificado'}`, observacoes: `Cliente: ${nfEntry.cliente || exit.cliente}` });
      }

      // status por NF: entregue | parcial | pendente (tudo retornado)
      for (const nfEntry of exit.nfs) {
        const totalItens = nfEntry.itens.length;
        const totalTotalmenteRetornados = nfEntry.itens.filter(i => (i.quantidadeRetornada || 0) >= i.quantidade).length;
        const totalComAlgumRetorno = nfEntry.itens.filter(i => (i.quantidadeRetornada || 0) > 0).length;
        nfEntry.status = totalTotalmenteRetornados === totalItens ? 'pendente' : totalComAlgumRetorno > 0 ? 'parcial' : 'entregue';
      }
      exit.status = exit.nfs.some(n => n.status !== 'entregue') ? 'pendente' : exit.status;
      exit.ultimoAlteradoPor = usuario;
      exit.ultimoAlteradoEm = nowUTCISOString();
      saveDoc('exits', exit.id, exit);

      return backlogsCriados;
    });

    return run();
  });
}

/* ============================================================
   4. REENTREGA — baixa do BLOQUEADO (nunca do disponível) e
   gera uma nova saída, mantendo rastreabilidade da NF original.
   ============================================================ */
function redeliverBacklog({ operationId, backlogIds, motorista, veiculo, placa, horarioSaida, usuario }) {
  return withIdempotency(operationId, () => {
    if (!Array.isArray(backlogIds) || backlogIds.length === 0) throw httpError(400, 'Selecione ao menos um item de backlog para reentrega.');

    const run = db.transaction(() => {
      const itensNovaSaida = [];
      const clientes = new Set();
      const origemNFs = new Set();

      for (const id of backlogIds) {
        if (!id) throw httpError(400, 'ID de backlog inválido.');
        const bl = getDoc('backlog', id);
        if (!bl) throw httpError(404, `Backlog ${id} não encontrado.`);
        if (bl.status !== 'bloqueado') throw httpError(409, `Backlog de ${bl.produtoNome} não está mais disponível para reentrega (status atual: ${bl.status}).`);

        for (const lc of bl.lotesConsumidos) {
          const lot = getLotById(lc.lotId);
          if (!lot || lot.quantidadeBloqueada < lc.quantidade) throw httpError(409, 'Inconsistência no estoque bloqueado — operação cancelada.');
        }
        for (const lc of bl.lotesConsumidos) {
          const res = db.prepare('UPDATE lots SET quantidadeBloqueada = quantidadeBloqueada - ?, updatedAt = ? WHERE id = ? AND quantidadeBloqueada >= ?').run(lc.quantidade, nowUTCISOString(), lc.lotId, lc.quantidade);
          if (res.changes === 0) throw httpError(409, 'O estoque bloqueado foi alterado por outra operação. Tente novamente.');
        }

        clientes.add(bl.cliente);
        origemNFs.add(bl.nf);
        itensNovaSaida.push({ produtoId: bl.produtoId, produtoNome: bl.produtoNome, quantidade: bl.quantidade, quantidadeRetornada: 0, lotesConsumidos: bl.lotesConsumidos, lotesDevolvidos: {}, origemBacklogId: bl.id });
        saveHistory({ tipo: 'saida', usuario, produtoId: bl.produtoId, produtoNome: bl.produtoNome, quantidade: bl.quantidade, nf: bl.nf, motivo: 'Reentrega de backlog', observacoes: `Backlog original: ${bl.id}` });

        bl.status = 'concluido';
        bl.reentreguePor = usuario;
        bl.liberadoEm = nowUTCISOString();
        saveDoc('backlog', bl.id, bl);
      }

      const exit = {
        id: uid('exit'), motorista: motorista || '', veiculo: veiculo || '', placa: placa || '',
        cliente: [...clientes].join(', '), horarioSaida: horarioSaida || nowUTCISOString(), status: 'em_rota',
        nfs: [{ numero: `REENTREGA (${[...origemNFs].join(', ')})`, itens: itensNovaSaida, status: 'entregue' }],
        origemBacklogIds: backlogIds, responsavel: usuario, criadoEm: nowUTCISOString()
      };
      saveDoc('exits', exit.id, exit);
      return exit;
    });

    return run();
  });
}

/* ============================================================
   5. LIBERAÇÃO DE BACKLOG — baixa definitiva do bloqueado, SEM
   aumentar o disponível (é uma baixa, não um retorno ao estoque).
   ============================================================ */
function releaseBacklog({ operationId, backlogIds, motivo, usuario }) {
  return withIdempotency(operationId, () => {
    if (!Array.isArray(backlogIds) || backlogIds.length === 0) throw httpError(400, 'Selecione ao menos um item de backlog.');

    const run = db.transaction(() => {
      const liberados = [];
      for (const id of backlogIds) {
        if (!id) throw httpError(400, 'ID de backlog inválido.');
        const bl = getDoc('backlog', id);
        if (!bl) throw httpError(404, `Backlog ${id} não encontrado.`);
        if (bl.status !== 'bloqueado') throw httpError(409, `Backlog de ${bl.produtoNome} não está mais bloqueado (status atual: ${bl.status}).`);

        for (const lc of bl.lotesConsumidos) {
          const lot = getLotById(lc.lotId);
          if (!lot || lot.quantidadeBloqueada < lc.quantidade) throw httpError(409, 'Inconsistência no estoque bloqueado — operação cancelada.');
        }
        for (const lc of bl.lotesConsumidos) {
          const res = db.prepare('UPDATE lots SET quantidadeBloqueada = quantidadeBloqueada - ?, updatedAt = ? WHERE id = ? AND quantidadeBloqueada >= ?').run(lc.quantidade, nowUTCISOString(), lc.lotId, lc.quantidade);
          if (res.changes === 0) throw httpError(409, 'O estoque bloqueado foi alterado por outra operação. Tente novamente.');
        }

        bl.status = 'cancelado';
        bl.motivoLiberacao = motivo || '';
        bl.liberadoPor = usuario;
        bl.liberadoEm = nowUTCISOString();
        saveDoc('backlog', bl.id, bl);
        saveHistory({ tipo: 'ajuste', usuario, produtoId: bl.produtoId, produtoNome: bl.produtoNome, quantidade: -bl.quantidade, nf: bl.nf, motivo: `Baixa definitiva de backlog: ${motivo || 'não especificado'}` });
        liberados.push(bl);
      }
      return liberados;
    });

    return run();
  });
}

/* ============================================================
   6. AVARIAS E PERDAS
   ============================================================ */
function createLoss({ operationId, produtoId, quantidade, motivo, data, responsavel, origem, usuario }) {
  return withIdempotency(operationId, () => {
    if (!produtoId || !quantidade || quantidade <= 0) throw httpError(400, 'Selecione o produto e informe a quantidade.');
    const bucket = origem === 'bloqueado' ? 'quantidadeBloqueada' : 'quantidadeDisponivel';

    const run = db.transaction(() => {
      const product = getProduct(produtoId);
      if (!product) throw httpError(404, 'Produto não encontrado.');
      const lots = getLotsForProduct(produtoId);
      const total = lots.reduce((a, l) => a + l[bucket], 0);
      if (total < quantidade) throw httpError(409, `Estoque ${origem === 'bloqueado' ? 'bloqueado' : 'disponível'} insuficiente. Disponível para baixa: ${total}.`);

      let restante = quantidade;
      for (const lot of lots) {
        if (restante <= 0) break;
        const usar = Math.min(lot[bucket], restante);
        if (usar <= 0) continue;
        const res = db.prepare(`UPDATE lots SET ${bucket} = ${bucket} - ?, updatedAt = ? WHERE id = ? AND ${bucket} >= ?`).run(usar, nowUTCISOString(), lot.id, usar);
        if (res.changes === 0) throw httpError(409, 'O estoque foi alterado por outra operação. Tente novamente.');
        restante -= usar;
      }

      const loss = { id: uid('loss'), produtoId, produtoNome: product.nome, quantidade, motivo, data: data || todayLocalISO(), responsavel: usuario || 'Usuário autenticado', origem: origem || 'disponivel', criadoEm: nowUTCISOString() };
      saveDoc('losses', loss.id, loss);
      saveHistory({ tipo: 'avaria', usuario, produtoId, produtoNome: product.nome, quantidade, motivo, observacoes: `Responsável: ${loss.responsavel} · Origem: ${loss.origem === 'bloqueado' ? 'estoque bloqueado' : 'estoque disponível'}` });
      return loss;
    });

    return run();
  });
}

/* ============================================================
   7. INVENTÁRIO — ajuste identificado (referencia o inventário
   de origem), nunca um lote genérico solto sem rastro.
   ============================================================ */
function applyAdjustmentToLots(productId, bucket, delta, inventoryId) {
  if (delta > 0) {
    db.prepare(`INSERT INTO lots (id, productId, lote, fabricacao, validade, quantidadeDisponivel, quantidadeBloqueada, localizacao, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      uid('lot'), productId, `AJUSTE-INV-${inventoryId.slice(-6).toUpperCase()}`, todayLocalISO(), null,
      bucket === 'quantidadeDisponivel' ? delta : 0, bucket === 'quantidadeBloqueada' ? delta : 0, '', nowUTCISOString()
    );
  } else if (delta < 0) {
    let restante = -delta;
    const lots = getLotsForProduct(productId).filter(l => l[bucket] > 0);
    for (const lot of lots) {
      if (restante <= 0) break;
      const usar = Math.min(lot[bucket], restante);
      db.prepare(`UPDATE lots SET ${bucket} = ${bucket} - ?, updatedAt = ? WHERE id = ? AND ${bucket} >= ?`).run(usar, nowUTCISOString(), lot.id, usar);
      restante -= usar;
    }
  }
}

function createInventoryAdjustment({ operationId, itens, usuario }) {
  // itens: [{ produtoId, esperadoDisponivel, contadoDisponivel, esperadoBloqueado, contadoBloqueado }]
  return withIdempotency(operationId, () => {
    if (!Array.isArray(itens) || itens.length === 0) throw httpError(400, 'Nenhum item contado.');

    const run = db.transaction(() => {
      const inventoryId = uid('inv');
      const registros = [];
      for (const it of itens) {
        if (!it || !it.produtoId) continue;
        const product = getProduct(it.produtoId);
        if (!product) continue;
        const deltaDisp = (Number(it.contadoDisponivel) || 0) - (Number(it.esperadoDisponivel) || 0);
        const deltaBloq = (Number(it.contadoBloqueado) || 0) - (Number(it.esperadoBloqueado) || 0);
        if (deltaDisp !== 0) applyAdjustmentToLots(it.produtoId, 'quantidadeDisponivel', deltaDisp, inventoryId);
        if (deltaBloq !== 0) applyAdjustmentToLots(it.produtoId, 'quantidadeBloqueada', deltaBloq, inventoryId);
        if (deltaDisp !== 0 || deltaBloq !== 0) {
          saveHistory({
            tipo: 'inventario', usuario, produtoId: it.produtoId, produtoNome: product.nome, quantidade: deltaDisp,
            motivo: 'Ajuste por divergência de inventário',
            observacoes: `Inventário ${inventoryId} · Disponível: esperado ${it.esperadoDisponivel} → contado ${it.contadoDisponivel} · Bloqueado: esperado ${it.esperadoBloqueado} → contado ${it.contadoBloqueado}`
          });
        }
        registros.push({ produtoId: it.produtoId, produtoNome: product.nome, esperadoDisponivel: it.esperadoDisponivel, contadoDisponivel: it.contadoDisponivel, esperadoBloqueado: it.esperadoBloqueado, contadoBloqueado: it.contadoBloqueado });
      }
      const inventory = { id: inventoryId, data: nowUTCISOString(), usuario, responsavel: usuario, itens: registros, status: 'concluido' };
      saveDoc('inventories', inventoryId, inventory);
      return inventory;
    });

    return run();
  });
}

/* ============================================================
   8. AJUSTE MANUAL DE ESTOQUE (tela de lote) — nunca editar
   quantidade diretamente; sempre por aqui, com motivo e histórico.
   ============================================================ */
function adjustStock({ operationId, lotId, tipo, quantidade, motivo, observacoes, usuario }) {
  return withIdempotency(operationId, () => {
    if (!lotId || !quantidade || quantidade <= 0) throw httpError(400, 'Informe o lote e a quantidade.');
    if (!['entrada', 'saida'].includes(tipo)) throw httpError(400, 'Tipo de ajuste inválido.');

    const run = db.transaction(() => {
      const lot = getLotById(lotId);
      if (!lot) throw httpError(404, 'Lote não encontrado.');
      const product = getProduct(lot.productId);
      const delta = tipo === 'saida' ? -quantidade : quantidade;

      if (delta < 0) {
        const res = db.prepare('UPDATE lots SET quantidadeDisponivel = quantidadeDisponivel + ?, updatedAt = ? WHERE id = ? AND quantidadeDisponivel >= ?').run(delta, nowUTCISOString(), lotId, -delta);
        if (res.changes === 0) throw httpError(409, `Ajuste deixaria o estoque negativo (disponível atual: ${lot.quantidadeDisponivel}).`);
      } else {
        db.prepare('UPDATE lots SET quantidadeDisponivel = quantidadeDisponivel + ?, updatedAt = ? WHERE id = ?').run(delta, nowUTCISOString(), lotId);
      }

      saveHistory({ tipo: 'ajuste', usuario, produtoId: lot.productId, produtoNome: product ? product.nome : '', quantidade: delta, lote: lot.lote, motivo, observacoes });
      return getLotById(lotId);
    });

    return run();
  });
}

function updateLotMeta({ lotId, lote, fabricacao, validade, localizacao, usuario }) {
  const existing = getLotById(lotId);
  if (!existing) throw httpError(404, 'Lote não encontrado.');
  db.prepare('UPDATE lots SET lote = ?, fabricacao = ?, validade = ?, localizacao = ?, updatedAt = ? WHERE id = ?')
    .run(lote || existing.lote, fabricacao || existing.fabricacao, validade || null, localizacao || '', nowUTCISOString(), lotId);
  saveHistory({ tipo: 'edicao_produto', usuario, produtoId: existing.productId, lote: lote || existing.lote, motivo: 'Edição de dados do lote (lote/validade/fabricação/localização)' });
  return getLotById(lotId);
}

function listAllLots() {
  return db.prepare('SELECT * FROM lots ORDER BY (validade IS NULL) ASC, validade ASC').all();
}

module.exports = {
  httpError,
  computeAvailable,
  computeAvailableForExit,
  createEntry, createExit, concludeExit,
  returnToBacklog, redeliverBacklog, releaseBacklog,
  createLoss, createInventoryAdjustment, adjustStock, updateLotMeta,
  computeAvailable, listAllLots, getLotsForProduct,
  recordHistory: saveHistory
};
