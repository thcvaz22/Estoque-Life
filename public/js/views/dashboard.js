/* ============================================================
   VIEWS/DASHBOARD.JS — Dashboard visual, dinâmico e editável
   - Saudação com o nome de quem fez login
   - 8 gráficos visíveis por vez
   - Modal "Editar" para trocar os gráficos
   - Card AION IA com dicas de gestão
   ============================================================ */

const DASHBOARD_PREFS_KEY = 'life_dashboard_selected_charts_v8';
let __dashboardChartInstances = [];

function money(n){ return Number(n || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }

function destroyDashboardCharts() {
  __dashboardChartInstances.forEach(c => { try { c.destroy(); } catch(e){} });
  __dashboardChartInstances = [];
}

function dashboardDefaultSelection() {
  return [
    'movement7',
    'stockStatus',
    'validityLots',
    'inventoryByBrand',
    'topProducts',
    'orderStatus',
    'topClients',
    'topSellers'
  ];
}

function loadDashboardSelection() {
  try {
    const stored = JSON.parse(localStorage.getItem(DASHBOARD_PREFS_KEY) || '[]');
    if (Array.isArray(stored) && stored.length === 8) return stored.slice(0, 8);
  } catch(e) {}
  return dashboardDefaultSelection();
}

function saveDashboardSelection(ids) {
  localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(ids.slice(0, 8)));
}

function aggregateBy(list, getKey, getValue) {
  const map = new Map();
  (list || []).forEach(item => {
    const key = getKey(item) || 'Não informado';
    const value = Number(getValue(item) || 0);
    map.set(key, (map.get(key) || 0) + value);
  });
  return [...map.entries()].map(([label, value]) => ({ label, value }));
}

function lastNDatesISO(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (n - 1 - i));
    return d.toLocaleDateString('sv-SE');
  });
}

function sumOrderValue(order) {
  if (order && Number(order.total || 0) > 0) return Number(order.total || 0);
  return (order?.itens || []).reduce((acc, item) => acc + Number(item.subtotal || (Number(item.quantidade || 0) * Number(item.precoUnitario || 0))), 0);
}

