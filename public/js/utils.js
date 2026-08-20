/* ============================================================
   UTILS.JS — helpers compartilhados por todas as telas
   ============================================================ */

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('pt-BR');
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function todayISO() {
  // Data local (não UTC) — toISOString() sozinho pode voltar o dia errado
  // à noite no fuso do Brasil (bug corrigido na Etapa 3).
  return new Date().toLocaleDateString('sv-SE');
}
function nowLocalDatetimeInput() {
  // "YYYY-MM-DDTHH:mm" no horário local do aparelho — para preencher o
  // valor padrão de <input type="datetime-local"> corretamente.
  return new Date().toLocaleString('sv-SE').replace(' ', 'T').slice(0, 16);
}

function addDaysISO(dateISO, days) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(dateISO || '')) ? String(dateISO) : todayISO();
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function normalizeMovementUnit(unit) {
  const u = String(unit || 'Unidade').trim().toLowerCase();
  if (['unidade','un','und'].includes(u)) return 'Unidade';
  if (['fardo','fd','caixa','cx','fardo/caixa'].includes(u)) return 'Fardo';
  if (['palete','pallet','pal'].includes(u)) return 'Pallet';
  if (['meio palete','meio pallet','1/2 pallet','1/2 palete'].includes(u)) return 'Meio Pallet';
  return unit || 'Unidade';
}
function movementFactorForProduct(product, unit) {
  if (!product) return 1;
  const u = normalizeMovementUnit(unit);
  const upf = Number(product.unidadesPorFardo || product.qtdPorEmbalagem || 1);
  const fpp = Number(product.fardosPorPalete || 0);
  if (u === 'Unidade') return 1;
  if (u === 'Fardo') return upf;
  if (u === 'Pallet') return upf * fpp;
  if (u === 'Meio Pallet') return upf * fpp / 2;
  return 1;
}
function movementPreview(product, quantidade, unit) {
  const q = Number(quantidade) || 0;
  const factor = movementFactorForProduct(product, unit);
  return q * factor;
}

/* ---------- Identificação clara de produto ---------- */
function volumeToMl(volume) {
  const raw = String(volume || '').trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
  let m = raw.match(/^(\d+(?:\.\d+)?)ml$/i);
  if (m) return Math.round(Number(m[1]));
  m = raw.match(/^(\d+(?:\.\d+)?)l$/i);
  if (m) return Math.round(Number(m[1]) * 1000);
  return null;
}
function productDisplayName(product) {
  if (!product) return 'Produto';
  const rawName = String(product.nome || 'Produto').trim();
  const ml = Number(product.volumeMl || 0) || volumeToMl(product.volume);
  if (!ml) return rawName;
  const base = rawName.replace(/\s+\d+(?:[.,]\d+)?\s*(?:ml|l)\s*$/i, '').trim();
  return `${base} ${ml} ml`;
}
function productSelectLabel(product, { includeCode = true, includePackaging = false } = {}) {
  if (!product) return 'Produto';
  const parts = [];
  if (includeCode && product.codigoInterno) parts.push(String(product.codigoInterno));
  parts.push(productDisplayName(product));
  if (includePackaging && product.embalagem) parts.push(String(product.embalagem));
  return parts.join(' · ');
}

function daysUntil(dateISO) {
  if (!dateISO) return null;
  const target = new Date(dateISO + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}
function fmtNumber(n) {
  return new Intl.NumberFormat('pt-BR').format(n || 0);
}
function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ---------- Toast ---------- */
function toast(msg, kind = 'info') {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return alert(msg);
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 3200);
}

