/* Офлайн-кэш: приложение открывается без интернета (в зале связи может не быть). */
var CACHE = 'weightloss-v1';
var FILES = [
  './', './index.html', './manifest.webmanifest', './assets/icon.svg',
  './assets/css/app.css', './assets/js/data.js', './assets/js/store.js',
  './assets/js/report.js', './assets/js/telegram.js', './assets/js/ui.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // сторонние адреса (SDK Telegram) не кэшируем — их ответы непрозрачны
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match('./index.html'); }); })
  );
});