async function gatherDashboardData() {
  const [summary, entries, exits, backlog, history, products, losses] = await Promise.all([
    computeStockSummary(),
    DB.all('entries'),
    DB.all('exits'),
    DB.all('backlog'),
    DB.all('history'),
    DB.all('products'),
    DB.all('losses')
  ]);

  let orders = [];
  let pendingCustomers = [];
  try {
    [orders, pendingCustomers] = await Promise.all([
      commercialFetch('/orders'),
      commercialFetch('/customers/pending')
    ]);
  } catch(e) {
    orders = [];
    pendingCustomers = [];
  }

  const currentUser = (typeof Auth !== 'undefined' && Auth.currentUser) ? Auth.currentUser() : null;
  const currentName = currentUser?.nome || currentUser?.username || 'Usuário';

  const today = todayISO();
  const last7 = lastNDatesISO(7);
  const last30 = lastNDatesISO(30);

  const totalUnits = summary.reduce((acc, item) => acc + Number(item.totalDisponivel || 0), 0);
  const totalBlockedUnits = summary.reduce((acc, item) => acc + Number(item.totalBloqueada || 0), 0);
  const totalValue = summary.reduce((acc, item) => acc + (Number(item.totalDisponivel || 0) * Number(item.product.custoAtual || 0)), 0);
  const lowStock = summary.filter(item => Number(item.totalDisponivel || 0) > 0 && Number(item.totalDisponivel || 0) < Number(item.product.estoqueMinimo || 0));
  const zeroStock = summary.filter(item => Number(item.totalDisponivel || 0) === 0);
  const healthyStock = summary.filter(item => Number(item.totalDisponivel || 0) >= Number(item.product.estoqueMinimo || 0));

  let expiringLots = 0;
  let expiredLots = 0;
  let validLots = 0;
  summary.forEach(item => (item.lots || []).forEach(lot => {
    const state = validadeState(lot.validade);
    if (state.dias === null) return;
    if (state.dias < 0) expiredLots += 1;
    else if (state.dias <= 30) expiringLots += 1;
    else validLots += 1;
  }));

  const entriesByDay = last7.map(day =>
    entries.filter(entry => entry.data === day)
      .reduce((acc, entry) => acc + (entry.itens || []).reduce((sum, item) => sum + Number(item.quantidade || 0), 0), 0)
  );
  const exitsByDay = last7.map(day =>
    exits.filter(exit => exit.horarioSaida && String(exit.horarioSaida).slice(0, 10) === day)
      .reduce((acc, exit) => acc + exitTotalQtd(exit), 0)
  );

  const lossesByDay = last30.map(day =>
    losses.filter(loss => String(loss.data || '').slice(0, 10) === day)
      .reduce((acc, loss) => acc + Number(loss.quantidade || 0), 0)
  );

  const ordersByDay = last7.map(day =>
    orders.filter(order => String(order.criadoEm || '').slice(0, 10) === day)
      .reduce((acc, order) => acc + sumOrderValue(order), 0)
  );

  const topProducts = summary
    .map(item => ({ label: item.product.nome, value: Number(item.totalDisponivel || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const inventoryByBrand = aggregateBy(summary, item => item.product.marca || 'Sem marca', item => item.totalDisponivel)
    .sort((a,b) => b.value - a.value)
    .slice(0, 6);

  const topClients = aggregateBy(orders, order => order.clienteNome || 'Não informado', order => sumOrderValue(order))
    .sort((a,b) => b.value - a.value)
    .slice(0, 6);

  const topSellers = aggregateBy(orders, order => order.vendedorNome || 'Não informado', order => sumOrderValue(order))
    .sort((a,b) => b.value - a.value)
    .slice(0, 6);

  const orderStatusBreakdown = aggregateBy(orders, order => {
    const status = String(order.status || 'sem_status').replaceAll('_', ' ');
    return status.charAt(0).toUpperCase() + status.slice(1);
  }, () => 1).sort((a,b) => b.value - a.value);

  const backlogStatusBreakdown = aggregateBy(backlog, item => {
    const status = String(item.status || 'sem_status').replaceAll('_', ' ');
    return status.charAt(0).toUpperCase() + status.slice(1);
  }, () => 1).sort((a,b) => b.value - a.value);

  const recentHistory = history.slice().sort((a,b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, 6);

  const exitsTodayCount = exits.filter(item => item.horarioSaida && String(item.horarioSaida).slice(0, 10) === today).length;
  const entriesTodayCount = entries.filter(item => item.data === today).length;
  const ordersPendingApproval = orders.filter(order => order.status === 'enviado').length;
  const backlogPending = backlog.filter(item => item.status === 'bloqueado' || item.status === 'pendente').length;

  const lowStockHighlights = lowStock
    .slice()
    .sort((a,b) => ((a.totalDisponivel / Math.max(1, a.product.estoqueMinimo || 1)) - (b.totalDisponivel / Math.max(1, b.product.estoqueMinimo || 1))))
    .slice(0, 5)
    .map(item => `${item.product.nome}: ${fmtNumber(item.totalDisponivel)} disponível(is) para mínimo ${fmtNumber(item.product.estoqueMinimo || 0)}`);

  return {
    currentName,
    currentUser,
    summary,
    entries,
    exits,
    backlog,
    history,
    products,
    losses,
    orders,
    pendingCustomers,
    totalUnits,
    totalBlockedUnits,
    totalValue,
    lowStock,
    zeroStock,
    healthyStock,
    validLots,
    expiringLots,
    expiredLots,
    last7,
    last30,
    entriesByDay,
    exitsByDay,
    lossesByDay,
    ordersByDay,
    topProducts,
    inventoryByBrand,
    topClients,
    topSellers,
    orderStatusBreakdown,
    backlogStatusBreakdown,
    recentHistory,
    entriesTodayCount,
    exitsTodayCount,
    ordersPendingApproval,
    backlogPending,
    lowStockHighlights
  };
}

function dashboardChartDefinitions(data) {
  const l7 = data.last7.map(d => fmtDate(d).slice(0,5));
  const l30 = data.last30.map(d => fmtDate(d).slice(0,5));
  const sharedText = '#66745E';
  const sharedGrid = 'rgba(62,103,51,0.10)';

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: sharedText, font: { family: 'Inter', size: 11 } } }
    },
    scales: {
      x: { ticks: { color: sharedText }, grid: { color: 'rgba(0,0,0,0)', drawBorder: false } },
      y: { ticks: { color: sharedText }, grid: { color: sharedGrid, drawBorder: false }, beginAtZero: true }
    }
  };

  return [
    {
      id: 'movement7',
      title: 'Movimentação · últimos 7 dias',
      description: 'Comparativo entre entradas e saídas do estoque.',
      typeLabel: 'Linha',
      create: () => ({
        type: 'line',
        data: {
          labels: l7,
          datasets: [
            { label: 'Entradas', data: data.entriesByDay, borderColor: '#64B64F', backgroundColor: 'rgba(100,182,79,.16)', fill: true, tension: .35, pointRadius: 3 },
            { label: 'Saídas', data: data.exitsByDay, borderColor: '#F08A24', backgroundColor: 'rgba(240,138,36,.10)', fill: true, tension: .35, pointRadius: 3 }
          ]
        },
        options: baseOptions
      })
    },
    {
      id: 'stockStatus',
      title: 'Situação do estoque',
      description: 'Visão geral dos principais estados do estoque.',
      typeLabel: 'Pizza',
      create: () => ({
        type: 'doughnut',
        data: {
          labels: ['Saudável', 'Baixo', 'Zerado', 'Bloqueado'],
          datasets: [{ data: [data.healthyStock.length, data.lowStock.length, data.zeroStock.length, data.totalBlockedUnits], backgroundColor: ['#64B64F','#F6B52B','#D94A36','#BDBDBD'], borderWidth: 0 }]
        },
        options: { responsive:true, maintainAspectRatio:false, cutout:'68%', plugins:{ legend:{ position:'bottom', labels:{ color: sharedText, boxWidth: 10 }}} }
      })
    },
    {
      id: 'validityLots',
      title: 'Validade dos lotes',
      description: 'Lotes dentro do prazo, próximos do vencimento e vencidos.',
      typeLabel: 'Pizza',
      create: () => ({
        type: 'pie',
        data: {
          labels: ['Dentro do prazo', 'Próx. vencimento', 'Vencidos'],
          datasets: [{ data: [data.validLots, data.expiringLots, data.expiredLots], backgroundColor: ['#8FD76F','#F6B52B','#D94A36'], borderWidth: 0 }]
        },
        options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color: sharedText, boxWidth: 10 }}} }
      })
    },
    {
      id: 'inventoryByBrand',
      title: 'Estoque por marca',
      description: 'Quantidade disponível agrupada por marca.',
      typeLabel: 'Barra',
      create: () => ({
        type: 'bar',
        data: {
          labels: data.inventoryByBrand.map(x => x.label),
          datasets: [{ label: 'Unidades', data: data.inventoryByBrand.map(x => x.value), backgroundColor: 'rgba(100,182,79,.85)', borderRadius: 8, maxBarThickness: 24 }]
        },
        options: baseOptions
      })
    },
    {
      id: 'topProducts',
      title: 'Top produtos em estoque',
      description: 'Itens com maior quantidade disponível.',
      typeLabel: 'Barra horizontal',
      create: () => ({
        type: 'bar',
        data: {
          labels: data.topProducts.map(x => x.label),
          datasets: [{ label: 'Unidades', data: data.topProducts.map(x => x.value), backgroundColor: 'rgba(47,125,50,.85)', borderRadius: 8 }]
        },
        options: { ...baseOptions, indexAxis: 'y' }
      })
    },
    {
      id: 'losses30',
      title: 'Perdas · últimos 30 dias',
      description: 'Acompanhamento diário de perdas e avarias.',
      typeLabel: 'Linha',
      create: () => ({
        type: 'line',
        data: {
          labels: l30,
          datasets: [{ label: 'Perdas', data: data.lossesByDay, borderColor: '#D94A36', backgroundColor:'rgba(217,74,54,.14)', fill:true, tension:.25, pointRadius:2 }]
        },
        options: baseOptions
      })
    },
    {
      id: 'orderStatus',
      title: 'Pedidos por status',
      description: 'Distribuição dos pedidos no fluxo comercial.',
      typeLabel: 'Rosca',
      create: () => ({
        type: 'doughnut',
        data: {
          labels: data.orderStatusBreakdown.map(x => x.label),
          datasets: [{ data: data.orderStatusBreakdown.map(x => x.value), backgroundColor: ['#64B64F','#F6B52B','#F08A24','#D94A36','#A3A3A3','#8BC34A'], borderWidth: 0 }]
        },
        options: { responsive:true, maintainAspectRatio:false, cutout:'60%', plugins:{ legend:{ position:'bottom', labels:{ color: sharedText, boxWidth: 10 }}} }
      })
    },
    {
      id: 'topClients',
      title: 'Melhores clientes',
      description: 'Clientes com maior volume financeiro em pedidos.',
      typeLabel: 'Barra',
      create: () => ({
        type: 'bar',
        data: { labels: data.topClients.map(x => x.label), datasets: [{ label: 'R$', data: data.topClients.map(x => Number(x.value.toFixed(2))), backgroundColor: 'rgba(246,181,43,.90)', borderRadius: 8 }] },
        options: { ...baseOptions, scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, ticks: { color: sharedText, callback: (v) => money(v) } } }, plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(ctx)=>money(ctx.parsed.y ?? ctx.parsed) } } } }
      })
    },
    {
      id: 'topSellers',
      title: 'Melhores vendedores',
      description: 'Vendedores com maior volume financeiro em pedidos.',
      typeLabel: 'Barra',
      create: () => ({
        type: 'bar',
        data: { labels: data.topSellers.map(x => x.label), datasets: [{ label: 'R$', data: data.topSellers.map(x => Number(x.value.toFixed(2))), backgroundColor: 'rgba(100,182,79,.92)', borderRadius: 8 }] },
        options: { ...baseOptions, scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, ticks: { color: sharedText, callback: (v) => money(v) } } }, plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(ctx)=>money(ctx.parsed.y ?? ctx.parsed) } } } }
      })
    },
    {
      id: 'salesByDay',
      title: 'Vendas por dia',
      description: 'Valor vendido nos últimos 7 dias.',
      typeLabel: 'Linha',
      create: () => ({
        type: 'line',
        data: { labels: l7, datasets: [{ label: 'Vendas', data: data.ordersByDay, borderColor: '#2F7D32', backgroundColor: 'rgba(47,125,50,.12)', fill: true, tension: .35, pointRadius: 3 }] },
        options: { ...baseOptions, scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, ticks: { color: sharedText, callback: (v) => money(v) } } }, plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(ctx)=>money(ctx.parsed.y ?? ctx.parsed) } } } }
      })
    },
    {
      id: 'backlogStatus',
      title: 'Backlog por status',
      description: 'Situação atual dos registros de backlog.',
      typeLabel: 'Pizza',
      create: () => ({
        type: 'polarArea',
        data: { labels: data.backlogStatusBreakdown.map(x => x.label), datasets: [{ data: data.backlogStatusBreakdown.map(x => x.value), backgroundColor: ['rgba(217,74,54,.70)','rgba(246,181,43,.70)','rgba(100,182,79,.70)','rgba(160,160,160,.70)'], borderWidth:0 }] },
        options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color: sharedText, boxWidth:10 } } }, scales:{ r:{ grid:{ color: sharedGrid }, angleLines:{ color: sharedGrid }, ticks:{ display:false } } } }
      })
    }
  ];
}

