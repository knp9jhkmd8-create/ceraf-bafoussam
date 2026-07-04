// ============================================================
//  CERAF Bafoussam — Service Worker v3
//  - Met en cache index.html pour accès hors ligne
//  - Ne touche PAS aux requêtes Apps Script
//  - Vide automatiquement l'ancien cache à chaque mise à jour
// ============================================================

const CACHE_VERSION = 'ceraf-v4';
const CACHE_FILES   = ['./index.html', './manifest.json'];

// ── INSTALLATION ────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(CACHE_FILES))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATION : vider les anciens caches ───────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Ne jamais intercepter les requêtes Apps Script
  if (url.hostname.includes('script.google.com')) return;

  // Pour index.html et manifest.json : réseau d'abord, cache en fallback
  if (CACHE_FILES.some(f => url.pathname.endsWith(f.replace('./', '/')))
      || url.pathname === '/'
      || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          // Mettre à jour le cache avec la version fraîche
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Tout le reste (fonts, etc.) : réseau normal sans interception
});
