// Runs in the PAGE's world (world: "MAIN") at document_start, before Bonzo's
// app boots. Bonzo is a SPA whose prospect URLs we don't control, so instead of
// guessing URL shapes we watch the app's own API traffic: whenever it GETs
// /api(/v3)/prospects/{id}, that id is the prospect on screen. We forward the
// id plus a few display fields to the isolated-world content script via
// postMessage, and keep the last announcement so the content script can ask
// for a replay (it registers its listener at document_idle — later than a fast
// detail fetch can land). Nothing here talks to C3 — this file only observes.
(() => {
  if (window.__c3ShotgunHooked) return;
  window.__c3ShotgunHooked = true;

  // Detail fetch only — /prospects/123, not /prospects?search= or /prospects/123/notes.
  const DETAIL_RE = /\/api(?:\/v3)?\/prospects\/(\d+)(?:\?.*)?$/;

  let last = null;

  const announce = (id, data) => {
    let fields = null;
    try {
      const d = (data && (data.data || data)) || null;
      if (d && d.id != null) {
        fields = {
          firstName: String(d.first_name || ""),
          lastName: String(d.last_name || ""),
          fullName: String(d.full_name || "") || [d.first_name, d.last_name].filter(Boolean).join(" "),
          phone: String(d.phone || ""),
          state: String(d.state || ""),
        };
      }
    } catch {}
    last = { type: "C3_SHOTGUN_PROSPECT", id: Number(id), fields };
    window.postMessage(last, window.location.origin);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== "C3_SHOTGUN_PING") return;
    if (last) window.postMessage(last, window.location.origin);
  });

  const check = (url, body) => {
    try {
      const m = String(url || "").match(DETAIL_RE);
      if (m) announce(m[1], body);
    } catch {}
  };

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === "string" ? req : req && req.url;
      const method = ((args[1] && args[1].method) || (req && req.method) || "GET").toUpperCase();
      if (method === "GET" && DETAIL_RE.test(String(url || ""))) {
        // Known trade-off: observing the promise marks a rejected detail-GET
        // as handled, so Bonzo's own unhandledrejection telemetry won't see
        // it. Only failed prospect-detail GETs are affected.
        p.then((res) => {
          try { res.clone().json().then((j) => check(url, j), () => check(url, null)); } catch { check(url, null); }
        }, () => {});
      }
    } catch {}
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (String(method).toUpperCase() === "GET" && DETAIL_RE.test(String(url || ""))) {
        this.addEventListener("load", () => {
          let body = null;
          try { body = JSON.parse(this.responseText); } catch {}
          check(url, body);
        });
      }
    } catch {}
    return origOpen.call(this, method, url, ...rest);
  };
})();
