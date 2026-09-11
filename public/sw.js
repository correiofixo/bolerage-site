/* Service worker do Bolerage F.D. — modo "seguro":
   - nunca toca em requisições não-GET nem em /api/*
   - shell é NETWORK-FIRST; o cache só serve como fallback quando está sem rede
   - troca de versão do CACHE limpa o cache antigo
   Se algum dia isso causar problema, publicar um sw.js que só faz
   self.registration.unregister() + caches.keys().then(k=>k.forEach(caches.delete)). */
const CACHE = 'bolerage-shell-2.0-6';
const SHELL = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.json', '/assets/logo.jpg'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // fontes/CDN seguem normal
  if (url.pathname.startsWith('/api/')) return;         // API sempre direto da rede

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
  );
});
