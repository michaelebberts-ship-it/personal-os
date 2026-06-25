// Service Worker — Ebberts Command Center
// Strategy: network-first with cache fallback.
// New deploys take effect immediately via skipWaiting.

const CACHE = 'ecc-v2';

const PRECACHE = [
  './',
  './index.html',
  './css/design-system.css',
  './css/layout.css',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/state.js',
  './js/router.js',
  './js/ai.js',
  './js/ical.js',
  './js/weather.js',
  './js/calendar.js',
  './js/debrief.js',
  './modules/home.js',
  './modules/calendar.js',
  './modules/reminders.js',
  './modules/crm.js',
  './modules/finances.js',
  './modules/meals.js',
  './modules/family.js',
  './modules/household.js',
  './modules/email.js',
  './modules/transformation.js',
];

self.addEventListener('install', e => {
  // Take over immediately — don't wait for old tabs to close
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE).catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  // Delete old caches from previous versions
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Only handle same-origin GET requests
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (!url.origin.includes('github.io') && !url.origin.includes('localhost') && url.origin !== self.location.origin) return;

  // Skip external CDNs (fonts, Firebase SDK) — let them handle their own caching
  if (url.hostname.includes('fonts.googleapis') || url.hostname.includes('fonts.gstatic') ||
      url.hostname.includes('firestore.googleapis') || url.hostname.includes('firebase')) return;

  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(res => {
        // Cache a clone of successful responses
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
