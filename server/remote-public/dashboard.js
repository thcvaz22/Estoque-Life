/* ============================================================
   REMOTE-PUBLIC/DASHBOARD.JS — painel somente leitura
   Faz polling de /api/summary a cada 20s (dentro da janela de
   15-30s pedida). Se a busca falhar (empresa desligada, sem
   internet, túnel fora do ar, sessão expirada), mostra
   "Sistema da empresa offline" e mantém visível a última
   atualização recebida, sem apagar os dados na tela.
   ============================================================ */

const REFRESH_MS = 20000;
let lastUpdateAt = null;

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtTime(d) {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtNumber(n) {
  return new Intl.NumberFormat('pt-BR').format(n || 0);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function fillTable(tbodySelector, rows, colSpan, rowFn) {
  const tbody = document.querySelector(tbodySelector + ' tbody');
  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${colSpan}">Nada por aqui no momento.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(rowFn).join('');
}

function setOnline(isOnline) {
  const badge = document.getElementById('status-badge');
  badge.textContent = isOnline ? 'Sistema online' : 'Sistema da empresa offline';
  badge.className = 'badge ' + (isOnline ? 'badge--online' : 'badge--offline');
  document.getElementById('content').classList.toggle('stale', !isOnline);
}

function updateLastLabel() {
  const el = document.getElementById('last-update');
  el.textContent = lastUpdateAt ? `Última atualização: ${fmtTime(lastUpdateAt)}` : 'Última atualização: —';
}

function renderStats(s) {
  const stats = [
    { label: 'Estoque disponível', value: fmtNumber(s.estoqueDisponivel) + ' un.', accent: 'green' },
    { label: 'Estoque bloqueado', value: fmtNumber(s.estoqueBloqueado) + ' un.', accent: '' },
    { label: 'Estoque baixo', value: s.estoqueBaixo.length, accent: 'yellow' },
    { label: 'Produtos zerados', value: s.produtosZerados.length, accent: 'alert' },
    { label: 'Backlog pendente', value: `${s.backlogPendente.total} (${fmtNumber(s.backlogPendente.unidades)} un.)`, accent: 'alert' },
    { label: 'Motoristas em rota', value: s.motoristasEmRota.length, accent: '' },
    { label: 'NFs pendentes', value: s.nfsPendentes, accent: 'yellow' },
    { label: 'Entregas concluídas', value: s.entregasConcluidas, accent: 'green' },
    { label: 'Avarias (30 dias)', value: fmtNumber(s.avarias.total30d) + ' un.', accent: '' }
  ];
  document.getElementById('stats-grid').innerHTML = stats.map(st => `
    <div class="stat ${st.accent ? 'accent-' + st.accent : ''}">
      <div class="label">${esc(st.label)}</div>
      <div class="value">${st.value}</div>
    </div>`).join('');
}

function renderTables(s) {
  fillTable('#tbl-motoristas', s.motoristasEmRota, 5, m => `<tr><td>${esc(m.motorista)}</td><td>${esc(m.cliente)}</td><td>${esc(m.placa)}</td><td>${esc(m.nfs.join(', '))}</td><td>${fmtDateTime(m.horarioSaida)}</td></tr>`);
  fillTable('#tbl-baixo', s.estoqueBaixo, 3, p => `<tr><td>${esc(p.nome)}</td><td>${fmtNumber(p.disponivel)}</td><td>${fmtNumber(p.minimo)}</td></tr>`);
  fillTable('#tbl-zerados', s.produtosZerados, 1, p => `<tr><td>${esc(p.nome)}</td></tr>`);
  fillTable('#tbl-vencimento', s.proximosVencimento, 5, v => `<tr><td>${esc(v.produto)}</td><td>${esc(v.lote)}</td><td>${fmtDateTime(v.validade)}</td><td>${v.dias}</td><td>${fmtNumber(v.quantidade)}</td></tr>`);
  fillTable('#tbl-backlog', s.backlogPendente.itens, 5, b => `<tr><td>${esc(b.produto)}</td><td>${fmtNumber(b.quantidade)}</td><td>${esc(b.cliente)}</td><td>${esc(b.nf)}</td><td>${esc(b.motivo)}</td></tr>`);
  fillTable('#tbl-avarias', s.avarias.recentes, 4, a => `<tr><td>${esc(a.produto)}</td><td>${fmtNumber(a.quantidade)}</td><td>${esc(a.motivo)}</td><td>${fmtDateTime(a.data)}</td></tr>`);
  fillTable('#tbl-historico', s.ultimasMovimentacoes, 5, h => `<tr><td>${fmtDateTime(h.timestamp)}</td><td>${esc(h.tipo)}</td><td>${esc(h.produto)}</td><td>${h.quantidade ?? '—'}</td><td>${esc(h.usuario)}</td></tr>`);
}

async function refresh() {
  try {
    const res = await fetch('/api/summary', { cache: 'no-store' });
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (!res.ok) throw new Error('resposta ' + res.status);
    const data = await res.json();
    setOnline(true);
    lastUpdateAt = new Date();
    updateLastLabel();
    renderStats(data);
    renderTables(data);
  } catch (err) {
    setOnline(false);
    updateLastLabel();
  }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await fetch('/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  window.location.href = '/login';
});

refresh();
setInterval(refresh, REFRESH_MS);
setInterval(updateLastLabel, 1000);
