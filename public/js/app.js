/* ============================================================
   APP.JS — roteamento, navegação, tema, inicialização
   ============================================================ */

const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  products: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.5 11.5 12.5 3.5 4 4l-.5 8.5 8 8a2 2 0 0 0 2.8 0l6.2-6.2a2 2 0 0 0 0-2.8Z"/><circle cx="8.5" cy="8.5" r="1.2"/></svg>',
  entries: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v13"/><path d="m6 11 6 6 6-6"/><path d="M4 21h16"/></svg>',
  exits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="12" height="9"/><path d="M14 11h4l4 4v2h-8z"/><circle cx="6.5" cy="18.5" r="1.6"/><circle cx="17" cy="18.5" r="1.6"/></svg>',
  backlog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 2 20h20L12 2Z"/><path d="M12 9v5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>',
  stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>',
  inventory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3"/><path d="m9 13 2 2 4-4"/></svg>',
  losses: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.3 2.7 17a1.7 1.7 0 0 0 1.5 2.6h15.6a1.7 1.7 0 0 0 1.5-2.6L13.7 3.3a1.7 1.7 0 0 0-3.4 0Z"/><path d="M12 9v5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>',
  reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
  invoices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v5h5"/><path d="M10 12h6M10 16h6"/><path d="M4 7v14h10"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M16 11h6"/></svg>',
  customers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2"/><path d="M17 8h4M19 6v4"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h10v4H7z"/><path d="M5 5H3v16h18V5h-2"/><path d="M8 12h8M8 16h5"/></svg>',
  pricing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.5 11.5 12.5 3.5 4 4l-.5 8.5 8 8a2 2 0 0 0 2.8 0l6.2-6.2a2 2 0 0 0 0-2.8Z"/><path d="M8 9h.01"/></svg>',
  separation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18M5 7v13h14V7"/><path d="M9 11h6M9 15h6"/><path d="M8 3h8l2 4H6z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>'
};

const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', render: renderDashboard, bottom: true },
  { id: 'commercialCustomers', label: 'Clientes', icon: 'customers', render: renderCommercialCustomers, badge: 'customers_pending' },
  { id: 'commercialOrders', label: 'Pedidos', icon: 'orders', render: renderCommercialOrders, badge: 'orders_pending' },
  { id: 'separation', label: 'Separação', icon: 'separation', render: renderSeparation },
  { id: 'invoices', label: 'Notas Fiscais', icon: 'invoices', render: renderInvoices },
  { id: 'pricing', label: 'Negociações', icon: 'pricing', render: renderPricing },
  { id: 'products', label: 'Produtos', icon: 'products', render: renderProducts, bottom: true },
  { id: 'entries', label: 'Entradas', icon: 'entries', render: renderEntries, bottom: true },
  { id: 'exits', label: 'Saídas', icon: 'exits', render: renderExits, bottom: true },
  { id: 'backlog', label: 'Backlog', icon: 'backlog', render: renderBacklog, badge: 'backlog' },
  { id: 'stock', label: 'Estoque', icon: 'stock', render: renderStock, bottom: true },
  { id: 'inventory', label: 'Inventário', icon: 'inventory', render: renderInventory },
  { id: 'losses', label: 'Avarias e Perdas', icon: 'losses', render: renderLosses },
  { id: 'reports', label: 'Relatórios', icon: 'reports', render: renderReports },
  { id: 'history', label: 'Histórico', icon: 'history', render: renderHistory, permission: 'admin' },
  { id: 'users', label: 'Usuários', icon: 'users', render: renderUsers, permission: 'manager' },
  { id: 'settings', label: 'Configurações', icon: 'settings', render: renderSettings, permission: 'manager' }
];

let currentRoute = 'dashboard';

function routeAllowed(route) {
  if (!route) return false;
  if (route.permission === 'manager') return !!(typeof Auth !== 'undefined' && Auth.isManager && Auth.isManager());
  if (route.permission === 'admin') return !!(typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin());
  return true;
}

function allowedRoutes() {
  return ROUTES.filter(routeAllowed);
}

