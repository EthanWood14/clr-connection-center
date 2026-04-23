// CLR Connection Center — Service Worker
// Provides offline shell caching and background sync support

const CACHE_NAME = "wclcc-v2";
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/favicon.svg",
  "/favicon.ico",
  "/favicon-16.png",
  "/favicon-32.png",
  "/favicon-64.png",
  "/favicon-180.png",
  "/favicon-192.png",
  "/favicon-256.png",
  "/favicon-384.png",
  "/favicon-512.png",
  "/favicon-maskable-512.png",
  "/favicon-monochrome-512.png",
  "/wcl-logo.png",
];

// Install: cache static shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Silently ignore caching failures (e.g., network offline)
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Push: show a notification
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "CLR Connection Center";
  const options = {
    body: data.body || "",
    icon: "/favicon-192.png",
    badge: "/favicon-192.png",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click: focus or open the target URL
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(targetUrl).catch(() => {});
          return w.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// Fetch: network-first for API, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and API calls (always go to network)
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;

  // For navigation requests, return index.html (SPA shell)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/").then((cached) => cached || new Response("Offline"))
      )
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === "opaque") {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      });
    })
  );
});