function buildAionSuggestions(data) {
  const suggestions = [];
  if (data.lowStock.length) {
    suggestions.push(`Reposição prioritária: ${data.lowStock.length} produto(s) estão abaixo do estoque mínimo.`);
  }
  if (data.expiringLots > 0 || data.expiredLots > 0) {
    suggestions.push(`Atenção à validade: ${data.expiringLots} lote(s) próximos do vencimento e ${data.expiredLots} vencido(s).`);
  }
  if (data.ordersPendingApproval > 0) {
    suggestions.push(`Fluxo comercial: ${data.ordersPendingApproval} pedido(s) aguardando aprovação operacional.`);
  }
  if (data.pendingCustomers.length > 0) {
    suggestions.push(`Cadastro comercial: ${data.pendingCustomers.length} cliente(s) aguardando aprovação.`);
  }
  const totalLosses30 = data.lossesByDay.reduce((acc, value) => acc + Number(value || 0), 0);
  if (totalLosses30 > 0) {
    suggestions.push(`Perdas do período: ${fmtNumber(totalLosses30)} unidade(s) registradas nos últimos 30 dias.`);
  }
  if (!suggestions.length) {
    suggestions.push('Operação estável no momento. Continue monitorando o ritmo de entradas, saídas e validade.');
  }
  return suggestions.slice(0, 5);
}

