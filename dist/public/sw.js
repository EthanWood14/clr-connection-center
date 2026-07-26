// West Capital Lending portals — shared service worker
// Keeps one release-aware app shell while preserving separate C3 and LAP routes.

const CACHE_PREFIX = "wcl-app-shell-";
const RELEASE = new URL(self.location.href).searchParams.get("v") || "dev";
const SAFE_RELEASE = RELEASE.replace(/[^a-zA-Z0-9._-]/g, "-");
const CACHE_NAME = `${CACHE_PREFIX}${SAFE_RELEASE}`;
const LEGACY_CACHE_PATTERN = /^wclcc-v\d+$/;

const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/manifest-lap.json",
  "/favicon.ico",
  "/favicon-32.png",
  "/favicon-64.png",
  "/favicon-96.png",
  "/favicon-128.png",
  "/favicon-180.png",
  "/favicon-192.png",
  "/favicon-256.png",
  "/favicon-384.png",
  "/favicon-512.png",
  "/favicon-maskable-512.png",
  "/favicon-monochrome-512.png",
  "/lap-icon.svg",
  "/lap-icon-96.png",
  "/lap-icon-180.png",
  "/lap-icon-192.png",
  "/lap-icon-512.png",
  "/lap-badge-96.png",
  "/lap-wordmark.svg",
  "/lap-wordmark-light.svg",
];

// App identity assets must update immediately when a release changes.
const NETWORK_FIRST_PATHS = new Set([
  "/manifest.json",
  "/manifest-lap.json",
  "/favicon.ico",
  "/favicon-32.png",
  "/favicon-192.png",
  "/favicon-512.png",
  "/favicon-maskable-512.png",
  "/lap-icon.svg",
  "/lap-icon-96.png",
  "/lap-icon-180.png",
  "/lap-icon-192.png",
  "/lap-icon-512.png",
  "/lap-badge-96.png",
]);

// These tools deliberately exist in both C3 and LAP. Legacy notifications can
// follow the only open product without crossing into a product-only route.
const LAP_SHARED_NOTIFICATION_ROUTES = new Map([
  ["chat", "chat"],
  ["forum", "forum"],
  ["check-ins", "check-ins"],
  ["comp-requests", "comp-requests"],
  ["my-schedule", "my-schedule"],
  ["team-stats", "team-stats"],
  ["time-clock", "time-clock"],
  ["time-off", "time-off"],
]);