/* ---------- Modal genérico ---------- */
function openModal(titleHTML, bodyHTML, { wide = false } = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal__head">
          <h3>${titleHTML}</h3>
          <button class="icon-btn" id="modal-close" aria-label="Fechar">✕</button>
        </div>
        <div class="modal__body">${bodyHTML}</div>
      </div>
    </div>`;
  root.querySelector('#modal-close').onclick = closeModal;
  root.querySelector('#modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
  return root;
}
function closeModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
}

/* ---------- Confirmação ---------- */
function confirmDialog(message) {
  return new Promise(resolve => {
    openModal('Confirmar ação', `
      <p style="margin-bottom:20px">${escapeHTML(message)}</p>
      <div class="form-actions">
        <button class="btn btn--ghost" id="cf-no">Cancelar</button>
        <button class="btn btn--danger" id="cf-yes">Confirmar</button>
      </div>`);
    document.getElementById('cf-no').onclick = () => { closeModal(); resolve(false); };
    document.getElementById('cf-yes').onclick = () => { closeModal(); resolve(true); };
  });
}

/* ---------- Badge de status (motivo "stamp" do design) ---------- */
function statusStamp(text, kind) {
  // kind: ok | warn | danger | neutral | info
  return `<span class="stamp stamp--${kind}">${escapeHTML(text)}</span>`;
}

/* ---------- Debounce ---------- */
function debounce(fn, wait = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

/* ---------- Cálculo de dias/estado de validade ---------- */
function validadeState(dateISO) {
  const d = daysUntil(dateISO);
  if (d === null) return { label: '—', kind: 'neutral', dias: null };
  if (d < 0) return { label: 'Vencido', kind: 'danger', dias: d };
  if (d <= 30) return { label: `${d} dia(s)`, kind: 'warn', dias: d };
  return { label: `${d} dias`, kind: 'ok', dias: d };
}

/* ---------- CSV ---------- */
function toCSV(rows, headers) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(h => esc(h.label)).join(';')];
  rows.forEach(r => lines.push(headers.map(h => esc(typeof h.get === 'function' ? h.get(r) : r[h.key])).join(';')));
  return lines.join('\n');
}
function downloadFile(filename, content, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['\uFEFF' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================================================
   OPERAÇÕES CRÍTICAS DE ESTOQUE (Etapa 3)
   A partir daqui, entrada/saída/backlog/perda/inventário/ajuste
   NUNCA mexem em DB.add('lots', ...) direto — sempre passam por
   estes helpers, que chamam os endpoints dedicados do servidor
   (/api/stock/*). Toda a regra fica no backend.
   ============================================================ */

function genOperationId() {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/* Chama um endpoint de /api/stock/*. Se o servidor não puder ser
   alcançado, lança um erro com uma mensagem clara — quem chamar
   deve deixar o erro subir para o toast (não silenciar). */
async function postStock(path, body = {}) {
  let res;
  try {
    res = await fetch('/api/stock' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (networkErr) {
    throw new Error('Servidor indisponível. Operações de estoque estão temporariamente bloqueadas.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* corpo vazio, ok para 204 etc. */ }
  if (res.status === 401) { if (typeof Auth !== 'undefined') Auth.handleUnauthorized(); throw new Error('Sessão expirada. Faça login novamente.'); }
  if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status} ao processar a operação.`);
  return data;
}
async function putStock(path, body = {}) {
  let res;
  try {
    res = await fetch('/api/stock' + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (networkErr) {
    throw new Error('Servidor indisponível. Operações de estoque estão temporariamente bloqueadas.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (res.status === 401) { if (typeof Auth !== 'undefined') Auth.handleUnauthorized(); throw new Error('Sessão expirada. Faça login novamente.'); }
  if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status} ao processar a operação.`);
  return data;
}

/* Chamada genérica de API (fora de /api/stock) — usada pelo OCR de
   entrada por foto. Mesmo tratamento de erro de rede que postStock. */
async function postJSON(url, body = {}) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (networkErr) {
    throw new Error('Servidor indisponível no momento. Tente novamente.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (res.status === 401) { if (typeof Auth !== 'undefined') Auth.handleUnauthorized(); throw new Error('Sessão expirada. Faça login novamente.'); }
  if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}.`);
  return data;
}

/* Impede duplo clique: desabilita o botão e mostra "Processando…"
   enquanto fn() roda; sempre restaura o botão ao final (sucesso ou erro).
   Erros são relançados para quem chamou tratar (ex: mostrar toast). */
async function withBusyButton(button, busyLabel, fn) {
  if (!button || button.disabled) return;
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.innerHTML = busyLabel;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = originalLabel;
  }
}

/* Bloqueia uma ação crítica se o servidor estiver inacessível
   (ver checkServerConnection em db.js). Mostra a mensagem exigida
   e devolve false para quem chamou cancelar a ação. */
function ensureServerOnlineForCriticalAction() {
  if (typeof isServerOnline === 'function' && !isServerOnline()) {
    toast('Servidor indisponível. Operações de estoque estão temporariamente bloqueadas.', 'error');
    return false;
  }
  return true;
}

/* ---------- Card de indicador reutilizável ----------
   Mantido global porque Usuários, Configurações e outras telas
   também precisam de cards de resumo. */
function statCard(label, value, accent = 'navy', meta = '') {
  const normalized = ({ green:'leaf', red:'alert', orange:'citrus' })[accent] || accent;
  return `<div class="card stat-card stat-card--accent-${normalized}">
    <div class="label">${escapeHTML(label)}</div>
    <div class="value">${typeof value === 'number' ? fmtNumber(value) : value}</div>
    ${meta ? `<div class="delta">${escapeHTML(meta)}</div>` : ''}
  </div>`;
}
