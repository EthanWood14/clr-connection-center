const statusEl = document.getElementById("status");
const keyEl = document.getElementById("key");
const savedEl = document.getElementById("saved");

function refreshStatus() {
  statusEl.className = "wait";
  statusEl.textContent = "Checking connection…";
  chrome.runtime.sendMessage({ type: "c3shotgun.status" }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      statusEl.className = "warn";
      statusEl.textContent = "Extension error — try reopening this popup.";
      return;
    }
    if (resp.ok && resp.body) {
      if (resp.body.canPublish) {
        statusEl.className = "ok";
        statusEl.textContent = `Connected as ${resp.body.name || "you"} — Shotgun publishing enabled ✓`;
      } else {
        statusEl.className = "warn";
        statusEl.textContent = `Connected as ${resp.body.name || "you"}, but you don't have Shotgun publish access. Ask an admin to grant it in C3 Settings.`;
      }
    } else if (resp.status === 401) {
      statusEl.className = "warn";
      statusEl.textContent = "Not connected. Log in to C3 in this browser, or paste your extension key below.";
    } else {
      statusEl.className = "warn";
      statusEl.textContent = (resp.body && resp.body.error) || `C3 error (HTTP ${resp.status || "?"}).`;
    }
  });
}

chrome.storage.local.get("c3Key").then((stored) => {
  if (stored.c3Key) keyEl.value = String(stored.c3Key);
});

// What the Bonzo tab last saw. Turns "the button never showed up" from a
// mystery into one line the person reading it can act on.
const seenEl = document.getElementById("seen");
chrome.storage.local.get("c3Seen").then((stored) => {
  const seen = stored && stored.c3Seen;
  if (!seenEl) return;
  if (!seen) {
    seenEl.textContent = "No Bonzo tab seen yet. Open a prospect in Bonzo, then reopen this popup.";
    return;
  }
  const age = Math.max(0, Math.round((Date.now() - Number(seen.at || 0)) / 1000));
  const when = age < 90 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;
  seenEl.textContent = seen.id
    ? `Prospect ${seen.id} detected (${when}).`
    : `On a Bonzo page ${when}, but no prospect id in the address. Open a single prospect, not a list.`;
});

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.set({ c3Key: keyEl.value.trim() }).then(() => {
    savedEl.style.display = "block";
    setTimeout(() => { savedEl.style.display = "none"; }, 2000);
    refreshStatus();
  });
});

refreshStatus();