function renderDashboardChartCard(def) {
  return `
    <article class="dashboard-dynamic-card card">
      <div class="dashboard-dynamic-card__head">
        <div>
          <h3>${escapeHTML(def.title)}</h3>
          <p>${escapeHTML(def.description)}</p>
        </div>
        <span class="pill">${escapeHTML(def.typeLabel)}</span>
      </div>
      <div class="dashboard-dynamic-card__chart"><canvas id="chart-${def.id}"></canvas></div>
    </article>
  `;
}

function renderDashboardChartIntoCanvas(def) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById(`chart-${def.id}`);
  if (!canvas) return;
  const chart = new Chart(canvas, def.create());
  __dashboardChartInstances.push(chart);
}

function openDashboardChartSelector(root, data) {
  const defs = dashboardChartDefinitions(data);
  const currentSelection = loadDashboardSelection();
  openModal('Editar Dashboard', `
    <div class="notice-aion" style="margin-bottom:14px">
      Selecione <strong>8 gráficos</strong> para aparecerem no dashboard. Você pode trocar a combinação sempre que quiser.
    </div>
    <div class="list-checks dashboard-edit-list">
      ${defs.map(def => `
        <label class="check-row dashboard-check-row">
          <input type="checkbox" data-chart-option="${def.id}" ${currentSelection.includes(def.id) ? 'checked' : ''}>
          <span>
            <strong>${escapeHTML(def.title)}</strong>
            <small>${escapeHTML(def.description)} · ${escapeHTML(def.typeLabel)}</small>
          </span>
        </label>
      `).join('')}
    </div>
    <div class="form-actions">
      <button class="btn btn--ghost" id="dashboard-edit-cancel">Cancelar</button>
      <button class="btn btn--primary" id="dashboard-edit-save">Salvar seleção</button>
    </div>
  `, { wide: true });

  document.getElementById('dashboard-edit-cancel').onclick = closeModal;
  document.getElementById('dashboard-edit-save').onclick = async () => {
    const selected = [...document.querySelectorAll('[data-chart-option]:checked')].map(el => el.dataset.chartOption);
    if (selected.length !== 8) {
      toast('Selecione exatamente 8 gráficos para o dashboard.', 'warn');
      return;
    }
    saveDashboardSelection(selected);
    closeModal();
    await renderDashboard(root);
  };
}

