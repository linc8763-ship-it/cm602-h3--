self.addEventListener('install', e=>e.waitUntil(caches.open('cm602-v1').then(c=>c.addAll(['./','./index.html','./app.js','./manifest.webmanifest','./template.xlsx']))));
self.addEventListener('fetch', e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
