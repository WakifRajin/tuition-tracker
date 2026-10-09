// TuitionPro service worker: offline app shell + cached third-party libraries.
// Bump VERSION whenever the list of precached files changes.
const VERSION = "4.0.0";
const SHELL_CACHE = `tuitionpro-shell-${VERSION}`;
const RUNTIME_CACHE = "tuitionpro-runtime-v1";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./logo.svg",
  "./css/app.css",
  "./js/app.js",
  "./js/store.js",
  "./js/backends/firebase.js",
  "./js/backends/local.js",
  "./js/lib/billing.js",
  "./js/lib/dates.js",
  "./js/lib/format.js",
  "./js/lib/model.js",
  "./js/ui/charts.js",
  "./js/ui/dom.js",
  "./js/ui/forms.js",
  "./js/ui/search.js",
  "./js/ui/theme.js",
  "./js/views/analytics.js",
  "./js/views/common.js",
  "./js/views/dashboard.js",
  "./js/views/settings.js",
  "./js/views/students.js",
];

self.addEventListener("install", (event) => {
  // Bypass the HTTP cache so a new VERSION never precaches stale files.
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("tuitionpro-shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/**
 * Network first (fresh code when online), cache fallback only when the network
 * fails. No timeout: falling back per-file on a slow connection could mix old
 * and new modules, which breaks ES module imports.
 */
async function networkFirst(request, { fallbackUrl } = {}) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = (await cache.match(request, { ignoreSearch: true })) || (fallbackUrl && (await cache.match(fallbackUrl)));
    if (cached) return cached;
    throw err;
  }
}

/** Versioned third-party files (Firebase SDK, fonts): serve from cache, refresh in background. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, request.mode === "navigate" ? { fallbackUrl: "./index.html" } : {}));
    return;
  }
  const cacheable =
    (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com";
  if (cacheable) event.respondWith(staleWhileRevalidate(request));
  // Everything else (Firestore, Auth, analytics) goes straight to the network.
});
