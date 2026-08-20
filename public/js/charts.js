/* ============================================================
   CHARTS.JS — helpers para os gráficos do dashboard (Chart.js)
   ============================================================ */

let _movChart = null;
let _prodChart = null;

function chartColors() {
  return {
    grid: 'rgba(62,103,51,0.10)',
    text: '#66745E',
    leaf: '#64B64F',
    alert: '#D6472E',
    citrus: '#F6B52B',
    navy: '#2F7D32'
  };
}

function chartsAvailable(canvasId) {
  if (typeof Chart === 'undefined') {
    const el = document.getElementById(canvasId);
    if (el && el.parentElement) el.parentElement.innerHTML = '<div class="empty-state"><div class="big">📶</div><p>Gráficos indisponíveis offline no momento.<br>Serão exibidos assim que houver conexão.</p></div>';
    return false;
  }
  return true;
}

function renderMovementChart(canvasId, labels, entradas, saidas) {
  if (!chartsAvailable(canvasId)) return;
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const c = chartColors();
  if (_movChart) _movChart.destroy();
  _movChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Entradas', data: entradas, backgroundColor: c.leaf, borderRadius: 3, maxBarThickness: 22 },
        { label: 'Saídas', data: saidas, backgroundColor: c.navy, borderRadius: 3, maxBarThickness: 22 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: c.text, font: { family: 'Inter', size: 12 } } } },
      scales: {
        x: { ticks: { color: c.text }, grid: { display: false } },
        y: { ticks: { color: c.text }, grid: { color: c.grid }, beginAtZero: true }
      }
    }
  });
}

function renderProductivityChart(canvasId, labels, values) {
  if (!chartsAvailable(canvasId)) return;
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const c = chartColors();
  if (_prodChart) _prodChart.destroy();
  _prodChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Itens movimentados',
        data: values,
        borderColor: c.citrus,
        backgroundColor: 'rgba(246,181,43,0.18)',
        tension: 0.35,
        fill: true,
        pointRadius: 3,
        pointBackgroundColor: c.citrus
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: c.text }, grid: { display: false } },
        y: { ticks: { color: c.text }, grid: { color: c.grid }, beginAtZero: true }
      }
    }
  });
}
