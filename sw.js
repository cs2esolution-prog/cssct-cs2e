// Service worker de « Mon appli CSSCT » : uniquement les notifications.
// VERSION : à augmenter à chaque livraison qui modifie ce fichier (le navigateur le remplace alors tout seul).
// Volontairement aucune mise en cache des pages : l'application reste toujours à jour (voir backlog technique).
const VERSION = '1.0.0';

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  // Supprime toute ancienne copie en cache d'une version précédente, puis prend le contrôle des pages ouvertes.
  e.waitUntil(
    caches.keys()
      .then(function (noms) { return Promise.all(noms.map(function (n) { return caches.delete(n); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'version' && e.source) e.source.postMessage({ version: VERSION });
});

// Notification reçue du serveur : le contenu est toujours générique (aucun nom, code ni détail).
self.addEventListener('push', function (e) {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { corps: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titre || 'CSSCT', {
    body: d.corps || 'Consulte l’application.',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag || 'cssct',
    data: { url: d.url || 'index.html' }
  }));
});

// Clic sur la notification : ouvre (ou ramène au premier plan) la bonne page.
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const cible = new URL((e.notification.data && e.notification.data.url) || 'index.html', self.registration.scope);
  if (cible.origin !== self.location.origin) return;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (liste) {
    for (const c of liste) {
      if ('focus' in c) { if ('navigate' in c) c.navigate(cible.href); return c.focus(); }
    }
    return self.clients.openWindow(cible.href);
  }));
});
