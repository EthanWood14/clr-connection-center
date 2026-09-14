// Isolated-world script: renders the floating "Shotgun" button and talks to the
// background worker (which holds the C3 host permission). The current prospect
// is anchored to the URL whenever the URL carries /prospects/{id} — announces
// from the page-hook (captured API traffic) fill in the name but can never arm
// a DIFFERENT prospect than the URL shows (out-of-order responses from fast
// click-throughs must not publish the wrong human). On id-less URLs the latest
// announce wins; navigating to a URL without the id hides the button until a
// fresh detail fetch confirms what's on screen.
(() => {
  const C3_URL = "https://www.westcapitallending.center";
  let current = null; // { id, fields|null }
  let lastHref = location.href;
  let busy = false;
  let revertTimer = null;
  let fireSeq = 0; // stale callbacks/timeouts from superseded clicks are ignored

  // Only patterns that NAME a prospect count. Deliberately not widened to bare
  // ?id= style params: a wrong guess here would publish the wrong human into
  // the rotation, which is far worse than showing no button.
  const URL_PATTERNS = [/\/prospects?\/(\d+)/i, /[?&#]prospect(?:_?id)?=(\d+)/i];
  // The conversation view names a THREAD, not a prospect — the prospect is
  // learned from the response the page-hook reads. Kept apart from the
  // patterns above precisely because it is NOT a prospect id, and treating it
  // as one would shotgun a number that means something else entirely.
  const CONVERSATION_URL = /\/conversations?\/(\d+)/i;
  const urlConversationId = () => {
    const m = location.href.match(CONVERSATION_URL);
    const n = m ? Number(m[1]) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const urlProspectId = () => {
    for (const re of URL_PATTERNS) {
      const m = location.href.match(re);
      if (m) return Number(m[1]);
    }
    return null;
  };

  // What this tab can see, for the popup to show. An extension that fails by
  // rendering nothing is undiagnosable — this is how it says why.
  const reportSeen = () => {
    try {
      chrome.storage.local.set({
        c3Seen: { href: location.href, id: current ? current.id : null, from: current ? current.from || "url" : null, at: Date.now() },
      });
    } catch {}
  };

  const btn = document.createElement("button");
  btn.id = "c3-shotgun-button";
  btn.type = "button";
  Object.assign(btn.style, {
    position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483000",
    display: "none", alignItems: "center", gap: "8px",
    padding: "12px 18px", border: "none", borderRadius: "999px",
    background: "linear-gradient(180deg,#f97316,#ea580c)", color: "#fff",
    font: "700 14px/1.2 system-ui, -apple-system, sans-serif",
    boxShadow: "0 6px 20px rgba(234,88,12,.45)", cursor: "pointer",
    maxWidth: "340px", textAlign: "left", whiteSpace: "normal",
  });
  // "Log result" — opens the panel (outcome-panel.js) for the prospect on
  // screen. Same anchoring rule as the Shotgun button: it only ever names the
  // prospect the URL or the page's own API traffic named.
  const logBtn = document.createElement("button");
  logBtn.id = "c3-log-result-button";
  logBtn.type = "button";
  Object.assign(logBtn.style, {
    position: "fixed", right: "18px", bottom: "70px", zIndex: "2147483000",
    display: "none", alignItems: "center", gap: "8px",
    padding: "10px 16px", border: "none", borderRadius: "999px",
    background: "linear-gradient(180deg,#0ea5e9,#0284c7)", color: "#fff",
    font: "700 13px/1.2 system-ui, -apple-system, sans-serif",
    boxShadow: "0 6px 20px rgba(2,132,199,.4)", cursor: "pointer",
  });
  logBtn.textContent = "📋 Log result in C3";
  logBtn.onclick = () => {
    if (!current) return;
    window.dispatchEvent(new CustomEvent("c3:open-outcome", { detail: { prospectId: current.id, fields: current.fields || null, url: location.href } }));
  };
  const ensureMounted = () => {
    if (!btn.isConnected && document.body) document.body.appendChild(btn);
    if (!logBtn.isConnected && document.body) document.body.appendChild(logBtn);
  };

  const firstName = () => {
    const f = current && current.fields;
    const n = (f && (f.firstName || f.fullName)) || "";
    return n.split(/\s+/)[0] || "";
  };

  const setIdle = () => {
    if (revertTimer) { clearTimeout(revertTimer); revertTimer = null; }
    busy = false;
    btn.style.background = "linear-gradient(180deg,#f97316,#ea580c)";
    btn.style.boxShadow = "0 6px 20px rgba(234,88,12,.45)";
    const who = firstName();
    if (current) {
      btn.textContent = who ? `⚡ Shotgun · ${who}` : "⚡ Shotgun this prospect";
      btn.style.opacity = "1";
      btn.style.cursor = "pointer";
      btn.onclick = fire;
    } else {
      // Never hide outright. A button that renders nothing when it cannot find
      // a prospect is indistinguishable from a broken install — which is
      // exactly how this failed in the office.
      btn.textContent = "⚡ Open a Bonzo prospect";
      btn.style.opacity = "0.45";
      btn.style.cursor = "default";
      btn.onclick = null;
    }
    btn.style.display = "inline-flex";
    // The result panel is only for a prospect the page has actually named.
    logBtn.style.display = current ? "inline-flex" : "none";
    reportSeen();
  };

  const showResult = (ok, text, { openC3 = false, ms = 7000 } = {}) => {
    busy = false;
    btn.style.background = ok
      ? "linear-gradient(180deg,#22c55e,#16a34a)"
      : "linear-gradient(180deg,#ef4444,#dc2626)";
    btn.style.boxShadow = ok ? "0 6px 20px rgba(22,163,74,.45)" : "0 6px 20px rgba(220,38,38,.45)";
    btn.textContent = text;
    btn.onclick = openC3 ? () => window.open(C3_URL, "_blank") : setIdle;
    if (revertTimer) clearTimeout(revertTimer);
    revertTimer = setTimeout(setIdle, ms);
  };

  const fire = () => {
    if (busy || !current) return;
    busy = true;
    const seq = ++fireSeq;
    btn.textContent = "Sending…";
    btn.onclick = null;
    try {
      chrome.runtime.sendMessage(
        { type: "c3shotgun.publish", prospectId: current.id, url: location.href },
        (resp) => {
          if (seq !== fireSeq) return; // a newer click owns the button now
          if (chrome.runtime.lastError || !resp) {
            showResult(false, "Extension error — reload this tab and try again.", { ms: 9000 });
            return;
          }
          if (resp.ok) {
            const name = (resp.body && resp.body.leadName) || firstName() || "Lead";
            showResult(true, resp.body && resp.body.assigned
              ? `✓ ${name} sent — a CLR is being offered it now`
              : `✓ ${name} sent — queued for the next ready CLR`);
          } else if (resp.status === 401) {
            showResult(false, "Not signed in to C3 — click to open C3, or paste your key in the extension popup.", { openC3: true, ms: 12000 });
          } else {
            const msg = (resp.body && resp.body.error) || `C3 error (HTTP ${resp.status || "?"})`;
            showResult(false, `✕ ${msg}`, { ms: 10000 });
          }
        },
      );
    } catch {
      showResult(false, "Extension error — reload this tab and try again.", { ms: 9000 });
      return;
    }
    // The server may legitimately take up to ~50s (Bonzo fetch is 25s + a 25s
    // org-token retry), so give up well after that — and never claim failure
    // outright: the publish may still land.
    setTimeout(() => {
      if (seq === fireSeq && busy) {
        showResult(false, "Still no reply — the lead may have gone through. Check C3 before clicking again.", { ms: 10000 });
      }
    }, 60000);
  };

  // ── Calls placed inside Bonzo ─────────────────────────────────────────────
  // Two signals, both forwarded to C3 against the signed-in CLR: a
  // call-shaped request the page-hook saw, and a click on one of Bonzo's own
  // call controls (a tel: link, or a button labelled "Call"). C3 folds a
  // click and the request it fired in the same minute into one call. Sent
  // one at a time — a CLR places tens of calls a day, not thousands.
  const newEventId = () => {
    try { return crypto.randomUUID(); } catch { return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  };
  const sendCall = (ev) => {
    try {
      chrome.runtime.sendMessage({
        type: "c3shotgun.call",
        event: {
          eventId: ev.eventId || newEventId(),
          kind: ev.kind,
          method: ev.method,
          path: ev.path,
          prospectId: ev.prospectId || (current ? current.id : null),
          occurredAt: ev.occurredAt || new Date().toISOString(),
          url: location.href,
        },
      }, () => { void chrome.runtime.lastError; });
    } catch {}
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.type !== "C3_BONZO_CALL" || !d.path) return;
    sendCall(d);
  });
  document.addEventListener("click", (ev) => {
    try {
      const t = ev.target;
      const el = t && t.closest && t.closest('a[href^="tel:"], button, [role="button"]');
      if (!el) return;
      const href = String(el.getAttribute("href") || "");
      const label = String(el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").replace(/\s+/g, " ").trim();
      const isTel = /^tel:/i.test(href);
      // Exact labels only: a tab or a menu item that merely contains the word
      // is not a call being placed.
      const isCall = !isTel && /^(call|call now|dial|start call|place call)$/i.test(label);
      if (!isTel && !isCall) return;
      sendCall({ kind: "click", method: "CLICK", path: isTel ? "tel:" : "click:" + label.toLowerCase() });
    } catch {}
  }, true);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.type !== "C3_SHOTGUN_PROSPECT" || !Number.isFinite(d.id) || d.id <= 0) return;
    // When the URL names a prospect, announces for any OTHER prospect are
    // stale (slow response from the previously viewed one) — drop them.
    const urlId = urlProspectId();
    if (urlId && Number(d.id) !== urlId) return;
    // Same staleness rule, one level out: on a conversation page the URL names
    // the THREAD rather than the prospect, so an announce is only trusted while
    // it is still that thread's. Without this the button could carry the
    // previous borrower's name into a shotgun.
    const convId = urlConversationId();
    if (convId && d.conversationId != null && Number(d.conversationId) !== convId) return;
    current = { id: Number(d.id), fields: d.fields || null };
    ensureMounted();
    if (!busy) setIdle();
  });

  // SPA navigation watcher. A URL id is authoritative: it shows the button
  // immediately and evicts any other prospect; a URL without an id hides the
  // button until the next detail fetch announces what's actually on screen.
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    const id = urlProspectId();
    if (id) {
      if (!current || current.id !== id) current = { id, fields: null };
      ensureMounted();
      if (!busy) setIdle();
    } else if (current) {
      // Leaving a prospect clears it. A conversation URL clears it too — the
      // thread on screen has its own borrower, and the previous one must not
      // linger on the button while the new response is still in flight.
      current = null;
      if (!busy) setIdle();
    }
  }, 500);

  // Direct loads: seed from the URL (deep links, middle-clicks) and ask the
  // page-hook to replay an announce that may have fired before this script's
  // listener existed.
  const seed = urlProspectId();
  if (seed) current = { id: seed, fields: null };
  ensureMounted();
  setIdle();
  window.postMessage({ type: "C3_SHOTGUN_PING" }, location.origin);
})();