function buildNav() {
  const navList = document.getElementById('nav-list');
  const visibleRoutes = allowedRoutes();
  navList.innerHTML = visibleRoutes.map(r => `
    <button class="nav__item ${r.id === currentRoute ? 'active' : ''}" data-route="${r.id}">
      ${ICONS[r.icon]}<span>${r.label}</span>
      ${r.badge ? `<span class="badge-count" data-badge="${r.badge}" hidden></span>` : ''}
    </button>`).join('');
  navList.querySelectorAll('.nav__item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });

  const bottomNavItems = visibleRoutes.filter(r => r.bottom);
  const bottomNav = document.getElementById('bottom-nav');
  bottomNav.innerHTML = bottomNavItems.map(r => `
    <button data-route="${r.id}" class="${r.id === currentRoute ? 'active' : ''}">${ICONS[r.icon]}<span>${r.label}</span></button>
  `).join('') + `<button data-route="__menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>Menu</span></button>`;
  bottomNav.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.route === '__menu') { toggleSidebar(true); return; }
      navigate(btn.dataset.route);
    });
  });
}

function toggleSidebar(force) {
  document.getElementById('sidebar').classList.toggle('open', force);
}

async function navigate(routeId) {
  let route = ROUTES.find(r => r.id === routeId) || ROUTES[0];
  if (!routeAllowed(route)) {
    toast('Acesso restrito ao perfil Gerente.', 'warn');
    route = ROUTES[0];
  }
  currentRoute = route.id;
  document.getElementById('view-title').textContent = route.label;
  document.querySelectorAll('.nav__item').forEach(b => b.classList.toggle('active', b.dataset.route === route.id));
  document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.route === route.id));
  toggleSidebar(false);
  const root = document.getElementById('view-root');
  root.innerHTML = '<div class="skeleton" style="height:180px;border-radius:8px"></div>';
  try {
    await route.render(root);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><p>Não foi possível carregar esta tela.<br><span class="mono" style="font-size:11px">${escapeHTML(err.message || err)}</span></p></div>`;
  }
  window.scrollTo(0, 0);
  refreshBadges();
}

async function refreshBadges() {
  try {
    const backlog = await DB.all('backlog');
    const pendentes = backlog.filter(b => b.status === 'bloqueado').length;
    document.querySelectorAll('[data-badge="backlog"]').forEach(el => {
      el.hidden = pendentes === 0;
      el.textContent = pendentes;
    });
    try {
      const [pendingCustomers, orders] = await Promise.all([commercialFetch('/customers/pending'), commercialFetch('/orders')]);
      const cp = pendingCustomers.length;
      const op = orders.filter(o => o.status === 'enviado').length;
      document.querySelectorAll('[data-badge="customers_pending"]').forEach(el => { el.hidden = cp === 0; el.textContent = cp; });
      document.querySelectorAll('[data-badge="orders_pending"]').forEach(el => { el.hidden = op === 0; el.textContent = op; });
    } catch(e) { /* usuário/servidor sem módulo comercial */ }
  } catch (e) { /* ignore */ }
}

/* ---------- Busca global unificada ---------- */
let globalSearchResults = [];
function globalSearchTypeLabel(type){
  return ({product:'Produto',customer:'Cliente',order:'Pedido',invoice:'NF-e',entry:'Entrada',exit:'Saída',backlog:'Backlog',lot:'Lote',supplier:'Fornecedor'})[type] || 'Resultado';
}
function ensureGlobalSearchPanel(){
  const wrap=document.querySelector('.topbar .search');
  if(!wrap) return null;
  let panel=document.getElementById('global-search-results');
  if(!panel){panel=document.createElement('div');panel.id='global-search-results';panel.className='global-search-results';panel.hidden=true;wrap.appendChild(panel);}
  return panel;
}
function hideGlobalSearchPanel(){const p=document.getElementById('global-search-results');if(p)p.hidden=true;}
async function openGlobalSearchResult(result){
  hideGlobalSearchPanel();
  const input=document.getElementById('global-search'); if(input) input.value='';
  await navigate(result.route || 'dashboard');
  try{
    if(result.type==='product'){
      const product=await DB.get('products',result.id); if(product) openProductForm(product);
    }else if(result.type==='customer'){
      const [customers,tables,sellers]=await Promise.all([commercialFetch('/customers'),commercialFetch('/price-tables'),commercialFetch('/sellers')]);
      const customer=customers.find(x=>x.id===result.id); if(customer && typeof openOperationalClientEditForm==='function') openOperationalClientEditForm(customer,tables,sellers);
    }else if(result.type==='order'){
      const orders=await commercialFetch('/orders'); const order=orders.find(x=>x.id===result.id); if(order) orderModal(order);
    }else if(result.type==='invoice'){
      const invoices=await fiscalFetch('/invoices'); const invoice=invoices.find(x=>x.id===result.id); if(invoice) openInvoiceViewer(invoice);
    }else{
      toast(`${globalSearchTypeLabel(result.type)} encontrado: ${result.label}`,'info');
    }
  }catch(e){toast(e.message||'Não foi possível abrir o resultado.','error');}
}
function drawGlobalSearchResults(results, term){
  const panel=ensureGlobalSearchPanel(); if(!panel) return;
  globalSearchResults=results||[];
  if(!term || term.trim().length<2){panel.hidden=true;panel.innerHTML='';return;}
  panel.hidden=false;
  panel.innerHTML=globalSearchResults.length?globalSearchResults.map((r,i)=>`<button type="button" class="global-search-result" data-global-result="${i}"><span class="global-search-result__type">${escapeHTML(globalSearchTypeLabel(r.type))}</span><span class="global-search-result__text"><strong>${escapeHTML(r.label)}</strong><small>${escapeHTML(r.detail||'')}</small></span></button>`).join(''):`<div class="global-search-empty">Nenhum pedido, NF, produto, cliente ou outro registro encontrado.</div>`;
  panel.querySelectorAll('[data-global-result]').forEach(btn=>btn.addEventListener('click',()=>openGlobalSearchResult(globalSearchResults[Number(btn.dataset.globalResult)])));
}
const globalSearch = debounce(async (term) => {
  const clean=String(term||'').trim();
  if(clean.length<2){drawGlobalSearchResults([],clean);return;}
  try{
    const r=await fetch(`/api/search?q=${encodeURIComponent(clean)}`,{cache:'no-store'});
    if(r.status===401){Auth.handleUnauthorized();return;}
    if(!r.ok) throw new Error('Falha ao pesquisar.');
    drawGlobalSearchResults(await r.json(),clean);
  }catch(e){drawGlobalSearchResults([],clean);toast(e.message,'error');}
},250);

/* ---------- Init ---------- */
let operationalAppStarted = false;
async function startOperationalApp() {
  if (operationalAppStarted) return;
  operationalAppStarted = true;
  buildNav();
  document.getElementById('hamburger-btn').addEventListener('click', () => toggleSidebar());
  const globalInput=document.getElementById('global-search');
  globalInput.addEventListener('input', (e) => globalSearch(e.target.value));
  globalInput.addEventListener('keydown', (e) => { if(e.key==='Enter' && globalSearchResults.length){e.preventDefault();openGlobalSearchResult(globalSearchResults[0]);} if(e.key==='Escape') hideGlobalSearchPanel(); });
  document.addEventListener('click',(e)=>{if(!e.target.closest('.topbar .search'))hideGlobalSearchPanel();});
  await navigate('dashboard');
  if (typeof AionIA !== 'undefined' && AionIA.init) AionIA.init();
  setInterval(refreshBadges, 15000);
}

document.addEventListener('DOMContentLoaded', async () => {
  const authenticated = await Auth.init();
  if (!authenticated) return;
  await startOperationalApp();
});

/* Erros de rede/servidor que escaparem de algum handler viram um aviso
   visível em vez de falharem em silêncio — importante agora que as
   telas dependem de uma conexão real com o servidor. */
window.addEventListener('unhandledrejection', (e) => {
  const msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason || 'Erro inesperado');
  toast(msg, 'error');
  e.preventDefault();
});

