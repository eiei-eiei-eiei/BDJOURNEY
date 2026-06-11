/**
 * Service Worker — Our Diary PWA
 *  - cache app shell (offline เปิดได้)
 *  - ไม่ cache request ไป API (ข้อมูลต้องสด) — รูปแยก cache ใน IndexedDB ฝั่งแอปอยู่แล้ว
 */
const CACHE = 'ourdiary-v1';
const SHELL = [
  '.', 'index.html', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // ข้าม request ไป GAS API (script.google.com / googleusercontent) — ให้วิ่ง network ตรง
  if (url.hostname.indexOf('google') !== -1) return;
  // app shell: cache-first
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (e.request.method === 'GET' && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
