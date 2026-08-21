/* ============================================================
   DB.JS — camada de acesso a dados do frontend
   Agora fala com o backend (Node + SQLite) via API REST, em vez
   de guardar tudo só no navegador. Isso significa que todos os
   dispositivos conectados ao mesmo servidor veem os mesmos dados
   automaticamente — não existe mais "banco por aparelho".
   A INTERFACE (DB.all/get/add/put/delete/byIndex) continua igual
   de propósito, para que as telas não precisassem ser reescritas.
   ============================================================ */

const API_BASE = '/api';

async function apiFetch(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (networkErr) {
    throw new Error('Não foi possível falar com o servidor. Confira se o sistema está aberto no computador e se este aparelho está na mesma rede.');
  }
  if (res.status === 401) {
    if (typeof Auth !== 'undefined') Auth.handleUnauthorized();
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  if (res.status === 404) return { __notFound: true };
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------- CRUD (mesma interface de antes, agora via API) ---------- */
const DB = {
  async all(store) {
    return apiFetch(`/${store}`);
  },
  async get(store, key) {
    const r = await apiFetch(`/${store}/${encodeURIComponent(key)}`);
    return (r && r.__notFound) ? null : r;
  },
  async add(store, obj) {
    const pk = obj.id ?? obj.key;
    await apiFetch(`/${store}/${encodeURIComponent(pk)}`, { method: 'PUT', body: obj });
    return obj;
  },
  async put(store, obj) {
    const pk = obj.id ?? obj.key;
    await apiFetch(`/${store}/${encodeURIComponent(pk)}`, { method: 'PUT', body: obj });
    return obj;
  },
  async delete(store, key) {
    await apiFetch(`/${store}/${encodeURIComponent(key)}`, { method: 'DELETE' });
    return true;
  },
  async byIndex(store, indexName, value) {
    const all = await DB.all(store);
    return all.filter(o => o[indexName] === value);
  }
};

/* ---------- Usuário atual (auditoria) ----------
   A identidade vem exclusivamente da sessão autenticada. O frontend
   não pode trocar o responsável por uma movimentação manualmente. */
async function getCurrentUser() {
  return (typeof Auth !== 'undefined' && Auth.auditLabel) ? Auth.auditLabel() : 'Usuário autenticado';
}
async function setCurrentUser() {
  throw new Error('O responsável é definido pelo login e não pode ser alterado manualmente.');
}

/* ---------- Histórico permanente ----------
   Só existe ANEXAR (endpoint dedicado, nunca o CRUD genérico —
   "history" não é uma coleção de escrita livre). Usado apenas para
   ações simples de cadastro (ex: editar produto); toda operação de
   estoque já grava seu próprio histórico dentro da transação no
   servidor, então as telas de estoque não chamam esta função. */
async function logHistory({ tipo, produtoId, produtoNome, quantidade, lote, nf, motivo, observacoes }) {
  return apiFetch('/history', {
    method: 'POST',
    body: { tipo, produtoId, produtoNome, quantidade, lote, nf, motivo, observacoes }
  });
}

/* ---------- Status de conexão com o servidor ----------
   Diferente da versão anterior (que checava a internet do
   aparelho), aqui o que importa é se este dispositivo consegue
   falar com o servidor local (mesmo computador ou mesma rede). */
let _serverOnline = true;
let _syncInfo = null;
let _healthInfo = null;

async function checkServerConnection() {
  try {
    const res = await fetch(API_BASE + '/health', { cache: 'no-store' });
    _serverOnline = res.ok;
    try { _healthInfo = await res.clone().json(); } catch { _healthInfo = null; }
    if (_serverOnline) {
      try {
        const sr = await fetch(API_BASE + '/sync/status', { cache: 'no-store' });
        _syncInfo = sr.ok ? await sr.json() : null;
      } catch { _syncInfo = null; }
    }
  } catch (e) {
    _serverOnline = false;
    _syncInfo = null;
  }
  updateSyncBadge();
  return _serverOnline;
}

function updateSyncBadge() {
  const badge = document.getElementById('sync-badge');
  if (!badge) return;
  if (!_serverOnline) {
    badge.textContent = 'Servidor local indisponível';
    badge.dataset.state = 'offline';
    return;
  }
  if (_healthInfo?.cloudMode) {
    badge.textContent = '☁️ Nuvem online';
    badge.dataset.state = 'online';
    return;
  }
  const pending = Number(_syncInfo?.counts?.pending || 0) + Number(_syncInfo?.counts?.retry || 0);
  const conflicts = Number(_syncInfo?.counts?.conflict || 0);
  if (conflicts > 0) {
    badge.textContent = `⚠ ${conflicts} conflito(s) de sincronização`;
    badge.dataset.state = 'offline';
  } else if (pending > 0) {
    badge.textContent = `🔄 Local · ${pending} pendente(s)`;
    badge.dataset.state = 'syncing';
  } else if (_syncInfo?.paired) {
    badge.textContent = '🏢 Local · sincronizado';
    badge.dataset.state = 'online';
  } else {
    badge.textContent = '🏢 Servidor local';
    badge.dataset.state = 'online';
  }
}
function isServerOnline() {
  return _serverOnline;
}

document.addEventListener('DOMContentLoaded', () => {
  checkServerConnection();
  setInterval(checkServerConnection, 8000);
});
