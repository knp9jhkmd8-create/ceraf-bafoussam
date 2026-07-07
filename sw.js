// ============================================================
//  CERAF Bafoussam — Service Worker v8
//  - Met en cache index.html pour accès hors ligne
//  - Ne touche PAS aux requêtes Apps Script
//  - Vide automatiquement l'ancien cache à chaque mise à jour
//  - HTML servi en NETWORK-FIRST : la version la plus récente s'affiche
//    dès qu'il y a du réseau (le cache-first précédent laissait voir
//    l'ancienne page un lancement de trop après chaque mise à jour) ;
//    le cache ne sert plus que de secours hors-ligne.
// ============================================================

const CACHE_VERSION = 'ceraf-v8';
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

  // Pour index.html et manifest.json : NETWORK-FIRST — on tente le réseau
  // d'abord (toujours la dernière version en ligne), on met à jour le cache
  // au passage, et on ne retombe sur le cache qu'en cas d'échec réseau
  // (hors-ligne). Évite de rester bloqué sur une ancienne page après un
  // déploiement.
  if (CACHE_FILES.some(f => url.pathname.endsWith(f.replace('./', '/')))
      || url.pathname === '/'
      || url.pathname.endsWith('/')) {
    e.respondWith(
      caches.open(CACHE_VERSION).then(cache =>
        fetch(e.request)
          .then(response => {
            cache.put(e.request, response.clone());
            return response;
          })
          .catch(() => cache.match(e.request))
      )
    );
    return;
  }

  // Tout le reste (fonts, etc.) : réseau normal sans interception
});
