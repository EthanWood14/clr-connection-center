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

  // Any prospect-scoped GET names the prospect on screen: /prospects/123, and
  // also /prospects/123/notes and a future /api/v4. It must NOT match a list
  // (/prospects?search=), which carries no id in the path. Pinning this to
  // exactly /api/v3/prospects/123 was too tight — one Bonzo change and the
  // button silently never appeared, with nothing on screen to say why.
  const DETAIL_RE = /\/api(?:\/v\d+)?\/prospects\/(\d+)(?:[/?#]|$)/;

  // A conversation page never fetches the prospect by id — it fetches the
  // CONVERSATION, and the prospect rides inside the response. So /conversations
  // /144540156 announced nothing, the content script saw no prospect, and the
  // orange button simply never appeared on the screen where most of the work
  // actually happens. Reported from the floor: "there's no orange button".
  const CONVERSATION_RE = /\/api(?:\/v\d+)?\/conversations\/(\d+)(?:[/?#]|$)/;

  /**
   * Dig the prospect out of a conversation payload.
   *
   * Deliberately NOT a bare search for any "id" — this decides who gets
   * shotgunned, and picking the wrong number would publish to the wrong
   * person. Only a value sitting under a prospect-named key counts, and only
   * a positive integer. Bonzo's shape is not ours to control, so several
   * spellings are accepted; anything else announces nothing at all, which
   * leaves the button hidden rather than pointed at a stranger.
   */
  const prospectFromConversation = (body) => {
    const seen = new Set();
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 6 || seen.has(node)) return null;
      seen.add(node);
      for (const key of Object.keys(node)) {
        const value = node[key];
        const k = key.toLowerCase();
        // prospect_id / prospectId, carrying the id directly.
        if ((k === "prospect_id" || k === "prospectid") && Number.isFinite(Number(value)) && Number(value) > 0) {
          return { id: Number(value), fields: node.prospect || null };
        }
        // prospect / contact / person, an object that carries its own id.
        if ((k === "prospect" || k === "contact" || k === "person")
            && value && typeof value === "object"
            && Number.isFinite(Number(value.id)) && Number(value.id) > 0) {
          return { id: Number(value.id), fields: value };
        }
      }
      for (const key of Object.keys(node)) {
        const found = walk(node[key], depth + 1);
        if (found) return found;
      }
      return null;
    };
    try { return walk(body, 0); } catch { return null; }
  };

  // Either shape is worth reading the body of.
  const WATCHED_RE = new RegExp(DETAIL_RE.source + "|" + CONVERSATION_RE.source);

  let last = null;

  const announce = (id, data, conversationId) => {
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
    // The conversation this came from, when it came from one. The content
    // script drops an announce whose conversation is no longer the one on
    // screen — otherwise a slow response from the thread you just left would
    // point the button at the previous borrower, and shotgunning the wrong
    // person is the one failure this extension must not have.
    last = {
      type: "C3_SHOTGUN_PROSPECT",
      id: Number(id),
      fields,
      conversationId: Number.isFinite(Number(conversationId)) ? Number(conversationId) : null,
    };
    window.postMessage(last, window.location.origin);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== "C3_SHOTGUN_PING") return;
    if (last) window.postMessage(last, window.location.origin);
  });

  const check = (url, body) => {
    try {
      const u = String(url || "");
      const m = u.match(DETAIL_RE);
      if (m) { announce(m[1], body); return; }
      // Same job, one level in: the conversation response names the prospect
      // whose thread is on screen.
      const c = u.match(CONVERSATION_RE);
      if (c) {
        const found = prospectFromConversation(body);
        if (found) announce(found.id, found.fields, c[1]);
      }
    } catch {}
  };

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === "string" ? req : req && req.url;
      const method = ((args[1] && args[1].method) || (req && req.method) || "GET").toUpperCase();
      if (method === "GET" && WATCHED_RE.test(String(url || ""))) {
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
      if (String(method).toUpperCase() === "GET" && WATCHED_RE.test(String(url || ""))) {
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
