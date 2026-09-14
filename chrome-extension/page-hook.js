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

  // ── Calls placed inside Bonzo ─────────────────────────────────────────────
  // Not every call goes through Dialpad — Bonzo places some itself, and those
  // reach no other system. A call being placed looks like a non-GET request to
  // a call-shaped path, so report those to the content script, which forwards
  // them to C3 against the signed-in CLR. That is the point: WHO is calling.
  //
  // The two patterns are copied VERBATIM from shared/bonzo-calls.ts and a
  // test keeps them identical. The strict one is what C3 counts; the wide one
  // is only recorded, so Bonzo's real shape can be pinned from real traffic
  // (C3 → Integrations → Bonzo calls) rather than guessed. Nothing here talks
  // to C3, and no request body ever leaves the page — only the path.
  const CALL_PATH_SOURCE = "/(?:calls?|dial(?:er)?)(?:/|$)";
  const CALL_CANDIDATE_SOURCE = "(?:^|[/_-])(?:calls?|dial(?:er)?|voice|phone|twilio|telephony)(?:[/_?.-]|$)";
  const CALL_CANDIDATE_RE = new RegExp(CALL_CANDIDATE_SOURCE, "i");
  void CALL_PATH_SOURCE; // decided server-side; kept here so the pair stays in one place
  const PROSPECT_IN_PATH = /\/prospects?\/(\d+)/i;
  const pathOf = (url) => {
    try { return new URL(String(url || ""), location.origin).pathname; } catch { return String(url || "").split("?")[0]; }
  };
  const newEventId = () => {
    try { return crypto.randomUUID(); } catch { return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  };
  // The prospect a call is for, when the request names it. Only a value
  // under a prospect-named key, only a positive integer — same rule as the
  // conversation walker above. Bodies are read, never forwarded.
  const prospectFromBody = (body) => {
    try {
      if (!body || typeof body !== "string") return null;
      const j = JSON.parse(body);
      const v = j && (j.prospect_id ?? j.prospectId ?? (j.prospect && j.prospect.id));
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch { return null; }
  };
  const reportCall = (method, url, body) => {
    try {
      const m = String(method || "GET").toUpperCase();
      if (m === "GET") return;
      const path = pathOf(url);
      if (!CALL_CANDIDATE_RE.test(path)) return;
      const inPath = path.match(PROSPECT_IN_PATH);
      window.postMessage({
        type: "C3_BONZO_CALL",
        eventId: newEventId(),
        kind: "network",
        method: m,
        path,
        prospectId: inPath ? Number(inPath[1]) : prospectFromBody(body),
        occurredAt: new Date().toISOString(),
      }, window.location.origin);
    } catch {}
  };

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === "string" ? req : req && req.url;
      const method = ((args[1] && args[1].method) || (req && req.method) || "GET").toUpperCase();
      reportCall(method, url, args[1] && args[1].body);
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

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    try { reportCall(this.__c3Method, this.__c3Url, body); } catch {}
    return origSend.call(this, body);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      this.__c3Method = method;
      this.__c3Url = url;
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
