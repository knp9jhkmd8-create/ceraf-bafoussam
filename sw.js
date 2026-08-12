// ============================================================
//  CERAF Bafoussam — Service Worker v27
//  - Met en cache index.html pour accès hors ligne
//  - Ne touche PAS aux requêtes Apps Script
//  - Vide automatiquement l'ancien cache à chaque mise à jour
//  - HTML servi en NETWORK-FIRST : la version la plus récente s'affiche
//    dès qu'il y a du réseau (le cache-first précédent laissait voir
//    l'ancienne page un lancement de trop après chaque mise à jour) ;
//    le cache ne sert plus que de secours hors-ligne.
// ============================================================

const CACHE_VERSION = 'ceraf-v27';
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

  // Ne JAMAIS intercepter la sonde de connectivité (ping.txt?p=…). Elle n'est
  // pas dans CACHE_FILES aujourd'hui, donc elle passe déjà au réseau — mais si
  // quelqu'un l'y ajoutait un jour, le cache répondrait et la sonde MENTIRAIT
  // (« en ligne » alors qu'on est hors ligne). Bug quasi indiagnosticable plus
  // tard : on ferme la porte tout de suite.
  if (url.searchParams.has('p')) return;

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
        // cache:'no-cache' — et NON 'reload'.
        //
        //   'reload'   ignore le cache HTTP ET ses validateurs → les 213 Ko
        //              d'index.html étaient RETÉLÉCHARGÉS EN ENTIER à chaque
        //              lancement de l'app, de façon bloquante, avant qu'une
        //              seule ligne de JS ne s'exécute.
        //   'no-cache' force la REVALIDATION mais envoie If-None-Match.
        //              GitHub Pages renvoie un ETag → 304, ~200 octets.
        //
        // La propriété qui motivait 'reload' est strictement préservée : on
        // revalide toujours auprès du serveur, donc une PWA iOS ne peut pas
        // rester bloquée sur une version périmée servie par le cache du
        // WebView. C'est toujours du network-first, un déploiement est
        // toujours vu immédiatement — on économise juste le corps de la
        // réponse quand rien n'a changé.
        fetch(e.request, { cache: 'no-cache' })
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
