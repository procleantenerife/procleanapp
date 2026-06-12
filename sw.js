const CACHE = 'proclean-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match('/index.html')))
  );
});

/* ── Push notifications ── */
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'ProClean';
  const options = {
    body: data.body || 'You have a new update.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'proclean-notif',
    renotify: true,
    requireInteraction: data.requireInteraction || false,
    data: { url: data.url || '/', jobId: data.jobId },
    actions: data.actions || []
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action;
  const jobId  = e.notification.data?.jobId;
  const url    = e.notification.data?.url || '/';

  if (action === 'done' && jobId) {
    /* Mark job done directly from notification — no app open needed */
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
        /* Broadcast to any open app window */
        wins.forEach(w => w.postMessage({ type: 'MARK_JOB_DONE', jobId }));
        /* Also write straight to a pending-actions store so app picks it up on next open */
        return self.registration.sync?.register('sync-job-' + jobId).catch(() => {});
      }).then(() => {
        /* Confirm to user */
        return self.registration.showNotification('ProClean', {
          body: '✓ Job marked as complete.',
          icon: '/icons/icon-192.png',
          tag: 'proclean-confirm',
          requireInteraction: false
        });
      })
    );
    return;
  }

  /* Default: open / focus the app */
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const match = wins.find(w => w.url.includes(self.location.origin));
      if (match) return match.focus();
      return clients.openWindow(url);
    })
  );
});

/* ── Background sync ── */
self.addEventListener('sync', e => {
  if (e.tag.startsWith('sync-job-')) {
    const jobId = e.tag.replace('sync-job-', '');
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
        wins.forEach(w => w.postMessage({ type: 'MARK_JOB_DONE', jobId }));
      })
    );
  }
});
