/* ============================================================
   SW.JS — Service Worker
   Estratégia: cache-first para o app shell (HTML/CSS/JS locais e
   bibliotecas de CDN), network-first para navegação (para pegar
   atualizações quando online, com fallback ao cache quando offline).
   Suba a versão do cache (CACHE_NAME) a cada deploy para invalidar
   o cache antigo automaticamente.
   ============================================================ */

const CACHE_NAME = 'life-sucos-v17-1-produtos-ml-aion-1-1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/auth.js',
  './js/db.js',
  './js/utils.js',
  './js/barcode.js',
  './js/charts.js',
  './js/nfe.js',
  './js/export.js',
  './js/aion-ai.js',
  './js/app.js',
  './js/views/dashboard.js',
  './js/views/products.js',
  './js/views/entries.js',
  './js/views/exits.js',
  './js/views/backlog.js',
  './js/views/stock.js',
  './js/views/inventory.js',
  './js/views/losses.js',
  './js/views/reports.js',
  './js/views/history.js',
  './js/views/users.js',
  './js/views/settings.js',
  './js/views/commercial.js',
  './js/views/invoices.js',
  './js/views/commercial-v10.js',
  './icons/logo-header.png',
  './icons/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Navegação (HTML): tenta rede primeiro, cai pro cache se offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Chamadas à API NUNCA são armazenadas em cache. Além de garantir
  // dados atuais, isso impede que estoque/histórico antigos fiquem
  // acessíveis offline depois de um logout. A API operacional exige
  // sessão autenticada no servidor.
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // Demais assets (locais e CDN): cache-first, atualizando em segundo plano.
  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req).then(res => {
        // Bibliotecas de CDN (script cross-origin sem crossorigin=""),
        // chegam como resposta "opaque" (status 0) — ainda assim são
        // válidas para cache, só não dá pra inspecionar o conteúdo.
        if (res && (res.ok || res.type === 'opaque')) {
          caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
