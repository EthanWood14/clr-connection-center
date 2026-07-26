// CLR Connection Center — Service Worker
// Provides offline shell caching and background sync support

const CACHE_NAME = "wclcc-v9";
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/manifest-lap.json",
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
  "/lap-icon.svg",
  "/lap-wordmark.svg",
  "/lap-wordmark-light.svg",
];

// These tools deliberately exist in both C3 and LAP. When a LAP window is
// already open, keep shared notification clicks inside LAP. C3-only links
// retain their original destination, and closed-app clicks keep the existing
// C3 default unless the payload explicitly identifies LAP.
const LAP_SHARED_NOTIFICATION_ROUTES = new Map([
  ["chat", "chat"],
  ["forum", "forum"],
  ["check-ins", "check-ins"],
  ["comp-requests", "comp-requests"],
  ["my-schedule", "my-schedule"],
  ["time-clock", "time-clock"],
  ["time-off", "time-off"],
]);

function isLapClient(client) {
  try {
    return new URL(client.url).hash.startsWith("#/lap");
  } catch {
    return false;
  }
}

function lapSharedTarget(targetUrl) {
  try {
    const parsed = new URL(targetUrl, self.location.origin);
    if (parsed.origin !== self.location.origin) return null;

    const hashPath = parsed.hash.startsWith("#/")
      ? parsed.hash.slice(2)
      : parsed.pathname.replace(/^\/+/, "");
    const [route, query = ""] = hashPath.split("?");
    const lapRoute = LAP_SHARED_NOTIFICATION_ROUTES.get(route.replace(/\/+$/, ""));
    if (!lapRoute) return null;

    return `${self.location.origin}/#/lap/${lapRoute}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

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
  const lapPayload = data.portal === "lap"
    || (typeof data.url === "string" && data.url.includes("#/lap"));
  const title = data.title || (lapPayload ? "LO Assistant Portal" : "CLR Connection Center");
  const options = {
    body: data.body || "",
    icon: lapPayload ? "/lap-icon.svg" : "/favicon-192.png",
    badge: lapPayload ? "/lap-icon.svg" : "/favicon-192.png",
    data: {
      url: data.url || "/",
      portal: lapPayload ? "lap" : (data.portal === "c3" ? "c3" : null),
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click: focus or open the target URL
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notificationData = event.notification.data || {};
  const targetUrl = typeof notificationData.url === "string" ? notificationData.url : "/";
  const requestedPortal = notificationData.portal === "lap"
    ? "lap"
    : (notificationData.portal === "c3" ? "c3" : "legacy");
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const lapWindow = wins.find(isLapClient);
      const c3Window = wins.find((win) => !isLapClient(win));
      const sharedLapUrl = lapSharedTarget(targetUrl);

      if (requestedPortal === "lap") {
        const destination = targetUrl.includes("#/lap")
          ? targetUrl
          : (sharedLapUrl || `${self.location.origin}/#/lap`);
        if (lapWindow && "focus" in lapWindow) {
          lapWindow.navigate(destination).catch(() => {});
          return lapWindow.focus();
        }
        return clients.openWindow(destination);
      }

      if (c3Window && "focus" in c3Window) {
        c3Window.navigate(targetUrl).catch(() => {});
        return c3Window.focus();
      }

      if (requestedPortal === "c3") {
        return clients.openWindow(targetUrl);
      }

      // Old/shared payloads do not identify a portal. If LAP is the only open
      // product, keep genuinely shared destinations inside it. C3-only links
      // open a new C3 window instead of replacing the LAP workspace.
      if (lapWindow && sharedLapUrl && "focus" in lapWindow) {
        lapWindow.navigate(sharedLapUrl).catch(() => {});
        return lapWindow.focus();
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

  // For navigation requests, fetch the shell from the network (the server sends
  // index.html with no-cache, so it's always fresh — no stale hash pinning).
  // NOTE: never pass a RequestInit to fetch() with a navigate-mode Request — it
  // throws a TypeError and breaks every navigation. Reuse the request as-is.
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
