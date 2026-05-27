const CACHE_NAME = 'aridos-app-v2';

const APP_SHELL = [
  '/',
  '/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo interceptar GET y misma origin
  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;

  // Ignorar peticiones a Firebase / APIs externas
  if (request.url.includes('firestore.googleapis.com') || request.url.includes('firebase')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cachear solo respuestas OK de assets estáticos (JS, CSS, fonts, imágenes)
        if (response.ok && /\.(js|css|woff2?|png|jpg|svg|ico)(\?|$)/.test(request.url)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        // Offline: devolver HTML del app shell para navegación
        caches.match(request).then((cached) => cached || caches.match('/index.html'))
      )
  );
});
