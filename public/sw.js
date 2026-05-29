/**
 * KIARA Service Worker
 * Handles caching, offline mode, push notifications, and background sync
 */

const CACHE_NAME = 'kiara-v2.2';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

// Install - cache critical assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker v2.2');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch - network first with cache fallback (for HTML/API)
// Cache first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and API proxy (WebSocket)
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api-proxy')) return;
  if (url.pathname.startsWith('/api/')) return;

  // For navigation requests - network first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match('/') || new Response('Offline'))
    );
    return;
  }

  // For static assets - cache first
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|woff2?|ttf|ico)$/)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Default - network first
  event.respondWith(
    fetch(request)
      .then((response) => {
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Push Notification handler
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  let data = { title: 'Kiara', body: 'You have a new notification', icon: '/icons/icon-192x192.png' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || data.message || '',
    icon: data.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || `kiara-${Date.now()}`,
    renotify: true,
    requireInteraction: data.requireInteraction || false,
    data: {
      url: data.url || '/',
      action: data.action || 'open',
      ...data.data
    },
    actions: data.actions || [
      { action: 'open', title: 'Open Kiara' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Kiara', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            action: event.action || 'open',
            data: event.notification.data
          });
          return;
        }
      }
      // Open new window
      return self.clients.openWindow(urlToOpen);
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-memories') {
    event.waitUntil(syncOfflineData());
  } else if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

async function syncOfflineData() {
  // This will be triggered when the app comes back online
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_OFFLINE_DATA' });
  });
}

async function syncMessages() {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_MESSAGES' });
  });
}

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-reminders') {
    event.waitUntil(checkReminders());
  }
});

async function checkReminders() {
  // Notify the app to check for due reminders
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'CHECK_REMINDERS' });
  });
}

// Message handler from main app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
