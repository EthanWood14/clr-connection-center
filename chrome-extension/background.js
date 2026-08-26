// Service worker: the only place that talks to C3. It holds the host
// permission for westcapitallending.center, so its fetches ride the C3 session
// cookie when the user is logged in there; the optional per-user extension key
// (popup → chrome.storage) covers browsers where the strict cookie won't
// travel. Content scripts never see the key.
const C3_BASE = "https://www.westcapitallending.center";

async function extensionKey() {
  try {
    const stored = await chrome.storage.local.get("c3Key");
    return String(stored.c3Key || "").trim();
  } catch {
    return "";
  }
}

async function c3(path, init = {}) {
  const key = await extensionKey();
  const headers = { "Content-Type": "application/json" };
  if (key) headers["X-C3-Extension-Key"] = key;
  try {
    const res = await fetch(C3_BASE + path, { credentials: "include", ...init, headers });
    let body = null;
    try { body = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { error: "Could not reach C3 — check your connection." } };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "c3shotgun.publish") {
    c3("/api/shotgun/from-bonzo", {
      method: "POST",
      body: JSON.stringify({ prospectId: msg.prospectId, url: msg.url }),
    }).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "c3shotgun.status") {
    c3("/api/shotgun/extension-status").then(sendResponse);
    return true;
  }
});
