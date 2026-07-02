const CACHE_NAME = 'cm602-h3-stage2-v1';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json', './icons/icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
