// ============================================================
//  CERAF Bafoussam — Service Worker (sw.js)
//  Rôle UNIQUE : file d'attente hors ligne pour les statuts.
//  L'app shell (HTML/CSS/JS) est gérée par GitHub Pages.
//  On ne cache RIEN ici pour éviter les conflits de version.
// ============================================================

const SW_VERSION = 'ceraf-sw-v2';

// ── INSTALLATION : pas de précache ──────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
});

// ── ACTIVATION : vider les anciens caches ───────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── FETCH : on ne fait RIEN, on laisse passer tout ──────────
// Pas d'interception → pas de risque de servir du contenu corrompu.
// La file d'attente hors ligne est gérée côté app (localStorage).
self.addEventListener('fetch', e => {
  // Laisser le navigateur gérer normalement
  return;
});

// ── SYNC : déclenché au retour du réseau ────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'ceraf-status-sync') {
    e.waitUntil(notifyClientsToFlush());
  }
});

async function notifyClientsToFlush() {
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'SYNC_DONE' }));
}