function parsedInternalUrl(value) {
  try {
    const parsed = new URL(String(value || "/"), self.location.origin);
    if (parsed.origin !== self.location.origin) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hashRoute(parsed) {
  if (parsed.hash.startsWith("#/")) {
    return parsed.hash.slice(2);
  }
  const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
  const query = parsed.search.startsWith("?") ? parsed.search.slice(1) : "";
  return `${path}${query ? `?${query}` : ""}`;
}

function splitRoute(routeWithQuery) {
  const queryIndex = routeWithQuery.indexOf("?");
  if (queryIndex === -1) return { route: routeWithQuery, query: "" };
  return {
    route: routeWithQuery.slice(0, queryIndex),
    query: routeWithQuery.slice(queryIndex + 1),
  };
}

function appHome(portal) {
  return `${self.location.origin}${portal === "lap" ? "/#/lap" : "/#/"}`;
}

function normalizeInternalTarget(value, portal) {
  const parsed = parsedInternalUrl(value);
  if (!parsed) return appHome(portal);

  const parts = splitRoute(hashRoute(parsed));
  const route = parts.route.replace(/^\/+|\/+$/g, "");
  const query = parts.query ? `?${parts.query}` : "";
  const isLapRoute = route === "lap" || route.startsWith("lap/");

  if (portal === "lap") {
    if (isLapRoute) {
      return `${self.location.origin}/#/${route}${query}`;
    }
    const sharedRoute = LAP_SHARED_NOTIFICATION_ROUTES.get(route);
    return sharedRoute
      ? `${self.location.origin}/#/lap/${sharedRoute}${query}`
      : appHome("lap");
  }

  if (isLapRoute) return appHome("c3");
  return `${self.location.origin}/#/${route}${query}`;
}

function isLapClient(client) {
  try {
    const parsed = new URL(client.url);
    return parsed.hash === "#/lap"
      || parsed.hash.startsWith("#/lap/")
      || parsed.searchParams.get("portal") === "lap";
  } catch {
    return false;
  }
}

function isC3Client(client) {
  try {
    const parsed = new URL(client.url);
    return !isLapClient(client) && !parsed.hash.startsWith("#/portal/");
  } catch {
    return false;
  }
}

function lapSharedTarget(value) {
  const parsed = parsedInternalUrl(value);
  if (!parsed) return null;
  const parts = splitRoute(hashRoute(parsed));
  const route = parts.route.replace(/^\/+|\/+$/g, "");
  const sharedRoute = LAP_SHARED_NOTIFICATION_ROUTES.get(route);
  if (!sharedRoute) return null;
  return `${self.location.origin}/#/lap/${sharedRoute}${parts.query ? `?${parts.query}` : ""}`;
}

function internalLapTarget(value) {
  const parsed = parsedInternalUrl(value);
  if (!parsed) return false;
  const route = splitRoute(hashRoute(parsed)).route.replace(/^\/+|\/+$/g, "");
  return route === "lap" || route.startsWith("lap/");
}

async function focusAt(client, destination) {
  try {
    const navigated = await client.navigate(destination);
    if (navigated && "focus" in navigated) return navigated.focus();
  } catch {}
  return "focus" in client ? client.focus() : undefined;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) =>
        Promise.allSettled(STATIC_ASSETS.map((asset) => cache.add(asset)))
      ),
      self.skipWaiting(),
    ])
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) =>
              key !== CACHE_NAME
              && (key.startsWith(CACHE_PREFIX) || LEGACY_CACHE_PATTERN.test(key))
            )
            .map((key) => caches.delete(key))
        )
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  const explicitPortal = data.portal === "lap" || data.portal === "c3"
    ? data.portal
    : null;
  const inferredPortal = internalLapTarget(data.url) ? "lap" : "legacy";
  const portal = explicitPortal || inferredPortal;
  const lapPayload = portal === "lap";
  const targetUrl = normalizeInternalTarget(data.url, lapPayload ? "lap" : "c3");
  const title = data.title || (lapPayload ? "LO Assistant Portal" : "CLR Connection Center");
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: lapPayload ? "/lap-icon-192.png" : "/favicon-192.png",
    badge: lapPayload ? "/lap-badge-96.png" : "/favicon-monochrome-512.png",
    data: { url: targetUrl, portal },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notificationData = event.notification.data || {};
  const requestedPortal = notificationData.portal === "lap"
    ? "lap"
    : (notificationData.portal === "c3" ? "c3" : "legacy");
  const c3Target = normalizeInternalTarget(notificationData.url, "c3");
  const lapTarget = normalizeInternalTarget(notificationData.url, "lap");
  const sharedLapTarget = lapSharedTarget(c3Target);

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const lapWindow = wins.find(isLapClient);
      const c3Window = wins.find(isC3Client);

      if (requestedPortal === "lap") {
        if (lapWindow) return focusAt(lapWindow, lapTarget);
        return clients.openWindow(lapTarget);
      }

      if (requestedPortal === "c3") {
        if (c3Window) return focusAt(c3Window, c3Target);
        return clients.openWindow(c3Target);
      }

      // Legacy payloads predate the portal marker. Only a shared route may be
      // redirected into LAP; every other legacy route remains in C3.
      if (lapWindow && !c3Window && sharedLapTarget) {
        return focusAt(lapWindow, sharedLapTarget);
      }
      if (c3Window) return focusAt(c3Window, c3Target);
      return clients.openWindow(c3Target);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() =>
          caches.match("/").then((cached) => cached || new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }))
        )
    );
    return;
  }

  if (NETWORK_FIRST_PATHS.has(url.pathname)) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          if (response && response.status === 200 && response.type !== "opaque") {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached || Response.error())
        )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === "opaque") {
          return response;
        }
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
