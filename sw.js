// ============================================================
//  CERAF Bafoussam — Service Worker (sw.js)
//  - Cache la coquille de l'app pour démarrage hors ligne
//  - Met en file d'attente les mises à jour de statut
//    et les synchronise au retour du réseau
// ============================================================

const CACHE_NAME    = 'ceraf-v1';
const QUEUE_KEY     = 'ceraf-offline-queue';

// Fichiers à mettre en cache pour le démarrage hors ligne
const SHELL_FILES   = [
  './index.html',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Fraunces:wght@700;800&display=swap'
];

// ── INSTALLATION ────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATION ──────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Requêtes vers Apps Script : réseau d'abord, sinon file d'attente
  if (url.hostname.includes('script.google.com')) {
    e.respondWith(networkFirstWithQueue(e.request));
    return;
  }

  // Google Fonts et ressources externes : cache d'abord
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // Fichiers de l'app (index.html, etc.) : cache d'abord
  e.respondWith(cacheFirst(e.request));
});

// ── STRATÉGIE : cache d'abord ───────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('<h2>Hors ligne</h2>', {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// ── STRATÉGIE : réseau d'abord, sinon file d'attente ────────
async function networkFirstWithQueue(request) {
  try {
    const response = await fetch(request.clone());
    // Si la réponse est OK et c'est une mise à jour de statut
    // on peut aussi vider la file d'attente
    flushQueue();
    return response;
  } catch {
    // Hors ligne : si c'est une mise à jour de statut (POST),
    // on la met en file d'attente
    if (request.method === 'POST') {
      await enqueue(request);
      return new Response(
        JSON.stringify({ success: true, offline: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
    // Pour les GET (lecture), retourner une erreur explicite
    return new Response(
      JSON.stringify({ success: false, error: 'Hors ligne — données non disponibles' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── FILE D'ATTENTE (IndexedDB via Cache API) ─────────────────
async function enqueue(request) {
  try {
    const body = await request.text();
    const data = JSON.parse(body);
    // On ne met en file que les mises à jour de statut
    if (data.action !== 'updateStatus') return;
    const cache = await caches.open('ceraf-queue');
    const key   = './queue-' + Date.now();
    await cache.put(key, new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Queue-URL': request.url
      }
    }));
  } catch(e) {
    console.warn('[SW] Enqueue error:', e);
  }
}

async function flushQueue() {
  try {
    const cache   = await caches.open('ceraf-queue');
    const keys    = await cache.keys();
    if (keys.length === 0) return;

    for (const key of keys) {
      const resp   = await cache.match(key);
      const body   = await resp.text();
      const url    = resp.headers.get('X-Queue-URL');
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body
        });
        if (r.ok) await cache.delete(key);
      } catch {
        break; // toujours hors ligne, on arrête
      }
    }

    // Notifier l'app que la synchro est terminée
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: 'SYNC_DONE' }));
  } catch(e) {
    console.warn('[SW] Flush error:', e);
  }
}

// ── SYNC EN ARRIÈRE-PLAN (Background Sync API) ───────────────
self.addEventListener('sync', e => {
  if (e.tag === 'ceraf-status-sync') {
    e.waitUntil(flushQueue());
  }
});
