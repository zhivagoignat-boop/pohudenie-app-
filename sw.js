/* Офлайн-режим: приложение открывается без интернета (в зале связи может не быть).
   Всегда сначала спрашиваем сервер, кеш — только запасной вариант на случай без сети. */
var CACHE = 'weightloss-2026-10-04.2';   // меняется при каждом обновлении — старый кеш удаляется
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
  // сторонние адреса (SDK Telegram) не трогаем — их ответы непрозрачны
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    // no-cache: браузер обязан сверить файл с сервером, а не отдать свою копию.
    // Если файл не менялся, сервер ответит коротким «304», так что это дёшево.
    fetch(e.request, { cache: 'no-cache' }).then(function (res) {
      if (res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      // нет сети — отдаём сохранённое; ?v= в адресе не мешает найти файл
      return caches.match(e.request, { ignoreSearch: true }).then(function (r) {
        return r || caches.match('./index.html', { ignoreSearch: true });
      });
    })
  );
});
