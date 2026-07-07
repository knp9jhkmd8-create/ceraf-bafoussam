// ============================================================
//  CERAF Bafoussam — Service Worker v7
//  - Met en cache index.html pour accès hors ligne
//  - Ne touche PAS aux requêtes Apps Script
//  - Vide automatiquement l'ancien cache à chaque mise à jour
//  - Sert le cache immédiatement (stale-while-revalidate) : la page
//    s'affiche sans attendre le réseau, et se met à jour en arrière-plan
// ============================================================

const CACHE_VERSION = 'ceraf-v7';
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

  // Pour index.html et manifest.json : cache d'abord (affichage instantané),
  // avec rafraîchissement réseau en arrière-plan (stale-while-revalidate)
  if (CACHE_FILES.some(f => url.pathname.endsWith(f.replace('./', '/')))
      || url.pathname === '/'
      || url.pathname.endsWith('/')) {
    e.respondWith(
      caches.open(CACHE_VERSION).then(cache =>
        cache.match(e.request).then(cached => {
          const fetchPromise = fetch(e.request)
            .then(response => {
              cache.put(e.request, response.clone());
              return response;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Tout le reste (fonts, etc.) : réseau normal sans interception
});