async function renderDashboard(root) {
  destroyDashboardCharts();
  const data = await gatherDashboardData();
  const defs = dashboardChartDefinitions(data);
  const selectedDefs = loadDashboardSelection().map(id => defs.find(def => def.id === id)).filter(Boolean).slice(0, 8);
  const suggestions = buildAionSuggestions(data);
  const now = new Date();
  const dateLabel = now.toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const timeLabel = now.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });

  root.innerHTML = `
    <div class="dashboard-shell dashboard-shell--dynamic">
      <section class="dashboard-welcome dashboard-welcome--hero dashboard-welcome--dynamic">
        <div>
          <span class="dashboard-welcome__eyebrow">Life Sucos · Dashboard dinâmico</span>
          <h1>Olá, ${escapeHTML(data.currentName)} 👋</h1>
          <p>Visualize sua operação com gráficos dinâmicos, leitura rápida e apoio do Sistema de Inteligência AION.</p>
        </div>
        <div class="dashboard-welcome__status dashboard-welcome__status--card">
          <span class="online">Online</span>
          <strong>${escapeHTML(dateLabel)}</strong>
          <small>${escapeHTML(timeLabel)}</small>
        </div>
      </section>

      <section class="dashboard-kpis dashboard-kpis--hero">
        <div class="card kpi-mini"><span>Valor em estoque</span><strong>${money(data.totalValue)}</strong><small>${fmtNumber(data.totalUnits)} unidade(s)</small></div>
        <div class="card kpi-mini"><span>Itens abaixo do mínimo</span><strong>${fmtNumber(data.lowStock.length)}</strong><small>${data.lowStock.length ? 'Exigem atenção' : 'Operação saudável'}</small></div>
        <div class="card kpi-mini"><span>Pedidos aguardando</span><strong>${fmtNumber(data.ordersPendingApproval)}</strong><small>${fmtNumber(data.pendingCustomers.length)} cliente(s) pendentes</small></div>
        <div class="card kpi-mini"><span>Movimentos de hoje</span><strong>${fmtNumber(data.entriesTodayCount + data.exitsTodayCount)}</strong><small>${fmtNumber(data.entriesTodayCount)} entradas · ${fmtNumber(data.exitsTodayCount)} saídas</small></div>
      </section>

      <section class="dashboard-dynamic-panel card">
        <div class="dashboard-dynamic-panel__head">
          <div>
            <h2>Dashboard analítico</h2>
            <p>8 gráficos em uma única tela para leitura rápida da operação.</p>
          </div>
          <div class="dashboard-dynamic-panel__actions">
            <button class="btn btn--ghost" id="dashboard-edit-btn">Editar gráficos</button>
          </div>
        </div>
        <div class="dashboard-dynamic-grid">
          ${selectedDefs.map(renderDashboardChartCard).join('')}
        </div>
      </section>

      <section class="dashboard-aion-card card">
        <div class="dashboard-aion-card__head">
          <div>
            <span class="dashboard-aion-card__eyebrow">AION IA</span>
            <h3>Dicas inteligentes para gestão</h3>
          </div>
        </div>
        <div class="dashboard-aion-card__body">
          <ul class="dashboard-aion-list">
            ${suggestions.map(item => `<li>${escapeHTML(item)}</li>`).join('')}
          </ul>
          ${data.lowStockHighlights.length ? `
            <div class="notice-aion">
              <strong>Produtos em atenção:</strong><br>
              ${data.lowStockHighlights.map(item => escapeHTML(item)).join('<br>')}
            </div>
          ` : ''}
        </div>
      </section>
    </div>
  `;

  selectedDefs.forEach(renderDashboardChartIntoCanvas);

  document.getElementById('dashboard-edit-btn')?.addEventListener('click', () => openDashboardChartSelector(root, data));
}
